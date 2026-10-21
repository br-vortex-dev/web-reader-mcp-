#!/usr/bin/env node
/**
 * _probe-crawl-fases.mjs — onde o tempo do crawl_site REAL é gasto.
 *
 * A bateria de 21/10 mostrou crawl_site a 519 ms/página (iana.org), contra
 * 275 ms/página no baseline — e o conteúdo lido cresceu 45%. Antes de mexer
 * no código, este arquivo mede as DUAS fases do pipeline do crawl em páginas
 * reais do site:
 *
 *   1. download  — fetchTextDocumentoCached (o que o crawl baixa de fato)
 *   2. conversão — htmlToMarkdownComLinks (markdown + links numa passada)
 *
 * e compara com o tempo total do toolCrawlSite. Se download >> conversão, o
 * gargalo é a origem/rede e mexer em parser é inútil; se conversão dominar,
 * o alvo é o html-parser.
 *
 * Uso: node dev/_probe-crawl-fases.mjs [url] [nPaginas]
 * Padrão: https://www.iana.org/help/example-domains 6
 */
import { performance } from "node:perf_hooks";

const url = process.argv[2] || "https://www.iana.org/help/example-domains";
const nPaginas = Math.max(2, Math.min(12, Number(process.argv[3]) || 6));

const ms = (n) => `${n.toFixed(1)} ms`;
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

const { fetchTextDocumentoCached, validateHttpUrl } = await import("../src/fetch.mjs");
const { htmlToMarkdownComLinks, extractLinks, hostOf } = await import("../src/html-parser.mjs");

const parsed = validateHttpUrl(url);
const host = hostOf(parsed.href);
const timeoutMs = 30000;

/* ------------------------------------------------------------------ *
 * Fase 0 — o crawl de verdade, para ter o total de referência          *
 * ------------------------------------------------------------------ */
const { toolCrawlSite } = await import("../src/tools.mjs");
const t0 = performance.now();
const saida = await toolCrawlSite({ url, maxPages: nPaginas, maxChars: 2000, timeoutMs });
const crawlMs = performance.now() - t0;
const lidas = Number(/(\d+) pagina\(s\) lida/.exec(saida)?.[1] || 0);
console.log(`crawl_site real: ${lidas} páginas em ${ms(crawlMs)} → ${ms(crawlMs / Math.max(1, lidas))}/página\n`);

/* ------------------------------------------------------------------ *
 * Fase 1 — download medido página a página (mesma função do crawl)     *
 * ------------------------------------------------------------------ */
const baixadas = [];
const medirDownload = async (alvo) => {
  const t = performance.now();
  const payload = await fetchTextDocumentoCached(validateHttpUrl(alvo).href, { timeoutMs });
  const duracao = performance.now() - t;
  const bytes = Buffer.byteLength(payload.text, "utf8");
  console.log(`  download ${ms(duracao).padStart(9)}  ${kb(bytes).padStart(7)}  ${alvo}`);
  baixadas.push({ alvo, payload, duracao, bytes });
  return payload;
};

console.log(`[1] download — ${url}`);
const raiz = await medirDownload(url);

/* ------------------------------------------------------------------ *
 * Fase 2 — conversão da raiz (markdown + links numa passada)           *
 * ------------------------------------------------------------------ */
const medirConversao = (payload, alvo) => {
  const t = performance.now();
  const { markdown, links } = htmlToMarkdownComLinks(payload.text, payload.finalUrl, {});
  const duracao = performance.now() - t;
  const internos = extractLinks(payload.text, payload.finalUrl).filter((l) => l.internal);
  console.log(`  conversão ${ms(duracao).padStart(9)}  ${kb(Buffer.byteLength(markdown, "utf8")).padStart(7)} markdown  ${links.length} links (${internos.length} internos)  ${alvo}`);
  return { markdown, links, internos, duracao };
};

console.log(`[2] conversão — ${url}`);
const convRaiz = medirConversao(raiz, url);

/* ------------------------------------------------------------------ *
 * Fase 3 — as internas seguintes, na mesma ordem do BFS                *
 * ------------------------------------------------------------------ */
const ehNavegacao = (href) =>
  /\/(login|logout|signin|signup|cart|checkout|search|tag|tags|author|category|page|paginacao|feed|wp-admin|wp-json|cdn-cgi)\b/i.test(href);

const fila = [...new Set(convRaiz.internos.map((l) => l.href))]
  .filter((h) => hostOf(h) === host && !ehNavegacao(h))
  .slice(0, nPaginas - 1);

const downloads = [baixadas[0].duracao];
const conversoes = [convRaiz.duracao];
const tabelas = [];

for (const alvo of fila) {
  try {
    console.log(`[1] download — ${alvo}`);
    const payload = await medirDownload(alvo);
    console.log(`[2] conversão — ${alvo}`);
    const conv = medirConversao(payload, alvo);
    downloads.push(baixadas.at(-1).duracao);
    conversoes.push(conv.duracao);
    tabelas.push({ alvo, download: baixadas.at(-1).duracao, conversao: conv.duracao, bytes: baixadas.at(-1).bytes });
  } catch (erro) {
    console.log(`  FALHOU ${alvo}: ${erro.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * Resumo                                                               *
 * ------------------------------------------------------------------ */
const soma = (a) => a.reduce((x, y) => x + y, 0);
const media = (a) => (a.length ? soma(a) / a.length : 0);
const totalPipeline = media(downloads) + media(conversoes);

console.log("\n================ RESUMO ================");
console.log(`páginas medidas: ${downloads.length}`);
console.log(`download  médio: ${ms(media(downloads))}  (total ${ms(soma(downloads))})`);
console.log(`conversão média: ${ms(media(conversoes))}  (total ${ms(soma(conversoes))})`);
console.log(`pipeline  médio: ${ms(totalPipeline)}/página  → crawl teórico ${nPaginas} pág = ${ms(totalPipeline * nPaginas)}`);
console.log(`crawl_site real: ${ms(crawlMs / Math.max(1, lidas))}/página`);
console.log(`\ndownload é ${((media(downloads) / totalPipeline) * 100).toFixed(0)}% do pipeline`);
console.log(`conversão é ${((media(conversoes) / totalPipeline) * 100).toFixed(0)}% do pipeline`);
if (tabelas.length > 0) {
  console.log("\npágina a página:");
  for (const t of tabelas) {
    console.log(`  ↓${ms(t.download).padStart(9)}  ↻${ms(t.conversao).padStart(8)}  ${kb(t.bytes).padStart(7)}  ${t.alvo}`);
  }
}
process.exit(0);
