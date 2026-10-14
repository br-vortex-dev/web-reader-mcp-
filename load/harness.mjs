// Harness de carga do web-reader-mcp — zero dependencias (so built-ins).
//
// Mede throughput, latencia (p50/p95/p99), erros e memoria do servidor sob
// concorrencia, usando o modelo fechado classico: N clientes com conexao
// keep-alive, cada um com 1 requisicao em voo, ate acabar o tempo.
//
// Uso:
//   node load/harness.mjs --concurrency 10000 --seconds 20 --mode read
//
// Modos:
//   tools      -> tools/list (nao faz I/O): mede a camada HTTP pura
//   read       -> read_page com URL UNICA por requisicao (cache miss sempre):
//                 pior caso, mede fetch + parser
//   read-cache -> read_page sempre na MESMA URL: mede o caminho de cache quente
//
// O servidor sobe com --expose-gc + preload para reportar o heap vivo.
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// --import precisa de URL file:// no Windows
const MEMWATCH = pathToFileURL(join(__dirname, "memwatch.mjs")).href;

/* ------------------------------ argumentos ------------------------------ */
const args = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i === -1 ? padrao : args[i + 1];
};
// --server permite apontar para outra copia (usado para comparar antes/depois)
const SERVER = arg("server", join(__dirname, "..", "server.js"));
const CONCURRENCY = Number(arg("concurrency", 1000));
const SECONDS = Number(arg("seconds", 15));
const MODE = arg("mode", "read");
const PORT = Number(arg("port", 4300));
const FIXTURE_PORT = PORT + 1;
const TOKEN = "carga";
// Requisicoes em voo por cliente. 1 = o cliente espera cada resposta.
const PIPELINE = Number(arg("pipeline", 1));
// Latencia simulada do "site publico". 0 = upstream instantaneo, que e o PIOR
// caso para concorrencia (todo o tempo vira CPU). A web real tem 100-500 ms,
// e ai o tempo e gasto esperando rede e a concorrencia sai quase de graca.
const DELAY_MS = Number(arg("delay", 0));

/* --------------------------- fixture de destino -------------------------- */
// Responde na hora, com uma pagina pequena. E o "site publico" do teste.
// Roda em PROCESSO SEPARADO (--fixture-only) para nao competir por CPU com o
// cliente de carga e poluir a medicao.
function criarFixture(porta) {
  const srv = http.createServer((req, res) => {
    const responder = () => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><head><title>Alvo</title></head><body>" +
          "<h1>Alvo</h1><p>" +
          "conteudo de teste para medir o custo de fetch e parse do servidor. ".repeat(20) +
          "</p></body></html>"
      );
    };
    if (DELAY_MS > 0) setTimeout(responder, DELAY_MS);
    else responder();
  });
  return srv;
}

if (args.includes("--fixture-only")) {
  const srv = criarFixture(FIXTURE_PORT);
  await new Promise((r) => srv.listen(FIXTURE_PORT, "127.0.0.1", r));
  console.log(`fixture no ar na porta ${FIXTURE_PORT}`);
  // nunca resolve: mantem o processo vivo apenas com o fixture
  await new Promise(() => {});
}

// Espera o fixture aceitar conexao antes de comecar.
const fixtureChild =
  MODE === "tools"
    ? null
    : spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), "--fixture-only", "--port", String(PORT), "--delay", String(DELAY_MS)],
        { stdio: ["ignore", "ignore", "ignore"] }
      );
if (fixtureChild) {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://127.0.0.1:${FIXTURE_PORT}/fixo`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

/* ------------------------------- servidor -------------------------------- */
const child = spawn(
  process.execPath,
  ["--expose-gc", "--import", MEMWATCH, SERVER, "--http"],
  {
    env: {
      ...process.env,
      PORT: String(PORT),
      MCP_AUTH_TOKEN: TOKEN,
      // fixture local: libera o bloqueio de host privado
      ALLOW_PRIVATE_HOSTS: "1",
      // cada requisicao vem de um "cliente" diferente: mede o caminho normal,
      // sem esbarrar no rate limit de 60/min por cliente
      TRUST_PROXY_HOPS: "1",
      MEMWATCH_MS: "250",
    },
    stdio: ["ignore", "ignore", "pipe"],
  }
);
let stderrServidor = "";
let heapPico = 0;
let rssPico = 0;
child.stderr.on("data", (chunk) => {
  stderrServidor += chunk;
  for (const linha of chunk.toString().split("\n")) {
    const m = linha.match(/MEMWATCH heapUsed=(\d+) rss=(\d+)/);
    if (m) {
      heapPico = Math.max(heapPico, Number(m[1]));
      rssPico = Math.max(rssPico, Number(m[2]));
    }
  }
});

const base = `http://127.0.0.1:${PORT}`;
let subiu = false;
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${base}/health`)).ok) {
      subiu = true;
      break;
    }
  } catch {
    // ainda subindo
  }
  await new Promise((r) => setTimeout(r, 100));
}
if (!subiu) {
  console.error("servidor nao subiu:\n" + stderrServidor);
  process.exit(1);
}

/* ------------------------------ cliente ---------------------------------- */
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY * PIPELINE,
  maxFreeSockets: CONCURRENCY * PIPELINE,
  scheduling: "fifo",
});

let contador = 0;
let enviados = 0;
let ok = 0;
let errosHttp = 0;
let errosRede = 0;
// O servidor devolve HTTP 200 mesmo quando a ferramenta falha (o erro vem
// dentro do JSON-RPC, em result.isError). Sem contar isso a medicao mente:
// a primeira versao deste harness reportou "0 erros" com 92% das requisicoes
// sendo recusadas pelo limitador.
let errosDeFerramenta = 0;
const latencias = [];
const motivosDeErro = new Map();

const contar = (chave) => motivosDeErro.set(chave, (motivosDeErro.get(chave) || 0) + 1);

function corpoPara(id) {
  if (MODE === "tools") {
    return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" });
  }
  const url = MODE === "read" ? `http://127.0.0.1:${FIXTURE_PORT}/p/${id}` : `http://127.0.0.1:${FIXTURE_PORT}/fixo`;
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "read_page", arguments: { url, maxChars: 2000, timeoutMs: 10000 } },
  });
}

