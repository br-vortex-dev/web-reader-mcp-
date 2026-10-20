#!/usr/bin/env node
/**
 * _bateria-render-pesado.mjs — mede o TEMPO de cada ferramenta contra o deploy
 * do Render usando sites REALMENTE pesados, e grava o resultado em JSON com um
 * rótulo. Rodar com o mesmo rótulo antes e depois do deploy permite comparar.
 *
 * Uso: node dev/_bateria-render-pesado.mjs antes
 *      node dev/_bateria-render-pesado.mjs depois
 *
 * O rótulo padrão é "rodada". Saída: dev/load/render-pesado-<rotulo>.json
 */
import { writeFileSync } from "node:fs";

const BASE = process.env.RENDER_URL || "https://web-reader-mcp-13z0.onrender.com";
const TOKEN = process.env.MCP_AUTH_TOKEN || "tRqOmW3l9kVq8rgOdIvi7hBIW3WV9YJs/LiBx446FYw=";
const ROTULO = (process.argv[2] || "rodada").replace(/[^a-z0-9_-]/gi, "");
const TOOL_TIMEOUT = 90000;

const auth = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
let idSeq = 1;

async function rpc(method, params, timeoutMs = 150000) {
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
        ? texto.replace(/\s+/g, " ").slice(0, 160)
        : json?.error?.message || "",
    };
  } catch (e) {
    const motivo = e.name === "TimeoutError" || e.name === "AbortError" ? "timeout do cliente" : e.message;
    return { ok: false, status: 0, ms: Date.now() - t0, chars: 0, erro: motivo };
  }
}

async function acordar() {
  // plano free do Render hiberna: acorda e espera o /health responder.
  const t0 = Date.now();
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(BASE + "/health", { signal: AbortSignal.timeout(5000) });
      if (r.ok) return { ok: true, ms: Date.now() - t0 };
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: false, ms: Date.now() - t0 };
}

const resultados = [];
function reg(ferramenta, alvo, r, obs = "") {
  resultados.push({ ferramenta, alvo, ok: r.ok, ms: r.ms, status: r.status, chars: r.chars, obs: obs || r.erro });
  console.log(
    `${r.ok ? "OK  " : "FALHA"} ${ferramenta.padEnd(20)} ${String(r.ms).padStart(6)} ms  ${String(r.chars).padStart(7)} chars  ${alvo}` +
      (obs ? `  [${obs}]` : "") +
      (!r.ok && r.erro ? `  !! ${r.erro}` : "")
  );
}

/* ------------------ sites PESADOS (1 MB+ de HTML quando dá) ------------------ */
const PESADO = {
  amazon: "https://www.amazon.com/",
  nytimes: "https://www.nytimes.com/",
  reddit: "https://www.reddit.com/",
  guardian: "https://www.theguardian.com/international",
  bbc: "https://www.bbc.com/news",
  wikipedia: "https://en.wikipedia.org/wiki/Brazil",
  washingtonPost: "https://www.washingtonpost.com/",
  reuters: "https://www.reuters.com/",
  stackoverflow: "https://stackoverflow.com/questions",
  arxivPdf: "https://arxiv.org/pdf/1706.03762",
  youtube: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  feed: "https://hnrss.org/frontpage",
  githubApi: "https://api.github.com/repos/nodejs/node",
  spa: "https://nextjs.org/",
  sitemap: "https://www.bbc.com",
  crawl: "https://www.iana.org",
};

console.log(`[render] alvo: ${BASE} | rotulo: ${ROTULO}`);

const acordou = await acordar();
console.log(`[render] aquecimento: ${acordou.ok ? "no ar" : "NAO SUBIU"} em ${acordou.ms} ms`);
if (!acordou.ok) {
  console.error("[render] FALHA: servidor nao respondeu /health");
  process.exit(1);
}

// Aquece a conexão TLS e o roteador antes de medir (senão a 1a medida mente).
await chamar("read_page", { url: "https://example.com", maxChars: 2000 });

await rpc("initialize", { protocolVersion: "2024-11-05" });
{
  const t0 = Date.now();
  const cat = await rpc("tools/list", {});
  const nomes = cat.json?.result?.tools?.map((t) => t.name) || [];
  reg("tools/list", "catalogo", { ok: cat.status === 200, status: cat.status, ms: Date.now() - t0, chars: JSON.stringify(cat.json || {}).length, erro: "" }, `${nomes.length} ferramentas`);
  console.log(`      ferramentas: ${nomes.join(", ")}\n`);
}

const T = { maxChars: 25000, timeoutMs: TOOL_TIMEOUT };

