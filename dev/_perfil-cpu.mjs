#!/usr/bin/env node
/**
 * _perfil-cpu.mjs — raio-X do parser: quantos tokens, quanto cada etapa custa.
 */

import { performance } from "node:perf_hooks";
import { fetchText } from "../src/fetch.mjs";
import { htmlToMarkdown, extractMeta, extractLinks } from "../src/html-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const url = process.argv[2] || "https://www.theguardian.com/international";
const reps = Number(process.argv[3] || 5);

const { text: html, finalUrl } = await fetchText(url, { retries: 0 });
console.log(`HTML: ${html.length} chars (~${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB)`);

// Quantos tokens? Reimplementa a contagem com o MESMO critério do tokenizer.
function contarTokens(html) {
  let tags = 0, textos = 0, comentarios = 0;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) { textos++; break; }
    if (lt > i) textos++;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt);
      i = end === -1 ? html.length : end + 3;
      comentarios++;
      continue;
    }
    const next = html[lt + 1];
    if (next !== "/" && next !== "!" && next !== "?" && !(next && /[A-Za-z]/.test(next))) {
      textos++; i = lt + 1; continue;
    }
    let quote = null, j = lt + 1;
    for (; j < html.length; j++) {
      const c = html[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    tags++;
    i = j + 1;
  }
  return { tags, textos, comentarios };
}

const t0 = performance.now();
const contagem = contarTokens(html);
console.log(`tokens: ${contagem.tags} tags, ${contagem.textos} textos, ${contagem.comentarios} comentarios (mapa em ${(performance.now() - t0).toFixed(1)}ms)`);

const medir = (fn) => {
  const t = performance.now();
  const r = fn();
  return { ms: performance.now() - t, r };
};

const tempos = { md: [], links: [], meta: [] };
for (let i = 0; i < reps; i++) {
  const md = medir(() => htmlToMarkdown(html, finalUrl, { minCharsEntregaveis: HARD_MAX_CHARS }));
  const lk = medir(() => extractLinks(html, finalUrl));
  const mt = medir(() => extractMeta(html));
  tempos.md.push(md.ms); tempos.links.push(lk.ms); tempos.meta.push(mt.ms);
  if (i === 0) console.log(`markdown -> ${md.r.length} chars`);
}
const med = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const min = (a) => Math.min(...a);
console.log(`\n${"etapa".padEnd(10)} ${"média".padStart(10)} ${"mínimo".padStart(10)}`);
for (const k of ["md", "links", "meta"]) {
  console.log(`${k.padEnd(10)} ${(med(tempos[k]).toFixed(1) + "ms").padStart(10)} ${(min(tempos[k]).toFixed(1) + "ms").padStart(10)}`);
}
const soma = med(tempos.md) + med(tempos.links) + med(tempos.meta);
console.log(`\nsoma CPU   ${soma.toFixed(1)}ms`);
console.log(`markdown   ${((med(tempos.md) / soma) * 100).toFixed(1)}% da CPU`);
console.log(`links      ${((med(tempos.links) / soma) * 100).toFixed(1)}% da CPU`);
console.log(`\nO links tokenizam o HTML INTEIRO uma segunda vez. Se metade disso` );
console.log(`fosse reaproveitada, a economia seria de ~${(med(tempos.links) * 0.85 / soma * 100).toFixed(0)}% da CPU de conversão.`);

// quantos chars por token: mostra se o custo é por token ou por byte
console.log(`\nchars/token: ${(html.length / (contagem.tags + contagem.textos)).toFixed(1)}`);
