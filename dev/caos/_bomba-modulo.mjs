#!/usr/bin/env node
// Reproduz a bomba FORA do HTTP: usa o próprio coletarComTeto + desembrulhar
// do projeto contra um stream brotli local, e cronometra cada etapa.
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { coletarComTeto, desembrulhar } = await import(
  pathToFileURL(join(__dirname, "..", "..", "src", "net.mjs")).href
);

const MB = 1024 * 1024;

function corpoComprimido(enc, tamanhoMB) {
  const corpo = Buffer.alloc(tamanhoMB * MB, 0);
  return enc === "br" ? zlib.brotliCompressSync(corpo) : zlib.gzipSync(corpo, { level: 9 });
}

async function tentar(enc, tamanhoMB) {
  const comp = corpoComprimido(enc, tamanhoMB);
  console.log(`\n=== ${enc.toUpperCase()} ${tamanhoMB} MB -> ${comp.length} bytes no fio ===`);

  let ultima = Date.now();
  let maior = 0;
  const sonda = setInterval(() => {
    const a = Date.now();
    maior = Math.max(maior, a - ultima);
    ultima = a;
  }, 20);

  const cru = Readable.from([comp]);
  const filtrado = desembrulhar(cru, { "content-encoding": enc });

  const controller = new AbortController();
  const t0 = Date.now();
  const abortTimer = setTimeout(() => {
    console.log(`   [abort] disparando abort do timeout (8000 ms) em ${Date.now() - t0} ms`);
    controller.abort(new Error("estourou o timeout"));
  }, 8000);

  let resultado;
  try {
    const buf = await coletarComTeto(filtrado, { maxBytes: 5 * MB, url: "bomba", signal: controller.signal });
    resultado = `OK ${buf.length} bytes`;
  } catch (e) {
    resultado = `ERRO ${e.name}: ${e.message}`;
  }
  clearTimeout(abortTimer);
  clearInterval(sonda);

  const total = Date.now() - t0;
  console.log(`   resultado: ${resultado}`);
  console.log(`   tempo total: ${total} ms`);
  console.log(`   maior pausa do event loop: ${maior} ms`);

  // O stream de baixo foi destruído? Se o abort só é lido no catch, a
  // descompressão continua rodando até o fim.
  console.log(`   stream cru destruído: ${cru.destroyed} | filtro destruído: ${filtrado.destroyed}`);
  return total;
}

await tentar("gzip", 200);
await tentar("br", 150);
process.exit(0);
