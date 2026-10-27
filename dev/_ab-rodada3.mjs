#!/usr/bin/env node
/**
 * _ab-rodada3.mjs — A/B da rodada 3 contra o snapshot da versão anterior
 * (dev/_ab-batch2-parser.mjs): extractMeta com varredura manual e as
 * micro-otimizações do consumidor.
 *
 * Confere saída idêntica em casos sintéticos de meta (maiúsculas mistas,
 * "metadata", tag sem fecho, ">" dentro de valor) e na página real, e mede o
 * pipeline local do read_page (meta + markdown) intercalado.
 */
import { readFileSync } from "node:fs";
import * as novo from "../src/html-parser.mjs";
import * as velho from "./_ab-batch2-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");
const BASE = "https://www.theguardian.com/international";
const opcoes = { minCharsEntregaveis: HARD_MAX_CHARS };

const sinteticos = [
  `<html><head><title>T</title><META NAME="description" CONTENT="Maiúscula"><Meta property="og:title" content="Mista"><meta name="author" content="Ana"><meta property="article:published_time" content="2026-01-02T03:04:05Z"></head></html>`,
  `<metadata name="description" content="nao e meta"><meta data-x="1" name="description" content="certa"><meta name="description" content="segunda ignorada"></html>`,
  `<meta name="description" content="a>b"><meta property="og:title" content="t"><meta`,
  `<META\nNAME='description'\nCONTENT='quebrada'><meta property="og:title"><meta name="author" content="  ">`,
  `<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=utf-8"><meta name="description" content="d &amp; e">`,
  ``,
];

let metaOk = true;
for (const [i, caso] of sinteticos.entries()) {
  const a = JSON.stringify(velho.extractMeta(caso));
  const b = JSON.stringify(novo.extractMeta(caso));
  if (a !== b) {
    metaOk = false;
    console.log(`meta sintético #${i} DIFERENTE:\n  velho ${a}\n  novo  ${b}`);
  }
}
const metaRealA = JSON.stringify(velho.extractMeta(html));
const metaRealB = JSON.stringify(novo.extractMeta(html));
if (metaRealA !== metaRealB) {
  metaOk = false;
  console.log(`meta real DIFERENTE:\n  velho ${metaRealA}\n  novo  ${metaRealB}`);
}
console.log(`extractMeta idêntico: ${metaOk ? "SIM" : "NÃO"} (${sinteticos.length} sintéticos + página real)`);
if (!metaOk) process.exitCode = 1;

const mdVelho = velho.htmlToMarkdown(html, BASE, opcoes);
const mdNovo = novo.htmlToMarkdown(html, BASE, opcoes);
const mdOk = mdVelho === mdNovo;
console.log(`markdown idêntico: ${mdOk ? "SIM" : "NÃO"} (${mdNovo.length} chars)`);
if (!mdOk) process.exitCode = 1;

function cpuMs(fn) {
  const antes = process.cpuUsage();
  fn();
  const d = process.cpuUsage(antes);
  return (d.user + d.system) / 1000;
}

const rodaVelho = () => {
  velho.extractMeta(html);
  velho.htmlToMarkdown(html, BASE, opcoes);
};
const rodaNovo = () => {
  novo.extractMeta(html);
  novo.htmlToMarkdown(html, BASE, opcoes);
};

for (let i = 0; i < 4; i++) { rodaVelho(); rodaNovo(); }

const LOTE = 6, RODADAS = 12;
const a = [], b = [];
for (let r = 0; r < RODADAS; r++) {
  a.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) rodaVelho(); }) / LOTE);
  b.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) rodaNovo(); }) / LOTE);
}

const min = (x) => Math.min(...x);
const fmt = (x) => x.toFixed(2).padStart(7);
const ganho = (antes, depois) => `${(((antes - depois) / antes) * 100).toFixed(1)}%`;
console.log(`\n${RODADAS} rodadas de ${LOTE} pipelines | mínimo de cada versão`);
console.log(`                  antes   novo   ganho`);
console.log(`meta+markdown ${fmt(min(a))} ${fmt(min(b))}   ${ganho(min(a), min(b))}`);
