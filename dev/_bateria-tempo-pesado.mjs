#!/usr/bin/env node
/**
 * _bateria-tempo-pesado.mjs — mede o TEMPO de cada ferramenta contra sites PESADOS.
 *
 * Sobe o servidor MCP em modo HTTP numa porta livre, faz initialize e chama
 * uma a uma as 12 ferramentas, cronometrando cada chamada com um alvo real e
 * pesado (notícia grande, artigo de Wikipedia, PDF de paper, YouTube, etc).
 *
 * Uso: node dev/_bateria-tempo-pesado.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const PORT = 6300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "bateria-token";
const TOOL_TIMEOUT = 60000;

const auth = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
let idSeq = 1;

async function rpc(method, params, timeoutMs = 90000) {
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
      erro: json?.result?.isError ? texto.replace(/\s+/g, " ").slice(0, 160) : json?.error?.message || "",
      texto,
    };
  } catch (e) {
    const motivo = e.name === "TimeoutError" || e.name === "AbortError" ? "timeout do cliente" : e.message;
    return { ok: false, status: 0, ms: Date.now() - t0, chars: 0, erro: motivo, texto: "" };
  }
}

async function esperarServidor(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE + "/health", { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const resultados = [];
function reg(ferramenta, alvo, r, obs = "") {
  resultados.push({ ferramenta, alvo, ok: r.ok, ms: r.ms, status: r.status, chars: r.chars, obs: obs || r.erro });
  const marca = r.ok ? "OK  " : "FALHA";
  console.log(
    `${marca} ${ferramenta.padEnd(20)} ${String(r.ms).padStart(6)} ms  ${String(r.chars).padStart(7)} chars  ${alvo}` +
      (obs ? `  [${obs}]` : "") +
      (!r.ok && r.erro ? `  !! ${r.erro}` : "")
  );
}

/* ----------------------------- sites pesados ----------------------------- */
const PESADO = {
  noticia: "https://www.theguardian.com/international",
  pesadoLinks: "https://www.bbc.com/news",
  wikipedia: "https://en.wikipedia.org/wiki/Brazil",
  bbc: "https://www.bbc.com/news",
  reddit: "https://www.reddit.com/",
  amazon: "https://www.amazon.com/",
  nytimes: "https://www.nytimes.com/",
  arxivPdf: "https://arxiv.org/pdf/1706.03762",
  youtube: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  feed: "https://hnrss.org/frontpage",
  githubApi: "https://api.github.com/repos/nodejs/node",
  spa: "https://nextjs.org/",
  sitemap: "https://www.bbc.com",
  crawl: "https://www.iana.org",
};

