#!/usr/bin/env node
// Onde exatamente a bomba brotli trava? Roda o servidor REAL com o lagwatch
// e acompanha /health durante o ataque, registrando quando ele para de responder.
import { spawn } from "node:child_process";
import http from "node:http";
import zlib from "node:zlib";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..", "..");
const TOKEN = "t";
const LAGWATCH = pathToFileURL(join(__dirname, "_lagwatch.mjs")).href;

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

const portaMcp = await freePort();
const child = spawn(process.execPath, ["--import", LAGWATCH, join(RAIZ, "server.js"), "--http"], {
  cwd: RAIZ,
  env: { ...process.env, PORT: String(portaMcp), MCP_AUTH_TOKEN: TOKEN, ALLOW_PRIVATE_HOSTS: "1", RATE_LIMIT_MAX: "1000000", LAG_MS: "800" },
  stdio: ["ignore", "ignore", "pipe"],
});
let err = "";
child.stderr.on("data", (c) => {
  err += c;
  for (const l of c.toString().split("\n")) {
    if (/LAGTOTAL|MEMALTA/.test(l)) console.log("   [servidor] " + l.trim());
  }
});
const base = `http://127.0.0.1:${portaMcp}`;
for (let i = 0; i < 150; i++) {
  try {
    if ((await fetch(`${base}/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}

// Alvo: brotli de 150 MB de zeros, igual ao fixture.
const alvo = http.createServer((req, res) => {
  if (req.url === "/bomba") {
    const comp = zlib.brotliCompressSync(Buffer.alloc(150 * 1024 * 1024, 0));
    console.log(`   [alvo] brotli comprimido: ${comp.length} bytes (de 150 MB)`);
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "br", "content-length": comp.length });
    res.end(comp);
    return;
  }
  if (req.url === "/gzip") {
    const comp = zlib.gzipSync(Buffer.alloc(200 * 1024 * 1024, 0));
    console.log(`   [alvo] gzip comprimido: ${comp.length} bytes (de 200 MB)`);
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip", "content-length": comp.length });
    res.end(comp);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body><h1>ok</h1></body></html>");
});
const portaAlvo = await freePort();
await new Promise((r) => alvo.listen(portaAlvo, "127.0.0.1", r));
const A = `http://127.0.0.1:${portaAlvo}`;

async function atacar(rota, rotulo) {
  console.log(`\n=== ${rotulo} ===`);
  const t0 = Date.now();
  const marcador = [];

  // Sonda em paralelo: /health a cada 200 ms, marca quando para de responder.
  let rodando = true;
  const sonda = (async () => {
    while (rodando) {
      const ti = Date.now();
      try {
        const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(40000) });
        await r.text();
        marcador.push({ dt: Date.now() - t0, ms: Date.now() - ti, ok: true });
      } catch (e) {
        marcador.push({ dt: Date.now() - t0, ms: Date.now() - ti, ok: false });
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  })();

  const chamada = fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_page", arguments: { url: `${A}${rota}`, maxChars: 1000 } } }),
    signal: AbortSignal.timeout(120000),
  })
    .then(async (r) => {
      const j = await r.json().catch(() => null);
      return { ms: Date.now() - t0, isError: Boolean(j?.result?.isError), texto: String(j?.result?.content?.[0]?.text ?? r.status) };
    })
    .catch((e) => ({ ms: Date.now() - t0, isError: false, texto: "falha: " + e.message }));

  const r = await chamada;
  rodando = false;
  await sonda;

  console.log(`   resposta ao cliente: ${r.ms} ms | isError=${r.isError}`);
  console.log(`   texto: ${r.texto.slice(0, 120).replace(/\s+/g, " ")}`);

  // Encontra a maior janela sem nenhuma sonda concluída.
  marcador.sort((a, b) => a.dt - b.dt);
  let buraco = 0;
  let onde = 0;
  for (let i = 1; i < marcador.length; i++) {
    const g = marcador[i].dt - marcador[i - 1].dt;
    if (g > buraco) {
      buraco = g;
      onde = marcador[i - 1].dt;
    }
  }
  console.log(`   sondas: ${marcador.length} | falhas: ${marcador.filter((s) => !s.ok).length}`);
  console.log(`   MAIOR JANELA MUDA: ${buraco} ms (começando em ${onde} ms)`);
  console.log(buraco > 2000 ? `   >>> o servidor ficou ${(buraco / 1000).toFixed(1)}s SURDO` : "   >>> nunca ficou surdo");
}

await atacar("/gzip", "GZIP 200 MB");
await atacar("/bomba", "BROTLI 150 MB");

// Última checagem: o servidor ainda lê uma página normal?
const ok = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_page", arguments: { url: `${A}/normal`, maxChars: 500 } } }),
}).then((r) => r.json()).catch((e) => ({ erro: e.message }));
console.log(`\napos as duas bombas, leitura normal: ${ok?.result?.content?.[0]?.text?.slice(0, 80) || JSON.stringify(ok).slice(0, 80)}`);

console.log("\n--- stderr completo do servidor ---");
console.log(err.trim().split("\n").slice(-25).join("\n") || "(vazio)");
child.kill();
alvo.close();
process.exit(0);
