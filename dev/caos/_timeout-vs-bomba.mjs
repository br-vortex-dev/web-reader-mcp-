#!/usr/bin/env node
// O timeout interrompe a descompressão? Testa a MESMA bomba com timeouts
// bem diferentes: se o tempo de parede não mudar, o timeout é decorativo
// nesse caminho.
import http from "node:http";
import zlib from "node:zlib";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..", "..");
process.env.ALLOW_PRIVATE_HOSTS = "1";
const { fetchText } = await import(pathToFileURL(join(RAIZ, "src", "fetch.mjs")).href);
const { MAX_RESPONSE_BYTES } = await import(pathToFileURL(join(RAIZ, "src", "config.mjs")).href);

console.log(`MAX_RESPONSE_BYTES = ${(MAX_RESPONSE_BYTES / 1024 / 1024).toFixed(1)} MB\n`);

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
// Compressão bem rápida de gerar, para o alvo não ser o gargalo.
const compBrotli = zlib.brotliCompressSync(Buffer.alloc(100 * MB, 0));
const compGzip = zlib.gzipSync(Buffer.alloc(100 * MB, 0), { level: 1 });

const alvo = http.createServer((req, res) => {
  if (req.url === "/br") {
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "br", "content-length": compBrotli.length });
    res.end(compBrotli);
    return;
  }
  if (req.url === "/gz") {
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip", "content-length": compGzip.length });
    res.end(compGzip);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body><h1>ok</h1></body></html>");
});
const p = await freePort();
await new Promise((r) => alvo.listen(p, "127.0.0.1", r));

async function medir(rota, timeoutMs) {
  let ultima = Date.now();
  let maior = 0;
  const sonda = setInterval(() => {
    const a = Date.now();
    maior = Math.max(maior, a - ultima);
    ultima = a;
  }, 20);
  const t0 = Date.now();
  let saida;
  try {
    await fetchText(`http://127.0.0.1:${p}${rota}`, { timeoutMs });
    saida = "OK";
  } catch (e) {
    saida = `${e.name}`;
  }
  clearInterval(sonda);
  const total = Date.now() - t0;
  return { total, saida, maior };
}

for (const rota of ["/br", "/gz"]) {
  const rotulo = rota === "/br" ? "brotli 100 MB (429 bytes no fio)" : "gzip 100 MB (100 KB no fio)";
  console.log(`=== ${rotulo} ===`);
  for (const timeoutMs of [1000, 8000, 30000]) {
    const r = await medir(rota, timeoutMs);
    const estourou = r.total > timeoutMs * 1.5;
    console.log(
      `   timeoutMs=${String(timeoutMs).padStart(5)} -> parede ${String(r.total).padStart(6)} ms | ${r.saida.padEnd(25)} | maior travamento ${r.maior} ms` +
        (estourou ? `   <<< passou ${(r.total / timeoutMs).toFixed(1)}x do timeout` : "")
    );
  }
  console.log("");
}

alvo.close();
process.exit(0);
