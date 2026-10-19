#!/usr/bin/env node
/**
 * _perfil-baseline.mjs — grava os tempos de HOJE para comparar depois.
 *
 * Lê o HTML já baixado (dev/_prof.html), roda N voltas de conversão e grava
 * a mediana por etapa em dev/_baseline-cpu.json. Depois de otimizar, rode de
 * novo com --gravar-depois: o script compara e diz o ganho real.
 *
 * Uso:
 *   node dev/_perfil-baseline.mjs            (mede e grava o baseline)
 *   node dev/_perfil-baseline.mjs --depois   (mede e compara com o baseline)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { htmlToMarkdown, extractLinks, extractMeta } from "../src/html-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const ARQ_HTML = new URL("./_prof.html", import.meta.url);
const ARQ_BASE = new URL("./_baseline-cpu.json", import.meta.url);
const URL_BASE = "https://www.theguardian.com/international";
const VOLTAS = 9;

if (!existsSync(ARQ_HTML)) {
  console.error("falta dev/_prof.html — rode antes: node dev/_prof-run.mjs");
  process.exit(1);
}
const html = readFileSync(ARQ_HTML, "utf8");

const mediana = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Aquece o JIT: as primeiras voltas pagam compilação, não entram na conta.
for (let i = 0; i < 3; i++) {
  htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
  extractLinks(html, URL_BASE);
  extractMeta(html);
}

const md = [], lk = [], mt = [];
let saidaMd = "";
for (let i = 0; i < VOLTAS; i++) {
  let t = performance.now();
  saidaMd = htmlToMarkdown(html, URL_BASE, { minCharsEntregaveis: HARD_MAX_CHARS });
  md.push(performance.now() - t);

  t = performance.now();
  extractLinks(html, URL_BASE);
  lk.push(performance.now() - t);

  t = performance.now();
  extractMeta(html);
  mt.push(performance.now() - t);
}

const mb = Buffer.byteLength(html) / 1048576;
const resultado = {
  quando: new Date().toISOString(),
  html_chars: html.length,
  html_mb: Number(mb.toFixed(2)),
  voltas: VOLTAS,
  md_ms: Number(mediana(md).toFixed(1)),
  links_ms: Number(mediana(lk).toFixed(1)),
  meta_ms: Number(mediana(mt).toFixed(1)),
  md_mb_s: Number((mb / (mediana(md) / 1000)).toFixed(2)),
  saida_md_chars: saidaMd.length,
};
resultado.cpu_total_ms = Number((resultado.md_ms + resultado.links_ms + resultado.meta_ms).toFixed(1));

console.log("=== medição de agora ===");
for (const [k, v] of Object.entries(resultado)) console.log(`${k.padEnd(18)} ${v}`);

const depois = process.argv.includes("--depois");
if (!depois) {
  writeFileSync(ARQ_BASE, JSON.stringify(resultado, null, 2));
  console.log(`\nbaseline gravado em dev/_baseline-cpu.json`);
} else {
  if (!existsSync(ARQ_BASE)) {
    console.error("\nsem baseline gravado — rode sem --depois primeiro");
    process.exit(1);
  }
  const antes = JSON.parse(readFileSync(ARQ_BASE, "utf8"));
  console.log(`\n=== comparado com o baseline de ${antes.quando} ===`);
  console.log(`${"etapa".padEnd(12)} ${"antes".padStart(10)} ${"depois".padStart(10)} ${"ganho".padStart(8)}`);
  for (const k of ["md_ms", "links_ms", "meta_ms", "cpu_total_ms"]) {
    const a = antes[k], d = resultado[k];
    const ganho = d > 0 ? (a / d) : 0;
    console.log(`${k.padEnd(12)} ${(a + "ms").padStart(10)} ${(d + "ms").padStart(10)} ${(ganho.toFixed(2) + "x").padStart(8)}`);
  }
  console.log(`\nvazão de conversão: ${antes.md_mb_s} MB/s -> ${resultado.md_mb_s} MB/s`);
  if (antes.saida_md_chars !== resultado.saida_md_chars) {
    console.log(`\nATENÇÃO: a saída mudou de tamanho (${antes.saida_md_chars} -> ${resultado.saida_md_chars} chars). Rode o golden.`);
  } else {
    console.log(`\nsaída idêntica em tamanho: ${resultado.saida_md_chars} chars`);
  }
}
