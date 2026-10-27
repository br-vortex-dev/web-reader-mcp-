#!/usr/bin/env node
/**
 * _ab-total.mjs — ganho TOTAL desta sessão: HEAD (antes de qualquer mudança)
 * contra src/ atual, nos três caminhos reais que usam o parser.
 *
 *   read_page   extractMeta + htmlToMarkdown (markdown só, com parada antecipada)
 *   multi/crawl extractMeta + htmlToMarkdownComLinks (markdown + links)
 *   extract_links isolado (extractLinks)
 *
 * Intercalado, mínimo de amostras, com conferência de saída idêntica.
 */
import { readFileSync } from "node:fs";
import * as novo from "../src/html-parser.mjs";
import * as antes from "./_head-sessao.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");
const BASE = "https://www.theguardian.com/international";
const opcoes = { minCharsEntregaveis: HARD_MAX_CHARS };

const comboAntes = antes.htmlToMarkdownComLinks(html, BASE, opcoes);
const comboNovo = novo.htmlToMarkdownComLinks(html, BASE, opcoes);
const mdAntes = antes.htmlToMarkdown(html, BASE, opcoes);
const mdNovo = novo.htmlToMarkdown(html, BASE, opcoes);
const linksAntes = antes.extractLinks(html, BASE);
const linksNovo = novo.extractLinks(html, BASE);
const metaAntes = antes.extractMeta(html);
const metaNovo = novo.extractMeta(html);

const igual = {
  markdown: mdAntes === mdNovo && mdAntes === comboAntes.markdown && mdNovo === comboNovo.markdown,
  links: JSON.stringify(linksAntes) === JSON.stringify(linksNovo) &&
    JSON.stringify(comboAntes.links) === JSON.stringify(comboNovo.links),
  meta: JSON.stringify(metaAntes) === JSON.stringify(metaNovo),
};
console.log(`saídas idênticas: markdown=${igual.markdown ? "SIM" : "NÃO"} ` +
  `links=${igual.links ? "SIM" : "NÃO"} meta=${igual.meta ? "SIM" : "NÃO"} ` +
  `(${mdNovo.length} chars, ${linksNovo.length} links)`);
if (!igual.markdown || !igual.links || !igual.meta) process.exitCode = 1;

function cpuMs(fn) {
  const antesCpu = process.cpuUsage();
  fn();
  const d = process.cpuUsage(antesCpu);
  return (d.user + d.system) / 1000;
}

const caminhos = {
  "markdown só": {
    velho: () => antes.htmlToMarkdown(html, BASE, opcoes),
    novo: () => novo.htmlToMarkdown(html, BASE, opcoes),
  },
  "meta só": {
    velho: () => antes.extractMeta(html),
    novo: () => novo.extractMeta(html),
  },
  read_page: {
    velho: () => { antes.extractMeta(html); antes.htmlToMarkdown(html, BASE, opcoes); },
    novo: () => { novo.extractMeta(html); novo.htmlToMarkdown(html, BASE, opcoes); },
  },
  "multi/crawl": {
    velho: () => { antes.extractMeta(html); antes.htmlToMarkdownComLinks(html, BASE, opcoes); },
    novo: () => { novo.extractMeta(html); novo.htmlToMarkdownComLinks(html, BASE, opcoes); },
  },
  extract_links: {
    velho: () => antes.extractLinks(html, BASE),
    novo: () => novo.extractLinks(html, BASE),
  },
};

function medir(velho, novoFn, lote = 100, rodadas = 6) {
  for (let i = 0; i < 5; i++) { velho(); novoFn(); }
  const a = [], b = [];
  for (let r = 0; r < rodadas; r++) {
    const par = r % 2 === 0
      ? [velho, novoFn]
      : [novoFn, velho];
    const primeiro = cpuMs(() => { for (let i = 0; i < lote; i++) par[0](); }) / lote;
    const segundo = cpuMs(() => { for (let i = 0; i < lote; i++) par[1](); }) / lote;
    if (r % 2 === 0) { a.push(primeiro); b.push(segundo); } else { b.push(primeiro); a.push(segundo); }
  }
  return { antes: Math.min(...a), depois: Math.min(...b) };
}

const fmt = (x) => x.toFixed(2).padStart(7);
const ganho = (a, b) => `${(((a - b) / a) * 100).toFixed(1)}%`;
console.log(`\n6 rodadas de 100 execuções | mínimo de cada versão`);
console.log(`                        HEAD    agora   ganho`);
for (const [nome, par] of Object.entries(caminhos)) {
  const r = medir(par.velho, par.novo);
  console.log(`${nome.padEnd(20)} ${fmt(r.antes)} ${fmt(r.depois)}   ${ganho(r.antes, r.depois)}`);
}
