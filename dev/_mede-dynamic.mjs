#!/usr/bin/env node
/**
 * _mede-dynamic.mjs — mede o read_dynamic_page contra sites reais e PESADOS.
 *
 * O que esta medição tem de mostrar: o read_dynamic_page passou a usar o teto
 * proporcional (o mesmo do read_page) em vez do teto duro de 5 MB. Numa
 * página gigante, isso é deixar de baixar megabytes para entregar 8.000
 * caracteres.
 *
 * Mede cada site DUAS vezes, em rodízio (cache desligado entre as voltas não é
 * possível sem reiniciar o processo, então a primeira volta é a que paga rede
 * e a segunda mostra o cache). O número que importa é o da primeira.
 */
import { toolReadDynamicPage } from "../src/tools.mjs";

const SITES = [
  { nome: "whatwg (12 MB)", url: "https://html.spec.whatwg.org/multipage/", maxChars: 8000 },
  { nome: "washingtonpost", url: "https://www.washingtonpost.com/", maxChars: 8000 },
  { nome: "nodejs docs", url: "https://nodejs.org/api/all.html", maxChars: 8000 },
  { nome: "nytimes", url: "https://www.nytimes.com/", maxChars: 8000 },
];

const resultados = [];

for (const site of SITES) {
  const t0 = Date.now();
  let ok = false;
  let chars = 0;
  let erro = "";
  try {
    const saida = await toolReadDynamicPage({ url: site.url, maxChars: site.maxChars, timeoutMs: 45000 });
    chars = saida.length;
    ok = true;
  } catch (e) {
    erro = e.name + ": " + e.message.slice(0, 90);
  }
  const ms = Date.now() - t0;
  resultados.push({ site: site.nome, ms, ok, chars, erro });
  console.log(
    `${site.nome.padEnd(22)} ${String(ms).padStart(6)} ms  ${ok ? "OK" : "FALHOU"}  ${ok ? chars + " chars" : erro}`
  );
}

console.log("");
console.log("JSON:", JSON.stringify({ quando: new Date().toISOString(), resultados }));
process.exit(0);
