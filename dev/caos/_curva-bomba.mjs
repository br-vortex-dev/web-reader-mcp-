#!/usr/bin/env node
// Onde está o joelho? Mesma bomba em tamanhos crescentes, medindo o tempo
// de parede e o travamento do event loop.
import http from "node:http";
import zlib from "node:zlib";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..", "..");
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
const comprimidos = new Map();
const alvo = http.createServer((req, res) => {
  const m = /^\/(br|gz)\/(\d+)$/.exec(req.url);
  if (!m) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>ok</body></html>");
    return;
  }
  const [, enc, mb] = m;
  const chave = `${enc}-${mb}`;
  let comp = comprimidos.get(chave);
  if (!comp) {
    const bruto = Buffer.alloc(Number(mb) * MB, 0);
    comp = enc === "br" ? zlib.brotliCompressSync(bruto) : zlib.gzipSync(bruto, { level: 1 });
    comprimidos.set(chave, comp);
  }
  res.writeHead(200, {
    "content-type": "text/html",
    "content-encoding": enc,
    "content-length": comp.length,
  });
  res.end(comp);
});
const p = await freePort();
await new Promise((r) => alvo.listen(p, "127.0.0.1", r));

async function medir(enc, mb) {
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
    await fetchText(`http://127.0.0.1:${p}/${enc}/${mb}`, { timeoutMs: 8000 });
    saida = "OK";
  } catch (e) {
    saida = e.name;
  }
  clearInterval(sonda);
  return { total: Date.now() - t0, saida, maior };
}

for (const enc of ["br", "gz"]) {
  console.log(`\n=== ${enc === "br" ? "BROTLI" : "GZIP"} — bomba de zeros, teto 5 MB ===`);
  console.log("   MB descomprimidos | bytes no fio | parede (ms) | travamento do loop (ms) | resultado");
  for (const mb of [50, 100, 120, 150, 200, 300, 500]) {
    let comp;
    try {
      const bruto = Buffer.alloc(mb * MB, 0);
      comp = enc === "br" ? zlib.brotliCompressSync(bruto) : zlib.gzipSync(bruto, { level: 1 });
      if (comp.length > 50 * MB) {
        console.log(`   ${String(mb).padStart(4)} MB | comprimido grande demais (${(comp.length / MB).toFixed(1)} MB), pulado`);
        continue;
      }
    } catch {
      continue;
    }
    const r = await medir(enc, mb);
    const alerta = r.maior > 1000 ? "  <<< TRAVOU" : "";
    console.log(
      `   ${String(mb).padStart(4)} MB            | ${String(comp.length).padStart(8)} B  | ${String(r.total).padStart(8)}    | ${String(r.maior).padStart(9)}${alerta} | ${r.saida}`
    );
  }
}

alvo.close();
process.exit(0);
