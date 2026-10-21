#!/usr/bin/env node
/**
 * _diag-filtros-pdf.mjs — por que o extrator de PDF gasta 1,8 s inflando.
 *
 * A hipótese: o PDF tem milhares de streams e só uma minoria é FlateDecode.
 * O código atual tenta inflateSync + inflateRawSync + gunzipSync em TODOS, e
 * cada falha lança exceção (caro). Aqui a gente lê o DICIONÁRIO de cada objeto
 * (os bytes antes de "stream") e conta qual filtro ele declara.
 *
 * Uso: node dev/_diag-filtros-pdf.mjs [url]
 */
import { inflateSync, constants as zc } from "node:zlib";

const URL_PDF = process.argv[2] || "https://arxiv.org/pdf/1706.03762";

const res = await fetch(URL_PDF, {
  headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0" },
  signal: AbortSignal.timeout(120000),
});
const buffer = Buffer.from(await res.arrayBuffer());
console.log(`PDF: ${(buffer.length / 1024).toFixed(0)} KB`);

const inicio = Buffer.from("stream");
const fim = Buffer.from("endstream");
const achados = [];
let i = 0;
while (i < buffer.length) {
  const s = buffer.indexOf(inicio, i);
  if (s === -1) break;
  const e = buffer.indexOf(fim, s + inicio.length);
  if (e === -1) break;
  let ini = s + inicio.length;
  if (buffer[ini] === 0x0d) ini++;
  if (buffer[ini] === 0x0a) ini++;
  // O dicionário do objeto mora ANTES de "stream": pega uma janela generosa.
  const dicIni = Math.max(0, s - 800);
  const dict = buffer.subarray(dicIni, s).toString("latin1");
  achados.push({ dict, dado: buffer.subarray(ini, e) });
  i = e + fim.length;
}

// Conta os filtros declarados no dicionário.
const contagem = new Map();
for (const { dict } of achados) {
  const m = dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/);
  const filtro = m ? m[1] : "(sem filtro)";
  contagem.set(filtro, (contagem.get(filtro) || 0) + 1);
}
console.log(`\nstreams: ${achados.length}`);
for (const [f, n] of [...contagem.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${f}`);
}

// Custo REAL de cada estratégia, medido no mesmo conjunto.
function cron(rotulo, fn) {
  const t0 = performance.now();
  const r = fn();
  console.log(`${rotulo.padEnd(52)} ${(performance.now() - t0).toFixed(1)} ms  -> ${r}`);
  return r;
}

// Estratégia atual: tenta os três em tudo.
cron("A) atual: 3 filtros em todos", () => {
  let ok = 0;
  for (const { dado } of achados) {
    let achou = false;
    for (const fn of [inflateSync, () => null, () => null]) {
      try {
        const o = fn(dado);
        if (o && o.length) { ok++; achou = true; break; }
      } catch {}
    }
  }
  return ok;
});

// Estratégia por cabeçalho: decide o filtro pelos 2 primeiros bytes.
function ehZlib(b) {
  return b.length > 1 && (b[0] & 0x0f) === 8 && ((b[0] << 8) | b[1]) % 31 === 0;
}
function ehGzip(b) {
  return b.length > 1 && b[0] === 0x1f && b[1] === 0x8b;
}
cron("B) por cabeçalho (zlib/gzip/raw)", () => {
  let ok = 0;
  for (const { dado } of achados) {
    try {
      if (ehGzip(dado)) {
        const o = inflateSync(dado, { finishFlush: zc.Z_SYNC_FLUSH });
        if (o && o.length) ok++;
      } else if (ehZlib(dado)) {
        const o = inflateSync(dado);
        if (o && o.length) ok++;
      }
    } catch {}
  }
  return ok;
});

// Estratégia pelo dicionário: só infla quem declara FlateDecode.
cron("C) so quem declara /FlateDecode", () => {
  let ok = 0;
  for (const { dict, dado } of achados) {
    if (!/\/FlateDecode/.test(dict)) continue;
    try {
      const o = inflateSync(dado, { finishFlush: zc.Z_SYNC_FLUSH });
      if (o && o.length) ok++;
    } catch {}
  }
  return ok;
});
