#!/usr/bin/env node
/**
 * _carga-ferramentas.mjs — CPU por ferramenta, sem HTTP no meio.
 *
 * Sobe o fixture local e chama `callTool` direto (o mesmo handler que o
 * servidor usa), com URL única por repetição para derrotar o cache: mede-se o
 * trabalho inteiro de cada ferramenta, não o acerto de cache.
 *
 * Serve para duas coisas:
 *   1. tabela de CPU por chamada (process.cpuUsage — espera de rede não conta);
 *   2. carga para `--cpu-prof`, revelando o que ainda é quente FORA do parser.
 *
 * Uso: node dev/_carga-ferramentas.mjs
 *      node --cpu-prof --cpu-prof-dir=dev/_prof-rest dev/_carga-ferramentas.mjs
 */
process.env.ALLOW_PRIVATE_HOSTS = "1";

const { startFixture } = await import("../tests/helpers.mjs");
const { callTool } = await import("../src/tools.mjs");

const fixture = await startFixture();
const U = fixture.url;

let id = 0;
const novo = () => ++id;

const LOTE = 200; // chamadas por amostra: degrau do relógio (~15,6 ms) / 200
const AMOSTRAS = 4;

const textoDe = (r) => (typeof r === "string" ? r : (r?.content?.[0]?.text || r?.text || ""));

const casos = [
  ["read_page (página rica)", () => ["read_page", { url: `${U}/pagina?v=${novo()}`, maxChars: 50000 }]],
  ["read_page (1,4 MB)", () => ["read_page", { url: `${U}/page/pesada?kb=1400&v=${novo()}`, maxChars: 25000 }]],
  ["extract_links", () => ["extract_links", { url: `${U}/pagina?v=${novo()}`, limit: 500 }]],
  ["find_on_page", () => ["find_on_page", { url: `${U}/pagina?v=${novo()}`, query: "conteudo" }]],
  ["discover_urls", () => ["discover_urls", { url: `${U}/pagina?v=${novo()}`, limit: 50 }]],
  ["read_multiple_pages", () => ["read_multiple_pages", { urls: [`${U}/pagina?a=${novo()}`, `${U}/pagina?b=${novo()}`], maxChars: 20000 }]],
  ["crawl_site", () => ["crawl_site", { url: `${U}/crawl/ok1?v=${novo()}`, maxPages: 3, maxChars: 300, timeoutMs: 5000 }]],
  ["read_dynamic_page", () => ["read_dynamic_page", { url: `${U}/pagina?v=${novo()}`, maxChars: 20000 }]],
  ["read_feed", () => ["read_feed", { url: `${U}/feed/rss.xml?v=${novo()}`, limit: 50 }]],
  ["read_json", () => ["read_json", { url: `${U}/api/pagina?v=${novo()}` }]],
  ["read_pdf", () => ["read_pdf", { url: `${U}/pdf/simples.pdf?v=${novo()}` }]],
  ["read_video", () => ["read_video", { url: `${U}/video/com-track?v=${novo()}` }]],
];

const resultados = [];
for (const [nome, montar] of casos) {
  const amostras = [];
  let erro = null;
  let tamanho = 0;
  let isError = false;
  for (let a = 0; a < AMOSTRAS; a++) {
    const antes = process.cpuUsage();
    for (let i = 0; i < LOTE; i++) {
      const [ferramenta, args] = montar();
      try {
        const r = await callTool(ferramenta, args);
        const texto = textoDe(r);
        tamanho = texto.length;
        if (texto.startsWith("Erro") || texto.includes('"isError":true')) isError = true;
      } catch (e) {
        erro = String(e.message).slice(0, 90);
        break;
      }
    }
    const d = process.cpuUsage(antes);
    amostras.push((d.user + d.system) / 1000 / LOTE);
  }
  resultados.push({ nome, min: Math.min(...amostras), med: [...amostras].sort((a, b) => a - b)[1], erro, tamanho, isError });
}

// Cache quente: a MESMA URL repetida (a 1ª baixa, as outras acertam o cache).
{
  const url = `${U}/pagina?quente=1`;
  await callTool("read_page", { url, maxChars: 50000 });
  const antes = process.cpuUsage();
  for (let i = 0; i < LOTE; i++) await callTool("read_page", { url, maxChars: 50000 });
  const d = process.cpuUsage(antes);
  resultados.push({ nome: "read_page (cache quente)", min: (d.user + d.system) / 1000 / LOTE, med: NaN, erro: null, tamanho: 0, isError: false });
}

// diff_page: a 2ª leitura da MESMA URL compara com a marca da 1ª.
{
  const url = `${U}/pagina?diff=1`;
  await callTool("diff_page", { url });
  const antes = process.cpuUsage();
  let tamanho = 0;
  for (let i = 0; i < LOTE; i++) {
    tamanho = textoDe(await callTool("diff_page", { url })).length;
  }
  const d = process.cpuUsage(antes);
  resultados.push({ nome: "diff_page (2ª leitura)", min: (d.user + d.system) / 1000 / LOTE, med: NaN, erro: null, tamanho, isError: false });
}

console.log(`${AMOSTRAS} amostras de ${LOTE} chamadas | CPU por chamada`);
console.log(`                          mínimo    mediana   saída`);
for (const r of resultados) {
  if (r.erro) {
    console.log(`${r.nome.padEnd(25)} ERRO: ${r.erro}`);
    continue;
  }
  const med = Number.isFinite(r.med) ? r.med.toFixed(3).padStart(8) : "       -";
  console.log(`${r.nome.padEnd(25)} ${r.min.toFixed(3).padStart(8)} ms ${med} ms  ${r.tamanho} chars${r.isError ? " (isError)" : ""}`);
}

await fixture.close?.();
