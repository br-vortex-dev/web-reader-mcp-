// Descompressao do corpo da resposta (net.mjs · desembrulhar).
//
// O que se quer garantir:
// - gzip, br e deflate COM cabecalho zlib continuam descomprimindo igual;
// - deflate com fluxo CRU (sem os 2 bytes de cabecalho) TAMBEM descomprime —
//   antes isso virava "falha ao descomprimir a resposta (Z_DATA_ERROR)" e
//   derrubava a leitura de uma pagina que veio inteira e correta;
// - encoding desconhecido (ou ausente) passa como veio, sem julgar;
// - o corpo fatiado byte a byte (o pior caso para quem decide o formato
//   olhando os 2 primeiros bytes) da o mesmo resultado;
// - fluxo truncado termina em erro, e nao pendura a leitura.
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { desembrulhar, coletarComTeto } from "../src/net.mjs";

const TEXTO = "corpo de teste com acentuação — ação, coração, cabeçalho. ".repeat(40);

/** Passa o buffer pelo desembrulhar com os headers dados e devolve o texto. */
async function descomprimir(buffer, headers, { pedacos = 1 } = {}) {
  const partes = [];
  if (pedacos <= 1) {
    partes.push(buffer);
  } else {
    const tamanho = Math.ceil(buffer.length / pedacos);
    for (let i = 0; i < buffer.length; i += tamanho) {
      partes.push(buffer.subarray(i, i + tamanho));
    }
  }
  const fonte = desembrulhar(Readable.from(partes), headers);
  const saida = await coletarComTeto(fonte, { maxBytes: 4 * 1024 * 1024, url: "https://exemplo.com/" });
  return saida.toString("utf8");
}

test("gzip continua descomprimindo", async () => {
  const comprimido = zlib.gzipSync(Buffer.from(TEXTO, "utf8"));
  assert.equal(await descomprimir(comprimido, { "content-encoding": "gzip" }), TEXTO);
});

test("brotli continua descomprimindo", async () => {
  const comprimido = zlib.brotliCompressSync(Buffer.from(TEXTO, "utf8"));
  assert.equal(await descomprimir(comprimido, { "content-encoding": "br" }), TEXTO);
});

test("deflate com cabecalho zlib (o formato do RFC) descomprime", async () => {
  const comprimido = zlib.deflateSync(Buffer.from(TEXTO, "utf8"));
  assert.equal(await descomprimir(comprimido, { "content-encoding": "deflate" }), TEXTO);
});

test("deflate com fluxo CRU descomprime (era Z_DATA_ERROR)", async () => {
  const comprimido = zlib.deflateRawSync(Buffer.from(TEXTO, "utf8"));
  assert.equal(await descomprimir(comprimido, { "content-encoding": "deflate" }), TEXTO);
});

test("deflate cru fatiado byte a byte da o mesmo texto", async () => {
  const comprimido = zlib.deflateRawSync(Buffer.from(TEXTO, "utf8"));
  // Um byte por pedaco: o decisor so pode escolher quando os 2 primeiros
  // chegam, e os seguintes nao podem se perder nessa espera.
  const partes = Array.from(comprimido, (b) => Buffer.from([b]));
  const fonte = desembrulhar(Readable.from(partes), { "content-encoding": "deflate" });
  const saida = await coletarComTeto(fonte, { maxBytes: 4 * 1024 * 1024, url: "https://exemplo.com/" });
  assert.equal(saida.toString("utf8"), TEXTO);
});

test("deflate com cabecalho zlib fatiado byte a byte tambem funciona", async () => {
  const comprimido = zlib.deflateSync(Buffer.from(TEXTO, "utf8"));
  const partes = Array.from(comprimido, (b) => Buffer.from([b]));
  const fonte = desembrulhar(Readable.from(partes), { "content-encoding": "deflate" });
  const saida = await coletarComTeto(fonte, { maxBytes: 4 * 1024 * 1024, url: "https://exemplo.com/" });
  assert.equal(saida.toString("utf8"), TEXTO);
});

test("sem content-encoding o corpo passa como veio", async () => {
  const cru = Buffer.from(TEXTO, "utf8");
  assert.equal(await descomprimir(cru, {}), TEXTO);
});

test("encoding desconhecido passa como veio (mesmo comportamento do fetch)", async () => {
  const cru = Buffer.from(TEXTO, "utf8");
  assert.equal(await descomprimir(cru, { "content-encoding": "zstd" }), TEXTO);
});

test("identity nao e descomprimido", async () => {
  const cru = Buffer.from(TEXTO, "utf8");
  assert.equal(await descomprimir(cru, { "content-encoding": "identity" }), TEXTO);
});

test("fluxo deflate truncado termina em erro, sem pendurar", async () => {
  const comprimido = zlib.deflateRawSync(Buffer.from(TEXTO, "utf8"));
  const metade = comprimido.subarray(0, Math.floor(comprimido.length / 2));
  await assert.rejects(
    () => descomprimir(metade, { "content-encoding": "deflate" }),
    "um fluxo cortado nao pode ser aceito como se estivesse completo"
  );
});

test("corpo vazio com deflate falha em vez de travar", async () => {
  await assert.rejects(() => descomprimir(Buffer.alloc(0), { "content-encoding": "deflate" }));
});
