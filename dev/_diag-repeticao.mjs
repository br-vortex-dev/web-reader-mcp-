#!/usr/bin/env node
/**
 * _diag-repeticao.mjs — quantas tags se repetem e quanto "&" existe no texto.
 *
 * A pergunta que ele responde: vale memoizar o resultado do parse de uma tag
 * crua? Se 60% das tags de uma página são a MESMA string, o tokenize pode
 * reaproveitar o token em vez de refazer slice + toLowerCase + parseAttrs.
 */
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");

let i = 0;
let tags = 0;
let iguais = 0;
const conta = new Map();
const t0 = performance.now();

while (i < html.length) {
  const lt = html.indexOf("<", i);
  if (lt === -1) break;
  i = lt + 1;
  const c = html.charCodeAt(i);
  const ehTag = c === 47 || c === 33 || c === 63 || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  if (!ehTag) continue;
  // fim da tag respeitando aspas
  let j = i;
  let q = 0;
  for (; j < html.length; j++) {
    const cc = html.charCodeAt(j);
    if (q) {
      if (cc === q) q = 0;
    } else if (cc === 34 || cc === 39) q = cc;
    else if (cc === 62) break;
  }
  if (j >= html.length) break;
  const raw = html.slice(i, j);
  i = j + 1;
  tags++;
  const antes = conta.get(raw);
  if (antes === undefined) conta.set(raw, 1);
  else {
    conta.set(raw, antes + 1);
    iguais++;
  }
}

const ms = performance.now() - t0;
const amostras = [...conta.values()];
const totalAmp = (html.match(/&/g) || []).length;

console.log(`HTML: ${html.length} chars`);
console.log(`tags: ${tags} | distintas: ${conta.size} | repetidas: ${iguais} (${((iguais / tags) * 100).toFixed(1)}%)`);
console.log(`& no documento: ${totalAmp}`);
console.log(`varredura acima: ${ms.toFixed(1)}ms`);
console.log(`top 10 tags mais repetidas:`);
[...conta.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([raw, n]) => console.log(`  ${n}x  ${raw.length > 70 ? raw.slice(0, 70) + "..." : raw}`));
console.log(`máximo visto: ${Math.max(...amostras)}`);
