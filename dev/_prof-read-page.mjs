#!/usr/bin/env node
/**
 * _prof-read-page.mjs — carga do pipeline LOCAL do read_page (sem rede):
 * extractMeta + htmlToMarkdown com a parada antecipada, como tools.mjs faz.
 *
 * Uso: node --cpu-prof --cpu-prof-dir=dev/_prof dev/_prof-read-page.mjs [voltas]
 */
import { readFileSync } from "node:fs";
import { extractMeta, htmlToMarkdown } from "../src/html-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");
const BASE = "https://www.theguardian.com/international";
const VOLTAS = Number(process.argv[2] || 60);

const rodada = () => {
  extractMeta(html);
  htmlToMarkdown(html, BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
};

for (let i = 0; i < 5; i++) rodada();
for (let i = 0; i < VOLTAS; i++) rodada();
console.log(`feito: ${VOLTAS} voltas de meta+markdown`);
