#!/usr/bin/env node
/**
 * _perfil.mjs — onde o tempo de uma leitura é gasto, em números.
 *
 * Separa as quatro etapas do caminho crítico:
 *   dns      -> assertPublicHost (lookup + checagem SSRF)
 *   robots   -> GET /robots.txt da origem (primeira leitura de cada site paga)
 *   rede     -> download da página (TTFB + corpo) + descompressão + decode
 *   cpu      -> htmlToMarkdown + extractMeta + extractLinks
 *
 * Uso: node dev/_perfil.mjs <url> [repeticoes]
 */

import { performance } from "node:perf_hooks";
import { assertPublicHost, checarRobots } from "../src/security.mjs";
import { fetchText, fetchTextCached } from "../src/fetch.mjs";
import { htmlToMarkdown, extractMeta, extractLinks } from "../src/html-parser.mjs";
import { HARD_MAX_CHARS } from "../src/config.mjs";

const url = process.argv[2] || "https://www.theguardian.com/international";
const reps = Number(process.argv[3] || 3);

const ms = (t) => `${t.toFixed(1)}ms`;
const medir = async (fn) => {
  const t0 = performance.now();
  const r = await fn();
  return { ms: performance.now() - t0, r };
};

async function umaRodada(rotulo) {
  console.log(`\n=== ${rotulo} ===`);

  const dns = await medir(() => assertPublicHost(url));
  console.log(`dns/ssrf      ${ms(dns.ms)}  -> ${dns.r}`);

  const robots = await medir(() => checarRobots(url));
  console.log(`robots        ${ms(robots.ms)}`);

  const rede = await medir(() => fetchText(url, { retries: 0 }));
  const payload = rede.r;
  console.log(`rede+decode   ${ms(rede.ms)}  -> ${payload.text.length} chars de HTML`);

  const md = await medir(() => htmlToMarkdown(payload.text, payload.finalUrl, { minCharsEntregaveis: HARD_MAX_CHARS }));
  console.log(`markdown      ${ms(md.ms)}  -> ${md.r.length} chars`);

  const meta = await medir(() => extractMeta(payload.text));
  console.log(`meta          ${ms(meta.ms)}`);

  const links = await medir(() => extractLinks(payload.text, payload.finalUrl));
  console.log(`links         ${ms(links.ms)}  -> ${links.r.length} links`);

  const cpu = md.ms + meta.ms + links.ms;
  const totalFrio = dns.ms + robots.ms + rede.ms + cpu;
  console.log(`---`);
  console.log(`CPU total     ${ms(cpu)}  (${((cpu / totalFrio) * 100).toFixed(1)}% do total frio)`);
  console.log(`TOTAL frio    ${ms(totalFrio)}`);
  return { dns: dns.ms, robots: robots.ms, rede: rede.ms, cpu, md: md.ms, links: links.ms, meta: meta.ms, total: totalFrio };
}

const rodadas = [];
for (let i = 0; i < reps; i++) rodadas.push(await umaRodada(`rodada ${i + 1}`));

console.log("\n=== média (sem a 1ª rodada, que paga o DNS e o robots) ===");
const quentes = rodadas.slice(1);
if (quentes.length > 0) {
  const media = (k) => quentes.reduce((s, r) => s + r[k], 0) / quentes.length;
  for (const k of ["dns", "robots", "rede", "cpu", "total"]) console.log(`${k.padEnd(8)} ${ms(media(k))}`);
  console.log(`rede é ${((media("rede") / media("total")) * 100).toFixed(1)}% do total quente`);
  console.log(`cpu  é ${((media("cpu") / media("total")) * 100).toFixed(1)}% do total quente`);
}

// Acerto de cache: quanto custa a MESMA página já quente.
const cache = await medir(() => fetchTextCached(url));
console.log(`\ncache quente  ${ms(cache.ms)} (a página já está no cache)`);
