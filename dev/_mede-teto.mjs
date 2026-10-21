#!/usr/bin/env node
/**
 * _mede-teto.mjs — o teto de download proporcional vale a pena?
 *
 * Mede, na MESMA máquina e no MESMO servidor, a leitura das mesmas páginas com
 * o teto LIGADO (padrão) e DESLIGADO (DOWNLOAD_FOLGA_POR_CHAR gigante, que faz
 * o teto proporcional virar o teto duro de 5 MB = comportamento antigo).
 *
 * Quatro páginas de fixture, porque o ganho depende do que o servidor manda:
 *   - grande-com-length     : 2 MB, content-length declarado (caminho do atalho)
 *   - grande-chunked        : 2 MB, sem content-length (caminho do corte real)
 *   - media                 : 600 KB (fica abaixo do piso de 1 MB: não muda)
 *   - pequena               : 20 KB (não muda)
 *
 * O que é comparado, além do tempo: o TEXTO devolvido tem de ser o mesmo nos
 * dois casos, caractere por caractere. Ganho que muda a saída não é ganho.
 *
 * Uso: node dev/_mede-teto.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVIDOR = join(RAIZ, "server.js");
const TOKEN = "token-de-medicao";

/* ------------------------------------------------------------------ *
 * Fixture: páginas com o mesmo TEXTO útil e tamanhos diferentes
 * ------------------------------------------------------------------ */

function pagina({ titulo, paragrafos, marca }) {
  const corpo = Array.from(
    { length: paragrafos },
    (_, i) =>
      `<p>${marca} paragrafo ${i}: texto de enchimento para empurrar a pagina. ` +
      `Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. ${"palavra ".repeat(8)}</p>`
  ).join("\n");
  return (
    `<!DOCTYPE html><html><head><title>${titulo}</title>` +
    `<meta name="description" content="pagina de medicao"></head><body>` +
    `<h1>${titulo}</h1>${corpo}<h2>FIM-${marca}</h2></body></html>`
  );
}

const PAGINAS = new Map([
  // Acima do teto duro de 5 MB: é aqui que o comportamento antigo baixava 5 MB
  // e o novo para no proporcional. 5.000 parágrafos ≈ 1 MB; 22.000 ≈ 4,6 MB.
  ["/grande-com-length", pagina({ titulo: "Grande com length", paragrafos: 18000, marca: "GRANDE" })],
  ["/grande-chunked", pagina({ titulo: "Grande chunked", paragrafos: 18000, marca: "CHUNKED" })],
  ["/media", pagina({ titulo: "Media", paragrafos: 4500, marca: "MEDIA" })],
  ["/pequena", pagina({ titulo: "Pequena", paragrafos: 40, marca: "PEQUENA" })],
]);

// Banda simulada da origem. Localhost entrega 5 MB em 3 ms, o que esconde
// completamente o efeito de baixar menos — e não é o cenário real: o servidor
// publicado lê sites pela internet. 8 MB/s é uma fibra boa; é a mesma ordem
// dos números medidos na bateria do Render (whatwg, 12 MB, ~1,9 s).
const BANDA_BYTES_POR_S = Number(process.env.BANDA_MB_S || 8) * 1024 * 1024;
const PEDACO = 64 * 1024;

