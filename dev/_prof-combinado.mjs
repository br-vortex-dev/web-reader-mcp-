#!/usr/bin/env node
/**
 * _prof-combinado.mjs — carga local do caminho real do read_page para o
 * --cpu-prof: htmlToMarkdownComLinks (markdown + links, com parada
 * antecipada), sem rede e sem extractMeta.
 *
 * Uso: node --cpu-prof --cpu-prof-dir=dev/_prof dev/_prof-combinado.mjs [voltas]
 */
import { readFileSync } from "node:fs";
import { htmlToMarkdown, htmlToMarkdownComLinks } from "../src/html-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");
const URL_BASE = "https://www.theguardian.com/international";
const VOLTAS = Number(process.argv[2] || 60);
// "sem-links" = caminho do read_page; padrão = caminho do crawl/multi.
const semLinks = process.argv[3] === "sem-links";
const rodada = semLinks
  ? () => htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS })
  : () => htmlToMarkdownComLinks(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });

for (let i = 0; i < 5; i++) rodada();
for (let i = 0; i < VOLTAS; i++) rodada();
console.log(`feito: ${VOLTAS} voltas de ${semLinks ? "markdown (sem links)" : "markdown+links"}`);
