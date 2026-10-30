#!/usr/bin/env node
/**
 * _bateria-limite-render.mjs — leva as 12 ferramentas ao TETO do schema contra
 * o deploy do Render, usando os sites mais pesados que existem em HTML publico.
 *
 * Diferente de _bateria-render-pesado.mjs (parametros moderados), aqui TODO
 * parametro numerico vai no maximo que o inputSchema aceita:
 *   maxChars 25000 | limit 200 (links) / 300 (discover) / 100 (feed, hits)
 *   maxPages 30 | contexto 5 | timeoutMs 120000
 *
 * Cada medicao e gravada em disco NA HORA, entao queda no meio nao perde dado.
 *
 * Uso: node dev/_bateria-limite-render.mjs [rotulo]
 * Saida: dev/load/render-limite-<rotulo>.json
 */
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.RENDER_URL || "https://web-reader-mcp-13z0.onrender.com";
const TOKEN = process.env.LIVE_TEST_TOKEN || process.env.MCP_AUTH_TOKEN || "";
if (!TOKEN) { console.error("defina LIVE_TEST_TOKEN (ou MCP_AUTH_TOKEN) com o token do servidor"); process.exit(1); }
const ROTULO = (process.argv[2] || "rodada").replace(/[^a-z0-9_-]/gi, "");
const TOOL_TIMEOUT = 120000;
const CLIENT_TIMEOUT = 180000;
const SAIDA = `dev/load/render-limite-${ROTULO}.json`;

const auth = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
let idSeq = 1;
const resultados = [];

const gravar = () => {
  mkdirSync("dev/load", { recursive: true });
  writeFileSync(
    SAIDA,
    JSON.stringify({ base: BASE, rotulo: ROTULO, quando: new Date().toISOString(), resultados }, null, 2)
  );
};

async function rpc(method, params, timeoutMs = CLIENT_TIMEOUT) {
  const res = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++idSeq, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function chamar(name, args) {
  const t0 = Date.now();
  try {
    const { status, json } = await rpc("tools/call", { name, arguments: args });
    const texto = json?.result?.content?.[0]?.text || "";
    return {
      ok: status === 200 && !json?.result?.isError,
      status,
      ms: Date.now() - t0,
      chars: texto.length,
      erro: json?.result?.isError
        ? texto.replace(/\s+/g, " ").slice(0, 180)
        : json?.error?.message || (status !== 200 ? `HTTP ${status}` : ""),
    };
  } catch (e) {
    const motivo =
      e.name === "TimeoutError" || e.name === "AbortError" || e.name === "DOMException"
        ? `timeout do cliente (${CLIENT_TIMEOUT}ms)`
        : e.message;
    return { ok: false, status: 0, ms: Date.now() - t0, chars: 0, erro: motivo };
  }
}

async function acordar(ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE + "/health", { signal: AbortSignal.timeout(5000) });
      if (r.ok) return { ok: true, ms: Date.now() - t0 };
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: false, ms: Date.now() - t0 };
}

function reg(ferramenta, alvo, r, obs = "") {
  resultados.push({ ferramenta, alvo, ok: r.ok, ms: r.ms, status: r.status, chars: r.chars, obs: obs || r.erro });
  gravar();
  console.log(
    `${r.ok ? "OK   " : "FALHA"} ${ferramenta.padEnd(20)} ${String(r.ms).padStart(7)} ms  ${String(r.chars).padStart(7)} chars  ${alvo}` +
      (obs ? `  [${obs}]` : "") +
      (!r.ok && r.erro ? `  !! ${r.erro}` : "")
  );
}

/* ---------------- alvos: o mais pesado que existe em HTML publico ---------------- */
const P = {
  whatwg: "https://html.spec.whatwg.org/multipage/", // ~12 MB
  nodeAll: "https://nodejs.org/api/all.html", // ~8 MB
  pythonDocs: "https://docs.python.org/3/library/index.html",
  amazon: "https://www.amazon.com/",
  nytimes: "https://www.nytimes.com/",
  washingtonPost: "https://www.washingtonpost.com/",
  reuters: "https://www.reuters.com/",
  guardian: "https://www.theguardian.com/international",
  reddit: "https://www.reddit.com/",
  stackoverflow: "https://stackoverflow.com/questions",
  wikipedia: "https://en.wikipedia.org/wiki/Brazil",
  bbc: "https://www.bbc.com/news",
  arxivPdf: "https://arxiv.org/pdf/1706.03762",
  youtube: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  feed: "https://hnrss.org/frontpage",
  githubApi: "https://api.github.com/repos/nodejs/node",
  spa: "https://nextjs.org/",
  crawl: "https://www.iana.org",
};

console.log(`[render] alvo: ${BASE} | rotulo: ${ROTULO} | teto maxChars=25000 timeoutMs=${TOOL_TIMEOUT}`);

const acordou = await acordar();
console.log(`[render] aquecimento: ${acordou.ok ? "no ar" : "NAO SUBIU"} em ${acordou.ms} ms`);
if (!acordou.ok) {
  console.error("[render] FALHA: /health nao respondeu");
  process.exit(1);
}

// Aquece TLS + roteador: a primeira medida sempre mente.
await chamar("read_page", { url: "https://example.com", maxChars: 2000 });

const T = { maxChars: 25000, timeoutMs: TOOL_TIMEOUT };

