#!/usr/bin/env node
/**
 * _ab-limpeza-head.mjs — limpeza nova (protegida) contra o parser do HEAD.
 *
 * Páginas sintéticas que exercitam cada gatilho da limpeza final (CRLF, cercas,
 * tab/espaços, colchetes vazios, utm, NUL) + a página real de 1,4 MB.
 * Compara markdown, links e meta byte a byte.
 *
 * Uso: node dev/_ab-limpeza-head.mjs
 */
import { readFileSync } from "node:fs";
import * as novo from "../src/html-parser.mjs";
import * as velho from "./_head-sessao.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const URL_BASE = "https://exemplo.test/base/";

const real = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");

const paginas = [
  ["crlf", "<html><body><h1>T</h1><p>a\r\nb\rc</p></body></html>"],
  ["tabs e espaços", "<html><body><p>a\tb  c \n d\t\t e</p><p>f</p></body></html>"],
  ["cercas", "<html><body><pre><code>const a = 1;\n```\nconst b = 2;\n```\n</code></pre><p>fim</p></body></html>"],
  ["cerca ímpar", "<html><body><h1>T</h1><pre><code>sem fecho\n```\n</code></pre><p>fim</p></body></html>"],
  ["colchetes vazios", "<html><body><p>[ ] checkbox</p><p>[  ] dois</p><p>[ | ] pipe</p><p>[x](https://a.test/) link</p></body></html>"],
  ["colchetes aninhados", "<html><body><p>[ [ ]\n] e [[ | ]\n]</p></body></html>"],
  ["colchetes no código", "<html><body><pre><code>arr[0] = [ ];\n[ | ]\n</code></pre><p>fim</p></body></html>"],
  ["skip to content", "<html><body><a href=\"#main\">Skip to content</a><h1>T</h1></body></html>"],
  ["minha conta", "<html><body><a href=\"https://x.test/conta\">Minha conta</a><h1>T</h1></body></html>"],
  ["utm", "<html><body><a href=\"https://x.test/a?utm_source=z&b=1\">link</a><img src=\"https://x.test/i.png?utm_medium=m\" alt=\"i\"></body></html>"],
  ["nul literal", "<html><body><p>a&#0;0&#0;b</p></body></html>"],
  ["texto gigante", `<html><body><h1>G</h1><p>${"x".repeat(300000)}</p></body></html>`],
  ["texto gigante com colchetes", `<html><body><h1>G</h1><p>${"[x](https://a.test/) ".repeat(20000)}</p></body></html>`],
  ["vazio", ""],
  ["só espaço", "   \n\n\t  "],
];

const opcoesEarly = { minCharsEntregaveis: HARD_MAX_CHARS };

let falhas = 0;
let iguais = 0;
for (const [nome, html] of [...paginas, ["real 1,4 MB", real]]) {
  const mdNovo = novo.htmlToMarkdown(html, URL_BASE, opcoesEarly);
  const mdVelho = velho.htmlToMarkdown(html, URL_BASE, opcoesEarly);
  const clNovo = novo.htmlToMarkdownComLinks(html, URL_BASE, opcoesEarly);
  const clVelho = velho.htmlToMarkdownComLinks(html, URL_BASE, opcoesEarly);
  const linksNovo = JSON.stringify(novo.extractLinks(html, URL_BASE));
  const linksVelho = JSON.stringify(velho.extractLinks(html, URL_BASE));
  const metaNovo = JSON.stringify(novo.extractMeta(html));
  const metaVelho = JSON.stringify(velho.extractMeta(html));

  const ok = mdNovo === mdVelho && clNovo.markdown === clVelho.markdown &&
    JSON.stringify(clNovo.links) === JSON.stringify(clVelho.links) &&
    linksNovo === linksVelho && metaNovo === metaVelho;
  if (ok) iguais++;
  else {
    falhas++;
    console.log(`DIFERENTE: ${nome}`);
    if (mdNovo !== mdVelho) {
      let i = 0;
      while (i < mdNovo.length && i < mdVelho.length && mdNovo[i] === mdVelho[i]) i++;
      console.log(`  markdown diverge em ${i}: novo=${JSON.stringify(mdNovo.slice(i, i + 60))} velho=${JSON.stringify(mdVelho.slice(i, i + 60))}`);
    }
    if (clNovo.markdown !== clVelho.markdown) console.log("  combo markdown difere");
    if (JSON.stringify(clNovo.links) !== JSON.stringify(clVelho.links)) console.log("  combo links diferem");
    if (linksNovo !== linksVelho) console.log("  extractLinks difere");
    if (metaNovo !== metaVelho) console.log(`  meta difere: novo=${metaNovo} velho=${metaVelho}`);
  }
}
console.log(`idênticos: ${iguais}/${paginas.length + 1}${falhas ? ` (${falhas} falhas)` : ""}`);
if (falhas) process.exitCode = 1;
