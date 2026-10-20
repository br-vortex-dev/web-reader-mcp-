#!/usr/bin/env node
/**
 * _medir-versao.mjs — mede UMA versão do parser por processo.
 *
 * Por que processo separado: carregar as duas versões no mesmo processo
 * (dev/_ab-parser.mjs) contamina o JIT — a função que já foi otimizada
 * (inline cache, hidden classes) tem vantagem, e o resultado passa a medir
 * "qual cópia o motor gostou mais", não qual código é mais rápido. Aqui cada
 * processo carrega só uma versão; quem compara é o chamador, alternando.
 *
 * Uso: node dev/_medir-versao.mjs <head|novo> [rodadas] [lote]
 * Imprime só o JSON, para o chamador somar.
 */
import { readFileSync } from "node:fs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const qual = process.argv[2] || "novo";
const RODADAS = Number(process.argv[3] || 6);
const LOTE = Number(process.argv[4] || 8);

const mod =
  qual === "head"
    ? await import("./_head-parser.mjs")
    : await import("../src/html-parser.mjs");

const URL_BASE = "https://www.theguardian.com/international";
const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");

function cpuMs(fn) {
  const antes = process.cpuUsage();
  fn();
  const d = process.cpuUsage(antes);
  return (d.user + d.system) / 1000;
}

const umMd = () => mod.htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
const umLinks = () => mod.extractLinks(html, URL_BASE);
const umMeta = () => mod.extractMeta(html);

for (let i = 0; i < 6; i++) { umMd(); umLinks(); umMeta(); }

const md = [], lk = [], mt = [];
for (let r = 0; r < RODADAS; r++) {
  md.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) umMd(); }) / LOTE);
  lk.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) umLinks(); }) / LOTE);
  mt.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) umMeta(); }) / LOTE);
}

const min = (a) => Math.min(...a);
console.log(JSON.stringify({
  md: +min(md).toFixed(2),
  links: +min(lk).toFixed(2),
  meta: +min(mt).toFixed(3),
}));
