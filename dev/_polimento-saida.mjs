#!/usr/bin/env node
/**
 * _polimento-saida.mjs — grava ou confere a SAÍDA do parser antes/depois do polimento.
 *
 * A regra do polimento é uma só: o comportamento não pode mudar. Este script
 * prova isso de duas formas:
 *
 *   1. Gera o resultado de `htmlToMarkdown`, `extractLinks` e `extractMeta`
 *      sobre um HTML real (dev/_prof.html) e grava em disco.
 *   2. Numa segunda execução, compara com o gravado e diz se mudou algum byte.
 *
 * Uso:
 *   node dev/_polimento-saida.mjs gravar    (antes do polimento)
 *   node dev/_polimento-saida.mjs conferir  (depois do polimento)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { htmlToMarkdown, extractLinks, extractMeta } from "../src/html-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const MODO = process.argv[2] || "conferir";
const URL_BASE = "https://www.theguardian.com/international";
const ARQUIVO = new URL("./_polimento-saida.json", import.meta.url);

const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");

function retrato() {
  const md = htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
  const links = extractLinks(html, URL_BASE);
  const meta = extractMeta(html);
  const texto = JSON.stringify({ md, links, meta });
  return {
    md_chars: md.length,
    links: links.length,
    meta_chaves: Object.keys(meta).length,
    sha256: createHash("sha256").update(texto).digest("hex"),
    saida: { md, links, meta },
  };
}

const agora = retrato();

if (MODO === "gravar") {
  writeFileSync(ARQUIVO, JSON.stringify(agora, null, 2));
  console.log(`gravado: md ${agora.md_chars} chars, links ${agora.links}, meta ${agora.meta_chaves} campos`);
  console.log(`sha256 ${agora.sha256}`);
  process.exit(0);
}

if (!existsSync(ARQUIVO)) {
  console.error("nada gravado ainda: rode primeiro com 'gravar'");
  process.exit(2);
}

const antes = JSON.parse(readFileSync(ARQUIVO, "utf8"));
const igual = antes.sha256 === agora.sha256;

console.log(`antes:   sha256 ${antes.sha256}`);
console.log(`agora:   sha256 ${agora.sha256}`);
console.log(
  `tamanhos: md ${antes.md_chars} -> ${agora.md_chars} | links ${antes.links} -> ${agora.links} | meta ${antes.meta_chaves} -> ${agora.meta_chaves}`,
);

if (!igual) {
  // Aponta o PRIMEIRO ponto em que a saída divergiu: dá pista de onde olhar.
  const a = antes.saida.md;
  const b = agora.saida.md;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.error(`\nDIVERGIU no caractere ${i}`);
  console.error(`  antes: ...${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))}`);
  console.error(`  agora: ...${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`);
  process.exit(1);
}

console.log("\nOK: saída idêntica byte a byte.");