function umaRequisicao(id) {
  return new Promise((resolve) => {
    const corpo = corpoPara(id);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: "/mcp",
        method: "POST",
        agent,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
          "content-length": Buffer.byteLength(corpo),
          // cada requisicao de um "cliente" diferente (IP na direita do XFF)
          "x-forwarded-for": `10.0.0.1, 10.${(id >> 16) & 255}.${(id >> 8) & 255}.${id & 255}`,
        },
      },
      (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (texto += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            errosHttp++;
            contar(`HTTP ${res.statusCode}`);
            resolve();
            return;
          }
          // HTTP 200: confere se a ferramenta devolveu erro.
          let erroDeFerramenta = false;
          try {
            const json = JSON.parse(texto);
            const resultado = Array.isArray(json) ? json[0]?.result : json.result;
            erroDeFerramenta = Boolean(resultado && resultado.isError);
            if (erroDeFerramenta) {
              const msg = String(resultado.content?.[0]?.text || "").slice(0, 90);
              contar(msg.replace(/\d+/g, "N"));
            }
          } catch {
            contar("resposta nao-JSON");
          }
          if (erroDeFerramenta) errosDeFerramenta++;
          else ok++;
          resolve();
        });
      }
    );
    req.on("error", (err) => {
      errosRede++;
      contar(err.code || err.message);
      resolve();
    });
    req.end(corpo);
  });
}

// Cada "cliente" mantem PIPELINE requisicoes em voo ate acabar o tempo.
async function cliente() {
  const minhas = [];
  for (let i = 0; i < PIPELINE; i++) {
    minhas.push(
      (async () => {
        for (;;) {
          if (parar) return;
          const id = ++contador;
          enviados++;
          const t0 = process.hrtime.bigint();
          await umaRequisicao(id);
          latencias.push(Number(process.hrtime.bigint() - t0) / 1e6);
        }
      })()
    );
  }
  await Promise.all(minhas);
}

/* -------------------------------- execucao ------------------------------- */
console.log(
  `# carga: modo=${MODE} concorrencia=${CONCURRENCY} pipeline=${PIPELINE} tempo=${SECONDS}s ` +
    `total_em_voo=${CONCURRENCY * PIPELINE}`
);

let parar = false;
const t0 = Date.now();
const amostras = [];
const amostrador = setInterval(async () => {
  try {
    const r = await fetch(`${base}/health`);
    amostras.push((await r.text()).trim());
  } catch {
    // servidor ocupado
  }
}, 2000);

const clientes = [];
for (let i = 0; i < CONCURRENCY; i++) clientes.push(cliente());

await new Promise((r) => setTimeout(r, SECONDS * 1000));
parar = true;
await Promise.all(clientes);
const decorrido = (Date.now() - t0) / 1000;
clearInterval(amostrador);

/* -------------------------------- relatorio ------------------------------ */
latencias.sort((a, b) => a - b);
const pct = (p) => (latencias.length ? latencias[Math.min(latencias.length - 1, Math.floor((p / 100) * latencias.length))] : 0);
const soma = latencias.reduce((s, n) => s + n, 0);

console.log(`decorrido:        ${decorrido.toFixed(1)} s`);
console.log(`enviados:         ${enviados}`);
console.log(`sucesso real:     ${ok}  (${((ok / (enviados || 1)) * 100).toFixed(1)}%)`);
console.log(`erro de ferramenta: ${errosDeFerramenta}  (HTTP 200 com isError)`);
console.log(`erros HTTP:       ${errosHttp}`);
console.log(`erros de rede:    ${errosRede}`);
console.log(`throughput:       ${(enviados / decorrido).toFixed(0)} req/s`);
console.log(`vazao util:       ${(ok / decorrido).toFixed(0)} req/s`);
console.log(`latencia media:   ${(soma / (latencias.length || 1)).toFixed(1)} ms`);
console.log(`latencia p50:     ${pct(50).toFixed(1)} ms`);
console.log(`latencia p95:     ${pct(95).toFixed(1)} ms`);
console.log(`latencia p99:     ${pct(99).toFixed(1)} ms`);
console.log(`latencia max:     ${(latencias[latencias.length - 1] || 0).toFixed(1)} ms`);
console.log(`heap pico:        ${(heapPico / 1024 / 1024).toFixed(1)} MB`);
console.log(`rss pico:         ${(rssPico / 1024 / 1024).toFixed(1)} MB`);
if (motivosDeErro.size > 0) {
  console.log(`motivos de erro:  ${[...motivosDeErro.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
}
if (amostras.length > 0) {
  console.log(`ultimo /health:   ${amostras[amostras.length - 1]}`);
}
const servidorVivo = child.exitCode === null;
console.log(`servidor vivo:    ${servidorVivo}`);
if (!servidorVivo) console.log("stderr do servidor:\n" + stderrServidor.slice(-2000));

child.kill();
if (fixtureChild) fixtureChild.kill();
agent.destroy();
setTimeout(() => process.exit(0), 300);