console.log("--- read_page nos sites MAIS PESADOS (cada um e uma chamada propria)");
reg("read_page", "amazon.com", await chamar("read_page", { url: PESADO.amazon, ...T }));
reg("read_page", "nytimes.com", await chamar("read_page", { url: PESADO.nytimes, ...T }));
reg("read_page", "washingtonpost.com", await chamar("read_page", { url: PESADO.washingtonPost, ...T }));
reg("read_page", "reddit.com", await chamar("read_page", { url: PESADO.reddit, ...T }));
reg("read_page", "reuters.com", await chamar("read_page", { url: PESADO.reuters, ...T }));
reg("read_page", "guardian.com", await chamar("read_page", { url: PESADO.guardian, ...T }));
reg("read_page", "wikipedia/Brazil", await chamar("read_page", { url: PESADO.wikipedia, ...T }));
reg("read_page", "stackoverflow/questions", await chamar("read_page", { url: PESADO.stackoverflow, ...T }));
reg("read_page", "guardian (cache quente)", await chamar("read_page", { url: PESADO.guardian, ...T }), "esperado: muito menor");

console.log("\n--- as demais ferramentas");
reg("extract_links", "bbc.com/news limit 500", await chamar("extract_links", { url: PESADO.bbc, limit: 500, timeoutMs: TOOL_TIMEOUT }));
reg("read_multiple_pages", "10 sites pesados", await chamar("read_multiple_pages", {
  urls: [PESADO.amazon, PESADO.nytimes, PESADO.bbc, PESADO.guardian, PESADO.reddit, PESADO.washingtonPost, PESADO.reuters, PESADO.stackoverflow, PESADO.wikipedia, PESADO.nytimes],
  maxChars: 2000,
  timeoutMs: TOOL_TIMEOUT,
}));
reg("discover_urls", "bbc.com sitemap", await chamar("discover_urls", { url: PESADO.sitemap, limit: 200, timeoutMs: TOOL_TIMEOUT }));
reg("crawl_site", "iana.org maxPages 5", await chamar("crawl_site", { url: PESADO.crawl, maxPages: 5, maxChars: 1000, timeoutMs: TOOL_TIMEOUT }));
reg("read_dynamic_page", "nextjs.org SPA", await chamar("read_dynamic_page", { url: PESADO.spa, maxChars: 4000, timeoutMs: TOOL_TIMEOUT }));
reg("read_video", "youtube", await chamar("read_video", { url: PESADO.youtube, maxChars: 4000, timeoutMs: TOOL_TIMEOUT }));
reg("read_pdf", "arxiv 1706.03762", await chamar("read_pdf", { url: PESADO.arxivPdf, maxChars: 5000, timeoutMs: TOOL_TIMEOUT }));
reg("read_feed", "hnrss frontpage", await chamar("read_feed", { url: PESADO.feed, limit: 30, timeoutMs: TOOL_TIMEOUT }));
reg("read_json", "api.github nodejs/node", await chamar("read_json", { url: PESADO.githubApi, path: "stargazers_count", timeoutMs: TOOL_TIMEOUT }));
reg("find_on_page", "wikipedia 'Brasil'", await chamar("find_on_page", { url: PESADO.wikipedia, query: "Brasil", maxHits: 30, timeoutMs: TOOL_TIMEOUT }));
reg("diff_page", "guardian (marca)", await chamar("diff_page", { url: PESADO.guardian, force: true, timeoutMs: TOOL_TIMEOUT }));
reg("diff_page", "guardian (compara)", await chamar("diff_page", { url: PESADO.guardian, timeoutMs: TOOL_TIMEOUT }));

/* ------------------------------- resumo ------------------------------- */
const ok = resultados.filter((r) => r.ok).length;
const tempos = resultados.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
const p = (q) => tempos[Math.min(tempos.length - 1, Math.floor(tempos.length * q))] || 0;
console.log(`\n===== RESUMO ${ROTULO}: ${ok}/${resultados.length} OK =====`);
console.log(`min ${tempos[0] || 0} ms | p50 ${p(0.5)} ms | p95 ${p(0.95)} ms | max ${tempos[tempos.length - 1] || 0} ms | soma ${tempos.reduce((a, b) => a + b, 0)} ms`);

const saida = { base: BASE, rotulo: ROTULO, quando: new Date().toISOString(), aquecimentoMs: acordou.ms, resultados };
writeFileSync(`dev/load/render-pesado-${ROTULO}.json`, JSON.stringify(saida, null, 2));
console.log(`gravado: dev/load/render-pesado-${ROTULO}.json`);
