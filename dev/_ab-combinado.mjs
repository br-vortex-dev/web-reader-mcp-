#!/usr/bin/env node
/**
 * _ab-combinado.mjs — A/B do caminho REAL do read_page.
 *
 * Mede `htmlToMarkdownComLinks` (markdown + links numa passada) com a parada
 * antecipada do teto de saída — o mesmo uso de src/tools.mjs — contra a
 * versão anterior (dev/_head-parser.mjs) no MESMO processo, alternando as
 * duas a cada rodada. Também confere que markdown E links saem idênticos.
 *
 * Uso: node dev/_ab-combinado.mjs [rodadas] [lote]
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

const opcoes = () => ({ minCharsEntregaveis: HARD_MAX_CHARS });

const diagNovo = { interrompida: false };
const diagVelho = { interrompida: false };
const a = novo.htmlToMarkdownComLinks(html, URL_BASE, { ...opcoes(), diagnostico: diagNovo });
const b = velho.htmlToMarkdownComLinks(html, URL_BASE, { ...opcoes(), diagnostico: diagVelho });

const linksNovo = JSON.stringify(a.links);
const linksVelho = JSON.stringify(b.links);
console.log(`markdown idêntico: ${a.markdown === b.markdown ? "SIM" : "NÃO"} (${a.markdown.length} vs ${b.markdown.length} chars)`);
console.log(`links idênticos:   ${linksNovo === linksVelho ? "SIM" : "NÃO"} (${a.links.length} vs ${b.links.length} links)`);
console.log(`parada antecipada: novo=${diagNovo.interrompida} velho=${diagVelho.interrompida}`);
if (a.markdown !== b.markdown || linksNovo !== linksVelho) process.exitCode = 1;

const comboNovo = () => novo.htmlToMarkdownComLinks(html, URL_BASE, opcoes());
const comboVelho = () => velho.htmlToMarkdownComLinks(html, URL_BASE, opcoes());

for (let i = 0; i < 4; i++) { comboNovo(); comboVelho(); }

const n = [], v = [];
for (let r = 0; r < RODADAS; r++) {
  n.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) comboNovo(); }) / LOTE);
  v.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) comboVelho(); }) / LOTE);
}

const min = (x) => Math.min(...x);
const fmt = (x) => x.toFixed(1).padStart(7);
const ganho = (antes, depois) => `${(((antes - depois) / antes) * 100).toFixed(1)}%`;

console.log(`\n${RODADAS} rodadas de ${LOTE} conversões | mínimo de cada versão`);
console.log(`                   antes    novo   ganho`);
console.log(`markdown+links  ${fmt(min(v))}  ${fmt(min(n))}   ${ganho(min(v), min(n))}`);
console.log(`\nJSON ${JSON.stringify({
  combinado_antes: +min(v).toFixed(1),
  combinado_novo: +min(n).toFixed(1),
  interrompida: diagNovo.interrompida,
  links: a.links.length,
})}`);
