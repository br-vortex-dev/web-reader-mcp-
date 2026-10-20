#!/usr/bin/env node
/**
 * _ab-meta.mjs — A/B do extractMeta (HEAD commitado x versão em trabalho).
 * Confere que o resultado é o MESMO objeto e mede o ganho de CPU.
 */
import { readFileSync } from "node:fs";
import * as novo from "../src/html-parser.mjs";
import * as velho from "./_head-parser.mjs";

const RODADAS = Number(process.argv[2] || 8);
const LOTE = Number(process.argv[3] || 50);
const html = readFileSync(new URL("./_prof.html", import.meta.url), "utf8");

const a = JSON.stringify(novo.extractMeta(html));
const b = JSON.stringify(velho.extractMeta(html));
console.log(`resultado idêntico: ${a === b ? "SIM" : "NÃO"}`);
if (a !== b) {
  console.log(`  novo:  ${a}`);
  console.log(`  velho: ${b}`);
  process.exitCode = 1;
}

function cpuMs(fn) {
  const antes = process.cpuUsage();
  fn();
  const d = process.cpuUsage(antes);
  return (d.user + d.system) / 1000;
}

for (let i = 0; i < 3; i++) { novo.extractMeta(html); velho.extractMeta(html); }

const nm = [], vm = [];
for (let r = 0; r < RODADAS; r++) {
  nm.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) novo.extractMeta(html); }) / LOTE);
  vm.push(cpuMs(() => { for (let i = 0; i < LOTE; i++) velho.extractMeta(html); }) / LOTE);
}

const min = (x) => Math.min(...x);
console.log(`\n${RODADAS} rodadas de ${LOTE} chamadas | mínimo`);
console.log(`HEAD    ${min(vm).toFixed(2)}ms`);
console.log(`novo    ${min(nm).toFixed(2)}ms`);
console.log(`ganho   ${(((min(vm) - min(nm)) / min(vm)) * 100).toFixed(1)}%`);
