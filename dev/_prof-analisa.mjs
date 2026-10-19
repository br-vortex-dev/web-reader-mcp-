#!/usr/bin/env node
/**
 * _prof-analisa.mjs — lê o .cpuprofile e diz onde o tempo foi gasto,
 * por função e por linha. Soma "self time" (tempo na própria função).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] || "dev/_prof";
const arquivos = readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"));
if (arquivos.length === 0) {
  console.error("nenhum .cpuprofile encontrado em " + dir);
  process.exit(1);
}

const perfis = arquivos.map((f) => ({ nome: f, dados: JSON.parse(readFileSync(join(dir, f), "utf8")) }));

for (const { nome, dados } of perfis) {
  console.log(`\n########## ${nome} ##########`);
  const porId = new Map();
  for (const n of dados.nodes) porId.set(n.id, n);

  // Conta amostras por nó.
  const amostras = new Map();
  for (const id of dados.samples || []) amostras.set(id, (amostras.get(id) || 0) + 1);
  const totalAmostras = (dados.samples || []).length || 1;

  // Intervalo entre amostras (us).
  const intervaloUs = (dados.endTime - dados.startTime) / totalAmostras;

  const agregado = new Map();
  for (const [id, qtd] of amostras) {
    const n = porId.get(id);
    if (!n) continue;
    const cf = n.callFrame;
    const fn = cf.functionName || "(anônima)";
    const arq = (cf.url || "").replace(/^.*[\\/]/, "");
    const chave = `${fn} @ ${arq}:${cf.lineNumber + 1}`;
    agregado.set(chave, (agregado.get(chave) || 0) + qtd);
  }

  const lista = [...agregado.entries()]
    .map(([k, v]) => ({ k, ms: (v * intervaloUs) / 1000, pct: (v / totalAmostras) * 100 }))
    .sort((a, b) => b.ms - a.ms);

  console.log(`total amostrado: ${((totalAmostras * intervaloUs) / 1000).toFixed(0)}ms\n`);
  console.log(`${"ms".padStart(9)} ${"%".padStart(6)}  função`);
  for (const item of lista.slice(0, 25)) {
    console.log(`${item.ms.toFixed(1).padStart(9)} ${item.pct.toFixed(1).padStart(6)}  ${item.k}`);
  }

  // Só do projeto.
  console.log(`\n--- só arquivos do projeto (src/) ---`);
  const doProjeto = lista.filter((i) => i.k.includes("src/"));
  const somaProjeto = doProjeto.reduce((s, i) => s + i.pct, 0);
  for (const item of doProjeto.slice(0, 20)) {
    console.log(`${item.ms.toFixed(1).padStart(9)} ${item.pct.toFixed(1).padStart(6)}  ${item.k}`);
  }
  console.log(`\nprojeto responde por ${somaProjeto.toFixed(1)}% das amostras`);
}