/* ---- tools/list (custo fixo do catalogo) ---- */
await rpc("initialize", { protocolVersion: "2024-11-05" });
{
  const t0 = Date.now();
  const cat = await rpc("tools/list", {});
  reg("tools/list", "catalogo", {
    ok: cat.status === 200,
    status: cat.status,
    ms: Date.now() - t0,
    chars: JSON.stringify(cat.json || {}).length,
    erro: "",
  }, `${cat.json?.result?.tools?.length ?? 0} ferramentas`);
}

/* ---- read_page: os HTMLs mais monstruosos ---- */
console.log("\n--- read_page: maxChars 25000 nos HTMLs mais pesados");
reg("read_page", "whatwg multipage (~12MB)", await chamar("read_page", { url: P.whatwg, ...T }));
reg("read_page", "nodejs all.html (~8MB)", await chamar("read_page", { url: P.nodeAll, ...T }));
reg("read_page", "python docs index", await chamar("read_page", { url: P.pythonDocs, ...T }));
reg("read_page", "amazon.com", await chamar("read_page", { url: P.amazon, ...T }));
reg("read_page", "washingtonpost.com", await chamar("read_page", { url: P.washingtonPost, ...T }));
reg("read_page", "reuters.com", await chamar("read_page", { url: P.reuters, ...T }));
reg("read_page", "nytimes.com", await chamar("read_page", { url: P.nytimes, ...T }));
reg("read_page", "reddit.com", await chamar("read_page", { url: P.reddit, ...T }));
reg("read_page", "whatwg (cache quente)", await chamar("read_page", { url: P.whatwg, ...T }), "esperado: muito menor");

/* ---- extract_links: limit no teto (200) ---- */
console.log("\n--- extract_links: limit 200 (teto)");
reg("extract_links", "bbc.com/news limit 200", await chamar("extract_links", { url: P.bbc, limit: 200, timeoutMs: TOOL_TIMEOUT }));
reg("extract_links", "wikipedia/Brazil limit 200", await chamar("extract_links", { url: P.wikipedia, limit: 200, timeoutMs: TOOL_TIMEOUT }));

/* ---- read_multiple_pages: 30 URLs (teto) ---- */
console.log("\n--- read_multiple_pages: 30 URLs (teto) x maxChars 25000");
const trinta = [];
for (let i = 0; i < 4; i++) {
  trinta.push(P.amazon, P.nytimes, P.washingtonPost, P.reuters, P.reddit, P.bbc, P.guardian, P.stackoverflow);
}
reg("read_multiple_pages", "30 URLs pesadas (teto)", await chamar("read_multiple_pages", {
  urls: trinta.slice(0, 30),
  ...T,
}));

/* ---- discover_urls: limit 300 (teto) ---- */
console.log("\n--- discover_urls: limit 300 (teto)");
reg("discover_urls", "bbc.com sitemap limit 300", await chamar("discover_urls", { url: P.bbc, limit: 300, timeoutMs: TOOL_TIMEOUT }));
reg("discover_urls", "iana.org limit 300", await chamar("discover_urls", { url: P.crawl, limit: 300, timeoutMs: TOOL_TIMEOUT }));

/* ---- crawl_site: maxPages 30 (teto) ---- */
console.log("\n--- crawl_site: maxPages 30 (teto)");
reg("crawl_site", "iana.org maxPages 30", await chamar("crawl_site", { url: P.crawl, maxPages: 30, maxChars: 25000, timeoutMs: TOOL_TIMEOUT }));

/* ---- as demais no teto ---- */
console.log("\n--- demais ferramentas no teto");
reg("read_dynamic_page", "nextjs.org SPA", await chamar("read_dynamic_page", { url: P.spa, ...T }));
reg("read_video", "youtube", await chamar("read_video", { url: P.youtube, ...T }));
reg("read_pdf", "arxiv 1706.03762", await chamar("read_pdf", { url: P.arxivPdf, ...T }));
reg("read_feed", "hnrss limit 100 (teto)", await chamar("read_feed", { url: P.feed, limit: 100, ...T }));
reg("read_json", "api.github nodejs/node", await chamar("read_json", { url: P.githubApi, ...T }));
reg("find_on_page", "wikipedia 'Brasil' hits 100 ctx 5", await chamar("find_on_page", {
  url: P.wikipedia, query: "Brasil", maxHits: 100, contexto: 5, timeoutMs: TOOL_TIMEOUT,
}));
reg("diff_page", "guardian (grava marca)", await chamar("diff_page", { url: P.guardian, force: true, ...T }));
reg("diff_page", "guardian (compara)", await chamar("diff_page", { url: P.guardian, ...T }));

/* ---- resumo ---- */
const ok = resultados.filter((r) => r.ok).length;
const tempos = resultados.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
const p = (q) => tempos[Math.min(tempos.length - 1, Math.floor(tempos.length * q))] || 0;
console.log(`\n===== RESUMO ${ROTULO}: ${ok}/${resultados.length} OK =====`);
console.log(
  `min ${tempos[0] || 0} ms | p50 ${p(0.5)} ms | p95 ${p(0.95)} ms | max ${tempos[tempos.length - 1] || 0} ms | soma ${tempos.reduce((a, b) => a + b, 0)} ms`
);
gravar();
console.log(`gravado: ${SAIDA}`);
