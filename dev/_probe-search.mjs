#!/usr/bin/env node
/**
 * _probe-search.mjs — a BUSCA na web publica tem caminho legitimo?
 *
 * A pergunta: hoje o servidor le uma URL que ja se tem; para achar a URL
 * (read_search) ele precisa de um provedor de busca. Quais respondem ao
 * transporte do PROPRIO projeto, o que o robots.txt de cada um diz, e qual
 * devolve resultado parseavel sem API key?
 *
 * Nada aqui entra no produto: e sonda de campo. Roda com:
 *   node dev/_probe-search.mjs
 */
import { fetchText } from "../src/fetch.mjs";
import { checarRobots } from "../src/security.mjs";

const CONSULTA = "web scraping etica";

const CANDIDATOS = [
  ["duckduckgo-html", `https://html.duckduckgo.com/html/?q=${encodeURIComponent(CONSULTA)}`],
  ["duckduckgo-lite", `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(CONSULTA)}`],
  ["wikipedia-api", `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(CONSULTA)}&format=json&srlimit=5`],
  ["searx-be", `https://searx.be/search?q=${encodeURIComponent(CONSULTA)}&format=json`],
  ["mojeek", `https://www.mojeek.com/search?q=${encodeURIComponent(CONSULTA)}`],
  ["brave-marginalia", `https://search.marginalia.nu/search?query=${encodeURIComponent(CONSULTA)}`],
];

function primeiros(texto, n) {
  return String(texto || "").replace(/\s+/g, " ").slice(0, n);
}

for (const [nome, url] of CANDIDATOS) {
  console.log(`\n===== ${nome} =====`);
  console.log(`url: ${url}`);
  // 1. robots.txt: o proprio produto bloqueia se Disallow.
  try {
    await checarRobots(url);
    console.log("robots: PERMITE");
  } catch (e) {
    console.log(`robots: BLOQUEIA (${e.name}: ${e.message})`);
  }
  // 2. alcance cru pelo transporte do projeto (sem robots, so rede).
  const t0 = Date.now();
  try {
    const r = await fetchText(url, { timeoutMs: 12000, retries: 0 });
    const ms = Date.now() - t0;
    console.log(`rede: OK ${r.text.length} chars em ${ms} ms | ct=${r.contentType}`);
    console.log(`inicio: ${primeiros(r.text, 220)}`);
    // 3. tem link de resultado parseavel?
    const hrefs = [...r.text.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    const externos = [...new Set(hrefs)].filter((h) => !h.includes(new URL(url).hostname));
    console.log(`links externos unicos: ${externos.length}`);
    if (externos.length) console.log(`exemplos: ${externos.slice(0, 3).join(" | ")}`);
  } catch (e) {
    console.log(`rede: FALHOU ${Date.now() - t0} ms — ${e.name}: ${e.message}`);
  }
}

console.log("\n===== fim =====");