console.log(`[bateria] subindo servidor na porta ${PORT}...`);
const servidor = spawn(process.execPath, ["server.js", "--http"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    MCP_AUTH_TOKEN: TOKEN,
    RATE_LIMIT_MAX: "1000000",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
servidor.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
servidor.stderr.on("data", (d) => process.stderr.write(`[servidor-err] ${d}`));

try {
  if (!(await esperarServidor())) {
    console.error("[bateria] FALHA: servidor nao subiu");
    process.exit(1);
  }
  console.log(`[bateria] servidor no ar em ${BASE}\n`);

  await rpc("initialize", { protocolVersion: "2024-11-05" });

  // 0. catalogo
  {
    const t0 = Date.now();
    const cat = await rpc("tools/list", {});
    const nomes = cat.json?.result?.tools?.map((t) => t.name) || [];
    reg("tools/list", "catalogo", { ok: cat.status === 200, status: cat.status, ms: Date.now() - t0, chars: JSON.stringify(cat.json || {}).length, erro: "" }, `${nomes.length} ferramentas`);
    console.log(`      ferramentas: ${nomes.join(", ")}\n`);
  }

  const T = { maxChars: 25000, timeoutMs: TOOL_TIMEOUT };

  // 1. read_page — site de noticia grande, no teto de chars
  reg("read_page", "guardian (teto 25000)", await chamar("read_page", { url: PESADO.noticia, ...T }));
  // 1b. read_page — wikipedia artigo enorme
  reg("read_page", "wikipedia/Brazil", await chamar("read_page", { url: PESADO.wikipedia, ...T }));
  // 1c. cache quente: mesma URL de novo
  reg("read_page", "guardian (cache quente)", await chamar("read_page", { url: PESADO.noticia, ...T }), "esperado: bem menor");

  // 2. extract_links — pagina cheia de links
  reg("extract_links", "bbc.com/news limit 500", await chamar("extract_links", { url: PESADO.pesadoLinks, limit: 500, timeoutMs: TOOL_TIMEOUT }));

  // 3. read_multiple_pages — 10 sites pesados de uma vez
  {
    const urls = [PESADO.noticia, PESADO.wikipedia, PESADO.bbc, PESADO.nytimes, PESADO.amazon, PESADO.reddit, "https://stackoverflow.com/questions", "https://www.theguardian.com/international", "https://www.washingtonpost.com/", "https://www.reuters.com/"];
    reg("read_multiple_pages", "10 sites pesados", await chamar("read_multiple_pages", { urls, maxChars: 2000, timeoutMs: TOOL_TIMEOUT }));
  }

  // 4. discover_urls
  reg("discover_urls", "bbc.com (sitemap/robots)", await chamar("discover_urls", { url: PESADO.sitemap, limit: 200, timeoutMs: TOOL_TIMEOUT }));

  // 5. crawl_site
  reg("crawl_site", "iana.org maxPages 5", await chamar("crawl_site", { url: PESADO.crawl, maxPages: 5, maxChars: 1000, timeoutMs: TOOL_TIMEOUT }));

  // 6. read_dynamic_page
  reg("read_dynamic_page", "nextjs.org (SPA)", await chamar("read_dynamic_page", { url: PESADO.spa, maxChars: 4000, timeoutMs: TOOL_TIMEOUT }));

  // 7. read_video
  reg("read_video", "youtube", await chamar("read_video", { url: PESADO.youtube, maxChars: 4000, timeoutMs: TOOL_TIMEOUT }));

  // 8. read_pdf — paper de verdade (~2 MB)
  reg("read_pdf", "arxiv 1706.03762", await chamar("read_pdf", { url: PESADO.arxivPdf, maxChars: 5000, timeoutMs: TOOL_TIMEOUT }));

  // 9. read_feed
  reg("read_feed", "hnrss frontpage", await chamar("read_feed", { url: PESADO.feed, limit: 30, timeoutMs: TOOL_TIMEOUT }));

  // 10. read_json
  reg("read_json", "api.github nodejs/node", await chamar("read_json", { url: PESADO.githubApi, path: "stargazers_count", timeoutMs: TOOL_TIMEOUT }));

  // 11. find_on_page
  reg("find_on_page", "wikipedia/Brazil 'Brasil'", await chamar("find_on_page", { url: PESADO.wikipedia, query: "Brasil", maxHits: 30, timeoutMs: TOOL_TIMEOUT }));

  // 12. diff_page — marca e depois compara
  reg("diff_page", "guardian (marca)", await chamar("diff_page", { url: PESADO.noticia, force: true, timeoutMs: TOOL_TIMEOUT }));
  reg("diff_page", "guardian (compara)", await chamar("diff_page", { url: PESADO.noticia, timeoutMs: TOOL_TIMEOUT }));

  /* ------------------------------- resumo ------------------------------- */
  const ok = resultados.filter((r) => r.ok).length;
  console.log(`\n===== RESUMO: ${ok}/${resultados.length} chamadas OK =====`);
  const tempos = resultados.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  const p = (q) => tempos[Math.min(tempos.length - 1, Math.floor(tempos.length * q))] || 0;
  console.log(`tempos das OK: min ${tempos[0]} ms | p50 ${p(0.5)} ms | p95 ${p(0.95)} ms | max ${tempos[tempos.length - 1]} ms`);

  const saida = { base: BASE, quando: new Date().toISOString(), resultados };
  writeFileSync("dev/load/bateria-tempo-pesado.json", JSON.stringify(saida, null, 2));
  console.log("gravado: dev/load/bateria-tempo-pesado.json");
} finally {
  servidor.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  servidor.kill("SIGKILL");
}
