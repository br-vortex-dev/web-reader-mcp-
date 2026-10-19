#!/usr/bin/env node
/**
 * _prof-run.mjs — carga local repetida para o --cpu-prof.
 * Usa um HTML já gravado em disco (dev/_prof.html) para medir SÓ a CPU,
 * sem ruído de rede.
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { htmlToMarkdown, extractLinks, extractMeta } from "../src/html-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";
import { fetchText } from "../src/fetch.mjs";

const ARQ = new URL("./_prof.html", import.meta.url);
const URL_ALVO = process.argv[2] || "https://www.theguardian.com/international";
const VOLTAS = Number(process.argv[3] || 12);

let html;
if (existsSync(ARQ)) {
  html = readFileSync(ARQ, "utf8");
  console.log(`HTML local: ${html.length} chars`);
} else {
  console.log("baixando uma vez...");
  const r = await fetchText(URL_ALVO, { retries: 0 });
  html = r.text;
  writeFileSync(ARQ, html);
  console.log(`HTML gravado: ${html.length} chars`);
}

const base = URL_ALVO;

// Aquece o JIT antes de medir: as primeiras voltas pagam compilação.
for (let i = 0; i < 3; i++) {
  htmlToMarkdown(html, base, { minCharsEntregaveis: HARD_MAX_CHARS });
  extractLinks(html, base);
  extractMeta(html);
}

for (let i = 0; i < VOLTAS; i++) {
  htmlToMarkdown(html, base, { minCharsEntregaveis: HARD_MAX_CHARS });
  extractLinks(html, base);
  extractMeta(html);
}
console.log(`feito: ${VOLTAS} voltas de md+links+meta`);
