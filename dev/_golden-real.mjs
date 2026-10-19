#!/usr/bin/env node
/**
 * _golden-real.mjs — golden de uma página REAL e grande (1,34 MB).
 *
 * O golden de tests/golden/ cobre 20 casos pequenos. Este cobre o que eles não
 * veem: página gigante, com script inline, tabelas, aria-hidden e centenas de
 * tags. Grava a saída de htmlToMarkdown, extractLinks e extractMeta e compara
 * byte a byte. É a rede de segurança das otimizações do parser.
 *
 * Uso:
 *   node dev/_golden-real.mjs            (grava)
 *   node dev/_golden-real.mjs --conferir (compara)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { htmlToMarkdown, extractLinks, extractMeta } from "../src/html-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const DIR = new URL("./_baseline/", import.meta.url);
const URL_BASE = "https://www.theguardian.com/international";
const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");

const conferir = process.argv.includes("--conferir");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

const md = htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
const links = extractLinks(html, URL_BASE);
const meta = extractMeta(html);

const saidas = {
  "md.md": md,
  "links.json": JSON.stringify(links, null, 1),
  "meta.json": JSON.stringify(meta, null, 1),
};

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

if (!conferir) {
  for (const [nome, conteudo] of Object.entries(saidas)) {
    writeFileSync(new URL(nome, DIR), conteudo);
    console.log(`${nome.padEnd(12)} ${String(conteudo.length).padStart(8)} chars  sha=${sha(conteudo)}`);
  }
  console.log("\ngolden real gravado em dev/_baseline/");
} else {
  let falhou = 0;
  for (const [nome, atual] of Object.entries(saidas)) {
    const arq = new URL(nome, DIR);
    if (!existsSync(arq)) {
      console.log(`FALTA ${nome} — grave primeiro sem --conferir`);
      falhou++;
      continue;
    }
    const esperado = readFileSync(arq, "utf8");
    if (esperado === atual) {
      console.log(`OK    ${nome.padEnd(12)} ${atual.length} chars  sha=${sha(atual)}`);
      continue;
    }
    falhou++;
    console.log(`MUDOU ${nome}`);
    console.log(`  antes: ${esperado.length} chars sha=${sha(esperado)}`);
    console.log(`  agora: ${atual.length} chars sha=${sha(atual)}`);
    // Primeira diferença, com contexto — é o que aponta a linha culpada.
    let i = 0;
    while (i < esperado.length && i < atual.length && esperado[i] === atual[i]) i++;
    const ini = Math.max(0, i - 120);
    console.log(`  primeira diferença em ${i}:`);
    console.log(`    antes: ${JSON.stringify(esperado.slice(ini, i + 120))}`);
    console.log(`    agora: ${JSON.stringify(atual.slice(ini, i + 120))}`);
  }
  console.log(falhou === 0 ? "\nGOLDEN OK — saída idêntica" : `\nGOLDEN FALHOU — ${falhou} arquivo(s) mudaram`);
  process.exit(falhou === 0 ? 0 : 1);
}
