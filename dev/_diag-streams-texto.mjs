#!/usr/bin/env node
/**
 * _diag-streams-texto.mjs — quais streams ENTREGAM texto, e por que a
 * heurística por dicionário errou em alguns deles.
 *
 * Contexto: a troca de "tenta 3 filtros em tudo" por "decide pelo dicionário"
 * ficou 9x mais rápida, mas perdeu 1.352 caracteres no arxiv. Aqui a gente
 * isola: para cada stream, compara o que a estratégia ANTIGA produz (inflar
 * por cabeçalho, com fallback para o dado cru) com o que a NOVA produz, e
 * mostra o dicionário dos que divergem.
 *
 * Uso: node dev/_diag-streams-texto.mjs [url]
 */
import { inflateSync, inflateRawSync, gunzipSync, constants as zc } from "node:zlib";

const URL_PDF = process.argv[2] || "https://arxiv.org/pdf/1706.03762";

const res = await fetch(URL_PDF, {
  headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0" },
  signal: AbortSignal.timeout(120000),
});
const buffer = Buffer.from(await res.arrayBuffer());
console.log(`PDF: ${(buffer.length / 1024).toFixed(0)} KB\n`);

const inicio = Buffer.from("stream");
const fim = Buffer.from("endstream");

function ehZlib(b) {
  return b.length > 1 && (b[0] & 0x0f) === 8 && (((b[0] << 8) | b[1]) % 31) === 0;
}
function ehGzip(b) {
  return b.length > 1 && b[0] === 0x1f && b[1] === 0x8b;
}
function inflarPorCabecalho(buf) {
  if (!buf || buf.length < 2) return null;
  try {
    if (ehGzip(buf)) return gunzipSync(buf, { finishFlush: zc.Z_SYNC_FLUSH });
    if (ehZlib(buf)) return inflateSync(buf, { finishFlush: zc.Z_SYNC_FLUSH });
    return inflateRawSync(buf, { finishFlush: zc.Z_SYNC_FLUSH });
  } catch {
    return null;
  }
}
function inflarTresEmTudo(buf) {
  for (const fn of [inflateSync, inflateRawSync, gunzipSync]) {
    try {
      const o = fn(buf);
      if (o && o.length) return o;
    } catch {}
  }
  return null;
}
const ehContent = (t) => t.includes("BT") && (t.includes("Tj") || t.includes("TJ"));

let i = 0;
let n = 0;
let comTextoAntigo = 0;
let comTextoNovo = 0;
const perdidos = [];

while (i < buffer.length) {
  const s = buffer.indexOf(inicio, i);
  if (s === -1) break;
  const e = buffer.indexOf(fim, s + inicio.length);
  if (e === -1) break;
  let ini = s + inicio.length;
  if (buffer[ini] === 0x0d) ini++;
  if (buffer[ini] === 0x0a) ini++;
  const dado = buffer.subarray(ini, e);
  n++;

  // dicionário: janela de 512 (o que a versão nova usa) e janela larga (2048)
  const dict512 = buffer.subarray(Math.max(0, s - 512), s).toString("latin1");
  const dictLargo = buffer.subarray(Math.max(0, s - 2048), s).toString("latin1");

  // ANTIGA: tenta 3 filtros; se nada, usa cru
  const dadoAntigo = inflarTresEmTudo(dado) || dado;
  const temAntigo = ehContent(dadoAntigo.toString("latin1"));

  // NOVA: decide pelo dicionário de 512
  const declaraFlate = dict512.includes("/FlateDecode");
  const declaraSemFiltro = !/\/Filter\s/.test(dict512);
  let dadoNovo = dado;
  if (declaraFlate || !declaraSemFiltro) {
    if (ehZlib(dado) || ehGzip(dado) || declaraFlate) {
      const inf = inflarPorCabecalho(dado);
      if (inf) dadoNovo = inf;
    }
  }
  const temNovo = ehContent(dadoNovo.toString("latin1"));

  if (temAntigo) comTextoAntigo++;
  if (temNovo) comTextoNovo++;
  if (temAntigo && !temNovo) {
    perdidos.push({
      n,
      tamanho: dado.length,
      cabecalho: [...dado.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(" "),
      declaraFlate,
      declaraSemFiltro,
      temFilterLargo: /\/Filter\s/.test(dictLargo),
      dist: dict512.length,
      dict: dict512.slice(-200).replace(/\s+/g, " ").trim(),
    });
  }
  i = e + fim.length;
}

console.log(`streams: ${n}`);
console.log(`content streams ANTIGA: ${comTextoAntigo}`);
console.log(`content streams NOVA:   ${comTextoNovo}`);
console.log(`PERDIDOS: ${perdidos.length}\n`);

for (const p of perdidos.slice(0, 8)) {
  console.log(`--- stream #${p.n} | ${p.tamanho} bytes | cabeçalho ${p.cabecalho}`);
  console.log(`    declaraFlate=${p.declaraFlate} declaraSemFiltro=${p.declaraSemFiltro} temFilterLargo=${p.temFilterLargo}`);
  console.log(`    dict: ...${p.dict.slice(-160)}`);
}
