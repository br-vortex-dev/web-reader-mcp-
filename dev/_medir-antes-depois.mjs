#!/usr/bin/env node
/**
 * _medir-antes-depois.mjs — mede o ganho da passada única, intercalado.
 *
 * Compara o MESMO código consigo mesmo, mudando só a estratégia de varredura:
 *
 *   ANTES: htmlToMarkdown + extractLinks + extractMeta
 *          (duas tokenizações completas do HTML)
 *   DEPOIS: htmlToMarkdownComLinks + extractMeta
 *          (uma tokenização produz markdown e links)
 *
 * Por que intercalar: rodar duas medições separadas e comparar os números
 * engana. A máquina tem antivírus e indexação; a mesma versão deste parser já
 * variou de 41 a 107 ms entre execuções (o `_medir-cpu.mjs` documenta isso).
 * Medindo original/atual nas mesmas amostras e pegando o MÍNIMO de cada lado,
 * as duas estratégias enfrentam o mesmo ruído.
 *
 * Não usa dev/_baseline/src: aquela cópia é anterior à parada antecipada, e
 * comparar com ela mediria outra coisa (conversão completa vs prefixo).
 *
 * Uso: node dev/_medir-antes-depois.mjs [amostras] [lote]
 */

import { readFileSync } from "node:fs";
import {
  htmlToMarkdown,
  htmlToMarkdownComLinks,
  extractLinks,
  extractMeta,
} from "../src/html-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const AMOSTRAS = Number(process.argv[2] || 11);
const LOTE = Number(process.argv[3] || 8);
const URL_BASE = "https://www.theguardian.com/international";
const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");
const mb = Buffer.byteLength(html) / 1048576;
const OPCOES = { minCharsEntregaveis: HARD_MAX_CHARS };

function cpuMs(fn) {
  const antes = process.cpuUsage();
  fn();
  const d = process.cpuUsage(antes);
  return (d.user + d.system) / 1000;
}

const antesLeitura = () => {
  htmlToMarkdown(html, URL_BASE, OPCOES);
  extractLinks(html, URL_BASE);
  extractMeta(html);
};
const depoisLeitura = () => {
  htmlToMarkdownComLinks(html, URL_BASE, OPCOES);
  extractMeta(html);
};

// A saída tem de ser a mesma: ganho que muda o resultado não vale.
const canon = (ls) => ls.map((l) => `${l.href}\u0000${l.text}\u0000${l.internal}`).join("\u0001");
const mdA = htmlToMarkdown(html, URL_BASE, OPCOES);
const lkA = extractLinks(html, URL_BASE);
const novo = htmlToMarkdownComLinks(html, URL_BASE, OPCOES);
if (mdA !== novo.markdown || canon(lkA) !== canon(novo.links)) {
  console.error("ABORTANDO: a passada única não reproduz a saída de duas funções.");
  process.exit(1);
}
console.log(
  `saída conferida: ${novo.markdown.length} chars de markdown, ${novo.links.length} links (idênticos)\n`
);

for (let i = 0; i < 5; i++) {
  antesLeitura();
  depoisLeitura();
}

const aAntes = [], aDepois = [];
// Intercalado: uma amostra de cada, alternando. Se a máquina ficar mais lenta
// no meio da execução, as duas estratégias pagam a mesma penalidade.
for (let a = 0; a < AMOSTRAS; a++) {
  aAntes.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) antesLeitura(); }) / LOTE);
  aDepois.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) depoisLeitura(); }) / LOTE);
}

const min = (a) => Math.min(...a);
const mediana = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const antes = min(aAntes);
const depois = min(aDepois);
const ganho = antes / depois;

console.log(`HTML ${mb.toFixed(2)} MB | ${AMOSTRAS} amostras de ${LOTE} leituras, intercaladas\n`);
console.log(`${"estratégia".padEnd(34)} ${"mínimo".padStart(10)} ${"mediana".padStart(10)}`);
console.log(`${"duas varreduras (antes)".padEnd(34)} ${(antes.toFixed(1) + "ms").padStart(10)} ${(mediana(aAntes).toFixed(1) + "ms").padStart(10)}`);
console.log(`${"varredura única (agora)".padEnd(34)} ${(depois.toFixed(1) + "ms").padStart(10)} ${(mediana(aDepois).toFixed(1) + "ms").padStart(10)}`);

console.log(
  `\nGANHO: ${antes.toFixed(1)}ms -> ${depois.toFixed(1)}ms = ${ganho.toFixed(2)}x ` +
    `(${Math.round((1 - depois / antes) * 100)}% menos CPU por leitura)`
);
console.log(`vazão: ${(mb / (antes / 1000)).toFixed(1)} MB/s -> ${(mb / (depois / 1000)).toFixed(1)} MB/s`);
console.log(
  `\nJSON ${JSON.stringify({ antes_ms: +antes.toFixed(1), depois_ms: +depois.toFixed(1), ganho: +ganho.toFixed(2) })}`
);
