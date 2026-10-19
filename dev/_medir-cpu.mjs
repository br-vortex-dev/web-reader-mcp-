#!/usr/bin/env node
/**
 * _medir-cpu.mjs — comparação de CPU com resolução suficiente.
 *
 * Duas lições que esta ferramenta existe para não repetir:
 *
 * 1. Tempo de PAREDE (`performance.now`) não serve numa máquina com
 *    antivírus/indexação: `extractMeta`, que não foi tocado, variou de 9,5 a
 *    23,1 ms só por carga externa.
 * 2. `process.cpuUsage()` no Windows anda em degraus de ~15,6 ms. Medir UMA
 *    conversão por amostra cai sempre no mesmo degrau — duas versões
 *    diferentes devolvem o mesmo número. Medir por MEDIANA de amostras
 *    pequenas não resolve: a mediana de degraus é um degrau.
 *
 * A solução: cada amostra converte o HTML `LOTE` vezes seguidas. A amostra
 * passa a durar centenas de ms, o degrau vira ruído de 2%, e o valor sai por
 * conversão. O número final é o MÍNIMO entre as amostras — num teste de CPU
 * pura, o mínimo é a melhor estimativa: é a rodada em que nada de fora
 * atrapalhou.
 *
 * Uso: node dev/_medir-cpu.mjs [amostras] [lote]
 */

import { readFileSync } from "node:fs";
import { htmlToMarkdown, extractLinks, extractMeta } from "../src/html-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const AMOSTRAS = Number(process.argv[2] || 7);
const LOTE = Number(process.argv[3] || 8);
const URL_BASE = "https://www.theguardian.com/international";
const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");
const mb = Buffer.byteLength(html) / 1048576;

function cpuMs(fn) {
  const antes = process.cpuUsage();
  fn();
  const d = process.cpuUsage(antes);
  return (d.user + d.system) / 1000;
}

const umMd = () => htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
const umLinks = () => extractLinks(html, URL_BASE);
const umMeta = () => extractMeta(html);

// Aquece o JIT: as primeiras voltas pagam compilação.
for (let i = 0; i < 6; i++) { umMd(); umLinks(); umMeta(); }

const amostrasMd = [], amostrasLinks = [], amostrasMeta = [];
for (let a = 0; a < AMOSTRAS; a++) {
  amostrasMd.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) umMd(); }) / LOTE);
  amostrasLinks.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) umLinks(); }) / LOTE);
  amostrasMeta.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) umMeta(); }) / LOTE);
}

const min = (a) => Math.min(...a);
const mediana = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const m = { md: min(amostrasMd), links: min(amostrasLinks), meta: min(amostrasMeta) };
m.total = m.md + m.links + m.meta;

console.log(`HTML ${mb.toFixed(2)} MB | ${AMOSTRAS} amostras de ${LOTE} conversões cada\n`);
console.log(`md      ${m.md.toFixed(1).padStart(7)}ms   ${(mb / (m.md / 1000)).toFixed(1)} MB/s`);
console.log(`links   ${m.links.toFixed(1).padStart(7)}ms`);
console.log(`meta    ${m.meta.toFixed(1).padStart(7)}ms`);
console.log(`total   ${m.total.toFixed(1).padStart(7)}ms`);

const faixa = (a) => `${min(a).toFixed(1)}..${Math.max(...a).toFixed(1)}`;
console.log(`\ndispersão: md ${faixa(amostrasMd)} | links ${faixa(amostrasLinks)} | meta ${faixa(amostrasMeta)}`);
console.log(`mediana md (para conferir estabilidade): ${mediana(amostrasMd).toFixed(1)}ms`);
console.log(`\nJSON ${JSON.stringify({ md_ms: +m.md.toFixed(1), links_ms: +m.links.toFixed(1), meta_ms: +m.meta.toFixed(1), total_ms: +m.total.toFixed(1), md_mb_s: +(mb / (m.md / 1000)).toFixed(1) })}`);
