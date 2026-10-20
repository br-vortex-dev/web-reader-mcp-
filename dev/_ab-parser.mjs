#!/usr/bin/env node
/**
 * _ab-parser.mjs — A/B do parser no MESMO processo e na MESMA máquina.
 *
 * Comparar duas versões medindo uma hoje e outra amanhã compara cargas
 * diferentes. Aqui as duas ficam carregadas juntas e se alternam em rodadas:
 * a cada bloco, mede A, mede B, mede A, mede B... O mínimo por versão é a
 * rodada em que nada externo atrapalhou.
 *
 * Uso: node dev/_ab-parser.mjs [rodadas] [lote]
 */
import { readFileSync } from "node:fs";
import { HARD_MAX_CHARS } from "../src/config.mjs";
import * as novo from "../src/html-parser.mjs";
import * as velho from "./_head-parser.mjs";

const RODADAS = Number(process.argv[2] || 6);
const LOTE = Number(process.argv[3] || 8);
const URL_BASE = "https://www.theguardian.com/international";
const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");

function cpuMs(fn) {
  const antes = process.cpuUsage();
  fn();
  const d = process.cpuUsage(antes);
  return (d.user + d.system) / 1000;
}

// Sanidade: as duas versões PRECISAM produzir o mesmo texto.
const a = novo.htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
const b = velho.htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
console.log(`saída idêntica: ${a === b ? "SIM" : "NÃO"} (${a.length} vs ${b.length} chars)`);
if (a !== b) process.exitCode = 1;

const mdNovo = () => novo.htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
const mdVelho = () => velho.htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
const lkNovo = () => novo.extractLinks(html, URL_BASE);
const lkVelho = () => velho.extractLinks(html, URL_BASE);

for (let i = 0; i < 4; i++) { mdNovo(); mdVelho(); lkNovo(); lkVelho(); }

const nMd = [], vMd = [], nLk = [], vLk = [];
for (let r = 0; r < RODADAS; r++) {
  nMd.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) mdNovo(); }) / LOTE);
  vMd.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) mdVelho(); }) / LOTE);
  nLk.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) lkNovo(); }) / LOTE);
  vLk.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) lkVelho(); }) / LOTE);
}

const min = (x) => Math.min(...x);
const fmt = (n) => n.toFixed(1).padStart(7);
const ganho = (v, n) => `${(((v - n) / v) * 100).toFixed(1)}%`;

console.log(`\n${RODADAS} rodadas de ${LOTE} conversões | mínimo de cada versão`);
console.log(`          baseline   novo   ganho`);
console.log(`md        ${fmt(min(vMd))}  ${fmt(min(nMd))}   ${ganho(min(vMd), min(nMd))}`);
console.log(`links     ${fmt(min(vLk))}  ${fmt(min(nLk))}   ${ganho(min(vLk), min(nLk))}`);
console.log(`\nJSON ${JSON.stringify({
  md_base: +min(vMd).toFixed(1), md_novo: +min(nMd).toFixed(1),
  links_base: +min(vLk).toFixed(1), links_novo: +min(nLk).toFixed(1),
})}`);