function subirFixture() {
  return new Promise((resolve) => {
    const contagem = new Map();
    const servidor = createServer((req, res) => {
      const caminho = req.url.split("?")[0];
      contagem.set(caminho, (contagem.get(caminho) || 0) + 1);
      if (caminho === "/robots.txt") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("User-agent: *\nAllow: /\n");
        return;
      }
      if (caminho === "/favicon.ico") {
        res.writeHead(204).end();
        return;
      }
      const html = PAGINAS.get(caminho);
      if (!html) {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<html><body>404</body></html>");
        return;
      }
      const buf = Buffer.from(html, "utf8");
      // Entrega em pedaços, no ritmo da banda simulada — é o que faz baixar
      // menos byte virar menos tempo de verdade.
      const enviarEmPedacos = () => {
        let pos = 0;
        const passo = () => {
          if (res.writableEnded || res.destroyed) return;
          if (pos >= buf.length) {
            res.end();
            return;
          }
          const fim = Math.min(pos + PEDACO, buf.length);
          res.write(buf.subarray(pos, fim));
          const escrito = fim - pos;
          pos = fim;
          setTimeout(passo, (escrito / BANDA_BYTES_POR_S) * 1000);
        };
        passo();
      };
      if (caminho === "/grande-chunked") {
        // Sem content-length: o Node usa chunked. O corte aqui vem da contagem
        // REAL de bytes do streaming, não da promessa do servidor.
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        enviarEmPedacos();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(buf.length),
      });
      enviarEmPedacos();
    });
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        contagem,
        close: () => new Promise((r) => servidor.close(r)),
      });
    });
  });
}

/* ------------------------------------------------------------------ *
 * Servidor MCP: sobe, chama, mede
 * ------------------------------------------------------------------ */

async function portaLivre() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function subirMcp(env) {
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [SERVIDOR, "--http"], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(porta),
      MCP_AUTH_TOKEN: TOKEN,
      TRUST_PROXY_HOPS: "0",
      ROBOTS_RESPECT: "1",
      // O fixture roda em 127.0.0.1 e o bloqueio de SSRF recusa host privado —
      // sem isto cada volta devolve "Host bloqueado" em 2 ms e a medição mede
      // o erro, não a leitura.
      ALLOW_PRIVATE_HOSTS: "1",
      ...env,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let erro = "";
  filho.stderr.on("data", (c) => {
    erro += c;
    if (process.env.DIAG_TETO === "1") process.stderr.write(c);
  });
  const base = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 100; i++) {
    if (filho.exitCode !== null) break;
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) break;
    } catch {
      /* subindo */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const chamar = async (nome, args) => {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: nome, arguments: args } }),
    });
    const json = await r.json().catch(() => null);
    return {
      isError: Boolean(json?.result?.isError),
      text: json?.result?.content?.[0]?.text ?? JSON.stringify(json),
    };
  };
  return { chamar, close: () => filho.kill() };
}

/**
 * Mede N voltas e devolve a MEDIANA (o ruído da máquina é grande).
 *
 * Cada volta usa uma URL com query única (`?v=i`): sem isso o cache de página
 * (TTL mínimo de 500 ms, que o config impõe) serviria a mesma entrada e a
 * medição passaria a medir o cache, não o download. É o erro que a primeira
 * versão deste script cometeu.
 */
let voltasFeitas = 0;

async function medir(chamar, url, maxChars, voltas = 5) {
  const tempos = [];
  let saida = "";
  let erro = false;
  for (let i = 0; i < voltas; i++) {
    const t0 = process.hrtime.bigint();
    // A primeira volta usa a URL LIMPA (é a leitura "de estreia", que pode
    // custar duas conexões); as seguintes reusam a mesma URL canônica e se
    // beneficiam da memória de tamanho — que é o cenário real: o mesmo site
    // sendo lido de novo. O cache de página fica neutro porque o TTL mínimo
    // (500 ms) é menor que o intervalo entre as voltas.
    const marca = i === 0 ? "" : `?v=${process.pid}-${voltasFeitas++}`;
    const r = await chamar("read_page", { url: `${url}${marca}`, maxChars, timeoutMs: 60000 });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    tempos.push(ms);
    saida = r.text;
    erro = r.isError;
  }
  const primeira = tempos[0];
  const restantes = tempos.slice(1).sort((a, b) => a - b);
  const meio = Math.floor(restantes.length / 2);
  return {
    // A estreia é reportada separada porque é o único caso que pode custar duas
    // conexões (descobrir que a página é maior que o teto). Misturar as duas
    // numa mediana só esconderia justamente essa diferença.
    estreia: primeira,
    mediana: restantes[meio] ?? primeira,
    min: restantes[0] ?? primeira,
    max: restantes[restantes.length - 1] ?? primeira,
    texto: saida,
    erro,
  };
}

