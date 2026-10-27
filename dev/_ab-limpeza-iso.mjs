#!/usr/bin/env node
/**
 * _ab-limpeza-iso.mjs — isola os atalhos da limpeza final: parser de antes
 * (dev/_pre-limpeza.mjs) contra src/ atual, no MESMO processo, intercalado.
 *
 * Uso: node dev/_ab-limpeza-iso.mjs [rodadas]
 */
import { readFileSync } from "node:fs";
import * as novo from "../src/html-parser.mjs";
import * as antes from "./_pre-limpeza.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const BASE = "https://www.theguardian.com/international";
const opcoes = { minCharsEntregaveis: HARD_MAX_CHARS };

const real = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");
const textoGigante = `<!DOCTYPE html><html><head><title>Pagina pesada</title></head><body><h1>Pagina pesada</h1><p>REQ-1</p><p>${"x".repeat(1400000)}</p></body></html>`;
const limpezaPesada = ("<html><body><p>[ ] a\tb  c\r\n</p><pre><code>```\nconst a = 1;\n```\n</code></pre>" +
  "<p>[ | ] utm https://x.test/?utm_source=a</p>\n\n\n\n<a href=\"#x\">Skip to content</a>").repeat(3000);
const tagPesado = '<div class="x" data-a="1"><span>texto</span></div>'.repeat(22000);

const casos = [
  ["guardian 1,4 MB", real, opcoes],
  ["texto gigante 1,4 MB", textoGigante, opcoes],
  ["limpeza pesada 0,4 MB", limpezaPesada, opcoes],
  ["só tags 1,3 MB", tagPesado, opcoes],
];

let falhas = 0;
for (const [nome, html, op] of casos) {
  const a = antes.htmlToMarkdown(html, BASE, op);
  const b = novo.htmlToMarkdown(html, BASE, op);
  const ca = antes.htmlToMarkdownComLinks(html, BASE, op);
  const cb = novo.htmlToMarkdownComLinks(html, BASE, op);
  const ok = a === b && ca.markdown === cb.markdown &&
    JSON.stringify(ca.links) === JSON.stringify(cb.links);
  console.log(`${nome}: markdown ${a.length} chars — idêntico: ${ok ? "SIM" : "NÃO"}`);
  if (!ok) falhas++;
}
if (falhas) process.exitCode = 1;

function cpuMs(fn, n) {
  const antesCpu = process.cpuUsage();
  for (let i = 0; i < n; i++) fn();
  const d = process.cpuUsage(antesCpu);
  return (d.user + d.system) / 1000 / n;
}

const RODADAS = Number(process.argv[2] || 7);
console.log(`\n${RODADAS} rodadas | mínimo de cada versão`);
for (const [nome, html, op] of casos) {
  const n = 60;
  const velho = [], atual = [];
  const fVelho = () => antes.htmlToMarkdown(html, BASE, op);
  const fNovo = () => novo.htmlToMarkdown(html, BASE, op);
  for (let i = 0; i < 5; i++) { fVelho(); fNovo(); }
  for (let r = 0; r < RODADAS; r++) {
    velho.push(cpuMs(fVelho, n));
    atual.push(cpuMs(fNovo, n));
  }
  const min = (x) => Math.min(...x);
  const ganho = ((min(velho) - min(atual)) / min(velho)) * 100;
  console.log(`${nome.padEnd(24)} antes ${min(velho).toFixed(2).padStart(7)} ms | agora ${min(atual).toFixed(2).padStart(7)} ms | ${ganho.toFixed(1)}%`);
}
