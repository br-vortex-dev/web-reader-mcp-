#!/usr/bin/env node
// A bomba trava no fetch.mjs ou na camada MCP? Chama o fetchText do projeto
// direto contra um HTTP real (sem MCP no meio).
import http from "node:http";
import zlib from "node:zlib";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..", "..");
// A config lê o env no import: tem de estar setado ANTES.
process.env.ALLOW_PRIVATE_HOSTS = "1";
const { fetchText } = await import(pathToFileURL(join(RAIZ, "src", "fetch.mjs")).href);

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

const MB = 1024 * 1024;
const alvo = http.createServer((req, res) => {
  if (req.url === "/br") {
    const comp = zlib.brotliCompressSync(Buffer.alloc(150 * MB, 0));
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "br", "content-length": comp.length });
    res.end(comp);
    return;
  }
  if (req.url === "/gz") {
    const comp = zlib.gzipSync(Buffer.alloc(200 * MB, 0), { level: 9 });
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip", "content-length": comp.length });
    res.end(comp);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body><h1>ok</h1></body></html>");
});
const p = await freePort();
await new Promise((r) => alvo.listen(p, "127.0.0.1", r));

async function testar(rota, rotulo) {
  console.log(`\n=== ${rotulo} (fetchText direto, sem MCP) ===`);
  let ultima = Date.now();
  let maior = 0;
  const sonda = setInterval(() => {
    const a = Date.now();
    maior = Math.max(maior, a - ultima);
    ultima = a;
  }, 20);

  const t0 = Date.now();
  try {
    const r = await fetchText(`http://127.0.0.1:${p}${rota}`, { timeoutMs: 8000 });
    console.log(`   OK em ${Date.now() - t0} ms (${r.text?.length} chars)`);
  } catch (e) {
    console.log(`   erro em ${Date.now() - t0} ms: ${e.name}: ${e.message.slice(0, 100)}`);
  }
  clearInterval(sonda);
  console.log(`   maior pausa do event loop: ${maior} ms`);
}

await testar("/gz", "GZIP 200 MB");
await testar("/br", "BROTLI 150 MB");
alvo.close();
process.exit(0);