/* ------------------------------------------------------------------ *
 * Execução
 * ------------------------------------------------------------------ */

const VOLTAS = Number(process.env.VOLTAS || 5);
const MAX_CHARS = Number(process.env.MAX_CHARS || 2000);
const fixture = await subirFixture();

// Teto DESLIGADO = folga alta o bastante para o proporcional saturar no teto
// duro (5 MB), que é o comportamento antigo. Com folga pequena o "antes"
// também cortava e a comparação virava mentira (foi o primeiro erro daqui).
const desligado = await subirMcp({ DOWNLOAD_FOLGA_POR_CHAR: "100000", DOWNLOAD_MIN_BYTES: "5242880" });
// Teto LIGADO = padrão do código.
const ligado = await subirMcp({});

const resultados = [];
for (const caminho of PAGINAS.keys()) {
  const alvo = `${fixture.url}${caminho}`;
  const antes = await medir(desligado.chamar, alvo, MAX_CHARS, VOLTAS);
  const depois = await medir(ligado.chamar, alvo, MAX_CHARS, VOLTAS);
  const bytes = Buffer.byteLength(PAGINAS.get(caminho), "utf8");
  // A linha "URL:" carrega o sufixo único de cada volta (que existe para furar
  // o cache) — comparar com ela daria divergência em toda página. O que
  // interessa é o CONTEÚDO entregue.
  const semUrl = (t) => t.replace(/^URL: .*$/m, "URL: (igual)");
  const igual = semUrl(antes.texto) === semUrl(depois.texto);
  resultados.push({
    caminho,
    kb: Math.round(bytes / 1024),
    antes_ms: Number(antes.mediana.toFixed(1)),
    depois_ms: Number(depois.mediana.toFixed(1)),
    antes_estreia: Number(antes.estreia.toFixed(1)),
    depois_estreia: Number(depois.estreia.toFixed(1)),
    min_antes: Number(antes.min.toFixed(1)),
    min_depois: Number(depois.min.toFixed(1)),
    delta_pct: Number((((depois.mediana - antes.mediana) / antes.mediana) * 100).toFixed(0)),
    texto_identico: igual,
    erro_antes: antes.erro,
    erro_depois: depois.erro,
    amostra_erro: antes.erro || depois.erro ? (antes.erro ? antes.texto : depois.texto).slice(0, 160) : null,
    tamanho_antes: antes.texto.length,
    tamanho_depois: depois.texto.length,
    aviso_corte: /download interrompido/i.test(depois.texto),
  });
  const rr = resultados.at(-1);
  console.log(
    `${caminho.padEnd(20)} ${String(Math.round(bytes / 1024)).padStart(5)} KB | ` +
      `estreia ${String(rr.antes_estreia).padStart(6)} -> ${String(rr.depois_estreia).padStart(6)} ms | ` +
      `repeticao ${String(rr.antes_ms).padStart(6)} -> ${String(rr.depois_ms).padStart(6)} ms (${String(rr.delta_pct).padStart(4)}%) | ` +
      `texto ${igual ? "IDENTICO" : "DIVERGIU"}`
  );
}

desligado.close();
ligado.close();
await fixture.close();

const saida = {
  quando: new Date().toISOString(),
  max_chars: MAX_CHARS,
  voltas: VOLTAS,
  metrica: "mediana de read_page (ms)",
  resultados,
};
const arquivo = join(RAIZ, "dev", "load", "mede-teto.json");
writeFileSync(arquivo, JSON.stringify(saida, null, 2), "utf8");
console.log(`\ngravado: dev/load/mede-teto.json`);
const todosIdenticos = resultados.every((r) => r.texto_identico);
console.log(todosIdenticos ? "texto identico em todas as paginas" : "ATENCAO: texto divergiu em alguma pagina");
