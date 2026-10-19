#!/usr/bin/env node
// Última peça: desembrulhar + coletarComTeto contra HTTP REAL (sem fetch.mjs).
// Se travar aqui, o culpado é net.mjs; se não, é fetch.mjs.
import http from "node:http";
import zlib from "node:zlib";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..", "..");
const { desembrulhar, coletarComTeto, httpGetUmSalto } = await import(
  pathToFileURL(join(RAIZ, "src", "net.mjs")).href
);

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
const comp = zlib.brotliCompressSync(Buffer.alloc(150 * MB, 0));
const alvo = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html", "content-encoding": "br", "content-length": comp.length });
  res.end(comp);
});
const p = await freePort();
await new Promise((r) => alvo.listen(p, "127.0.0.1", r));

let ultima = Date.now();
let maior = 0;
const sonda = setInterval(() => {
  const a = Date.now();
  maior = Math.max(maior, a - ultima);
  ultima = a;
}, 20);

const t0 = Date.now();
try {
  const resposta = await httpGetUmSalto(`http://127.0.0.1:${p}/`, {});
  console.log(`cabecalhos recebidos em ${Date.now() - t0} ms: content-encoding=${resposta.headers["content-encoding"]} content-length=${resposta.headers["content-length"]}`);
  const fluxo = desembrulhar(resposta.stream, resposta.headers);
  const buf = await coletarComTeto(fluxo, { maxBytes: 5 * MB, url: "bomba" });
  console.log(`coletarComTeto devolveu ${buf.length} bytes em ${Date.now() - t0} ms`);
} catch (e) {
  console.log(`erro em ${Date.now() - t0} ms: ${e.name}: ${e.message.slice(0, 90)}`);
}
clearInterval(sonda);
console.log(`maior travamento do event loop: ${maior} ms`);
console.log(maior > 1000 ? ">>> TRAVOU — culpado é net.mjs" : ">>> rápido — culpado é fetch.mjs");

alvo.close();
process.exit(0);
