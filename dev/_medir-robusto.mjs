#!/usr/bin/env node
/**
 * _medir-robusto.mjs — medição resistente a ruído da máquina.
 *
 * O problema: uma rodada isolada oscila muito (antivírus, indexação, GC,
 * outro processo). Medir "antes" e "depois" em momentos diferentes compara
 * cargas diferentes, não códigos diferentes.
 *
 * A solução aqui: roda N blocos, e em cada bloco mede as etapas vária vezes,
 * descarta o melhor e o pior e usa a MEDIANA. Usa `extractMeta` como
 * TERMÔMETRO: é uma etapa que nenhuma otimização toca, então a variação dela
 * mede o ruído da máquina naquele momento.
 *
 * Uso: node dev/_medir-robusto.mjs [blocos]
 */

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { htmlToMarkdown, extractLinks, extractMeta } from "../src/html-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const BLOCOS = Number(process.argv[2] || 5);
const URL_BASE = "https://www.theguardian.com/international";
const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");
const mb = Buffer.byteLength(html) / 1048576;

const mediana = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Aquece o JIT uma vez.
for (let i = 0; i < 4; i++) {
  htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
  extractLinks(html, URL_BASE);
  extractMeta(html);
}

const blocos = [];
for (let b = 0; b < BLOCOS; b++) {
  const md = [], lk = [], mt = [];
  for (let i = 0; i < 5; i++) {
    let t = performance.now();
    htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
    md.push(performance.now() - t);

    t = performance.now();
    extractLinks(html, URL_BASE);
    lk.push(performance.now() - t);

    t = performance.now();
    extractMeta(html);
    mt.push(performance.now() - t);
  }
  // Descarta o melhor e o pior de cada etapa: sobra o miolo estável.
  const semExtremos = (a) => a.slice().sort((x, y) => x - y).slice(1, -1);
  const bloco = {
    md: mediana(semExtremos(md)),
    links: mediana(semExtremos(lk)),
    meta: mediana(semExtremos(mt)),
  };
  bloco.total = bloco.md + bloco.links + bloco.meta;
  blocos.push(bloco);
  console.log(
    `bloco ${b + 1}: md ${bloco.md.toFixed(1)}ms  links ${bloco.links.toFixed(1)}ms  meta ${bloco.meta.toFixed(1)}ms  total ${bloco.total.toFixed(1)}ms`
  );
}

const final = {
  md: mediana(blocos.map((b) => b.md)),
  links: mediana(blocos.map((b) => b.links)),
  meta: mediana(blocos.map((b) => b.meta)),
};
final.total = final.md + final.links + final.meta;

console.log(`\n=== mediana de ${BLOCOS} blocos ===`);
console.log(`md      ${final.md.toFixed(1).padStart(8)}ms   ${(mb / (final.md / 1000)).toFixed(2)} MB/s`);
console.log(`links   ${final.links.toFixed(1).padStart(8)}ms`);
console.log(`meta    ${final.meta.toFixed(1).padStart(8)}ms   <- termômetro do ruído`);
console.log(`total   ${final.total.toFixed(1).padStart(8)}ms`);
console.log(`\ntermômetro: meta entre blocos variou de ${Math.min(...blocos.map((b) => b.meta)).toFixed(1)} a ${Math.max(...blocos.map((b) => b.meta)).toFixed(1)}ms`);
console.log(`(se essa faixa for larga, a máquina estava instável nesta medição)`);
