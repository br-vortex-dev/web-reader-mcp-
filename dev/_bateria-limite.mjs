#!/usr/bin/env node
/**
 * _bateria-limite.mjs — leva as 12 ferramentas ao LIMITE e cronometra cada uma.
 *
 * Regras desta bateria:
 *  - todo parâmetro numérico vai no máximo que o schema aceita
 *    (maxChars 25000, limit 200/300/100, maxPages 30, maxHits 100, contexto 5)
 *  - alvos escolhidos entre as páginas mais pesadas que existem em HTML público
 *    (nodejs.org/api/all.html, docs.python.org, whatwg spec, RFC em HTML)
 *  - timeout de ferramenta em 120s e de cliente em 180s, para o teto ser do
 *    motor e não do cronômetro
 *  - cada medição é gravada em disco NA HORA (JSON reescrito a cada caso),
 *    então interrupção no meio não perde o que já foi medido
 *
 * Uso:
 *   node dev/_bateria-limite.mjs            -> fase 1 + fase 2 + cache quente
 *   node dev/_bateria-limite.mjs 1          -> só fase 1 (uma por ferramenta)
 *   node dev/_bateria-limite.mjs 2          -> só fase 2 (estresse)
 *   node dev/_bateria-limite.mjs cache      -> só cache quente
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const FASE = process.argv[2] || "tudo";
const PORT = 6300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "bateria-limite-token";
const TOOL_TIMEOUT = 120000; // teto pedido à ferramenta
const CLIENT_TIMEOUT = 180000; // teto do cliente, maior de proposito
const SAIDA = "dev/load/bateria-limite.json";

const auth = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
let idSeq = 1;

const resultados = [];
const registrarEmDisco = () => {
  mkdirSync("dev/load", { recursive: true });
  writeFileSync(
    SAIDA,
    JSON.stringify(
      { base: BASE, quando: new Date().toISOString(), dispositivo: process.platform, resultados },
      null,
      2
    )
  );
};

async function rpc(method, params) {
  const res = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++idSeq, method, params }),
    signal: AbortSignal.timeout(CLIENT_TIMEOUT),
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
        ? texto.replace(/\s+/g, " ").slice(0, 200)
        : json?.error?.message || "",
      texto,
    };
  } catch (e) {
    const motivo =
      e.name === "TimeoutError" || e.name === "AbortError" || e.name === "DOMException"
        ? `timeout do cliente (${CLIENT_TIMEOUT}ms)`
        : e.message;
    return { ok: false, status: 0, ms: Date.now() - t0, chars: 0, erro: motivo, texto: "" };
  }
}

async function esperarServidor(ms = 25000) {
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

function reg(fase, ferramenta, alvo, r, extra = {}) {
  const linha = {
    fase,
    ferramenta,
    alvo,
    ok: r.ok,
    ms: r.ms,
    status: r.status,
    chars: r.chars,
    erro: r.ok ? "" : r.erro,
    ...extra,
  };
  resultados.push(linha);
  registrarEmDisco();
  const marca = r.ok ? "OK   " : "FALHA";
  console.log(
    `${marca} ${ferramenta.padEnd(20)} ${String(r.ms).padStart(7)} ms  ${String(r.chars).padStart(7)} chars  ${alvo}` +
      (r.ok ? "" : `  !! ${r.erro}`)
  );
}

/* ===================== alvos: o mais pesado que existe ===================== */
const A = {
  // HTML gigante de verdade
  nodeApiAll: "https://nodejs.org/api/all.html", // ~8 MB de HTML
  whatwg: "https://html.spec.whatwg.org/multipage/", // ~12 MB, o mais pesado em HTML publico
  pythonStd: "https://docs.python.org/3/library/stdtypes.html", // ~2 MB
  rfcHtml: "https://www.rfc-editor.org/rfc/rfc9110.html", // RFC inteira em HTML
  gnuBash: "https://www.gnu.org/software/bash/manual/bash.html",
  // noticia/home cheia de link e JS
  guardian: "https://www.theguardian.com/international",
  bbc: "https://www.bbc.com/news",
  nyt: "https://www.nytimes.com/",
  reuters: "https://www.reuters.com/",
  wapo: "https://www.washingtonpost.com/",
  amazon: "https://www.amazon.com/",
  reddit: "https://www.reddit.com/",
  stack: "https://stackoverflow.com/questions",
  github: "https://github.com/nodejs/node",
  // SPA / JS
  nextjs: "https://nextjs.org/",
  reactDocs: "https://react.dev/learn",
  // midia
  youtube: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  // PDF grande: RFC 9000 (QUIC), ~150 paginas
  pdfGrande: "https://www.rfc-editor.org/rfc/rfc9000.pdf",
  pdfPaper: "https://arxiv.org/pdf/1706.03762",
  // feed e API
  feed: "https://hnrss.org/frontpage",
  apiJson: "https://api.github.com/repos/nodejs/node/commits?per_page=100",
  apiJsonGrande: "https://api.github.com/repos/nodejs/node/contents",
};

const T = { maxChars: 25000, timeoutMs: TOOL_TIMEOUT }; // teto do schema

console.log(`[bateria-limite] fase=${FASE} porta=${PORT}`);
const servidor = spawn(process.execPath, ["server.js", "--http"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    MCP_AUTH_TOKEN: TOKEN,
    RATE_LIMIT_MAX: "1000000",
    // cache grande para a passada quente nao expulsar entrada no meio
    CACHE_MAX_ENTRIES: "512",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
servidor.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
servidor.stderr.on("data", (d) => process.stderr.write(`[servidor-err] ${d}`));

try {
  if (!(await esperarServidor())) {
    console.error("[bateria-limite] FALHA: servidor nao subiu");
    process.exit(1);
  }
  console.log(`[bateria-limite] no ar: ${BASE}\n`);
  await rpc("initialize", { protocolVersion: "2024-11-05" });

  /* ---------------------------- catalogo ---------------------------- */
  {
    const t0 = Date.now();
    const cat = await rpc("tools/list", {});
    const nomes = cat.json?.result?.tools?.map((t) => t.name) || [];
    reg("0", "tools/list", "catalogo", {
      ok: cat.status === 200 && nomes.length === 12,
      status: cat.status,
      ms: Date.now() - t0,
      chars: JSON.stringify(cat.json || {}).length,
      erro: cat.status === 200 ? "" : "falhou",
    }, { ferramentas: nomes.length });
    console.log(`      ferramentas (${nomes.length}): ${nomes.join(", ")}\n`);
  }

  /* ================= FASE 1 — cada ferramenta no limite ================= */
  if (FASE === "tudo" || FASE === "1") {
    console.log("========== FASE 1: cada ferramenta no teto do schema ==========");

    // 1. read_page — HTML de 8 MB e de 12 MB
    reg("1", "read_page", `nodejs.org/api/all.html maxChars ${T.maxChars}`,
      await chamar("read_page", { url: A.nodeApiAll, ...T }), { alvoBytes: "~8 MB HTML" });
    reg("1", "read_page", `whatwg spec maxChars ${T.maxChars}`,
      await chamar("read_page", { url: A.whatwg, ...T }), { alvoBytes: "~12 MB HTML" });
    reg("1", "read_page", `docs.python stdtypes maxChars ${T.maxChars}`,
      await chamar("read_page", { url: A.pythonStd, ...T }), { alvoBytes: "~2 MB HTML" });

    // 2. extract_links — limit no máximo (200)
    reg("1", "extract_links", `guardian limit 200`,
      await chamar("extract_links", { url: A.guardian, limit: 200, timeoutMs: TOOL_TIMEOUT }));
    reg("1", "extract_links", `bbc/news limit 200`,
      await chamar("extract_links", { url: A.bbc, limit: 200, timeoutMs: TOOL_TIMEOUT }));
    reg("1", "extract_links", `nodejs all limit 200`,
      await chamar("extract_links", { url: A.nodeApiAll, limit: 200, timeoutMs: TOOL_TIMEOUT }));

    // 3. read_multiple_pages — 30 URLs (o máximo), cada uma no teto
    {
      const urls = [
        A.nodeApiAll, A.pythonStd, A.rfcHtml, A.gnuBash,
        A.guardian, A.bbc, A.nyt, A.reuters, A.wapo, A.amazon,
        A.reddit, A.stack, A.github, A.nextjs, A.reactDocs,
        "https://docs.docker.com/engine/reference/commandline/docker/",
        "https://www.typescriptlang.org/docs/handbook/intro.html",
        "https://webpack.js.org/concepts/",
        "https://www.postgresql.org/docs/current/sql-select.html",
        "https://redis.io/docs/latest/commands/",
        "https://nginx.org/en/docs/http/ngx_http_core_module.html",
        "https://curl.se/docs/manual.html",
        "https://git-scm.com/docs/git-rebase",
        "https://www.kernel.org/doc/html/latest/",
        "https://go.dev/ref/spec",
        "https://doc.rust-lang.org/book/",
        "https://www.php.net/manual/en/index.php",
        "https://ruby-doc.org/core-3.3.0/",
        "https://dev.mysql.com/doc/refman/8.0/en/",
        "https://kubernetes.io/docs/reference/",
      ];
      console.log(`      read_multiple_pages: ${urls.length} URLs, maxChars ${T.maxChars}`);
      reg("1", "read_multiple_pages", `${urls.length} sites pesados, maxChars 25000 (pico de carga)`,
        await chamar("read_multiple_pages", { urls, maxChars: T.maxChars, timeoutMs: TOOL_TIMEOUT }),
        { urls: urls.length });
    }

    // 4. discover_urls — limit 300 (máximo)
    reg("1", "discover_urls", "bbc.com limit 300 (sitemap)",
      await chamar("discover_urls", { url: "https://www.bbc.com", limit: 300, timeoutMs: TOOL_TIMEOUT }));
    reg("1", "discover_urls", "nytimes limit 300",
      await chamar("discover_urls", { url: "https://www.nytimes.com", limit: 300, timeoutMs: TOOL_TIMEOUT }));

    // 5. crawl_site — maxPages 30 (o máximo) e maxChars no teto
    reg("1", "crawl_site", "iana.org maxPages 10 maxChars 25000",
      await chamar("crawl_site", { url: "https://www.iana.org", maxPages: 10, maxChars: T.maxChars, timeoutMs: TOOL_TIMEOUT }));

    // 6. read_dynamic_page — SPA com JS, teto de chars
    reg("1", "read_dynamic_page", "nextjs.org maxChars 25000",
      await chamar("read_dynamic_page", { url: A.nextjs, ...T }));
    reg("1", "read_dynamic_page", "react.dev maxChars 25000",
      await chamar("read_dynamic_page", { url: A.reactDocs, ...T }));

    // 7. read_video — vídeo com legenda, teto
    reg("1", "read_video", "youtube maxChars 25000",
      await chamar("read_video", { url: A.youtube, ...T }));

    // 8. read_pdf — PDF grande de verdade (RFC 9000, ~150 páginas)
    reg("1", "read_pdf", "rfc9000.pdf (~150 pág) maxChars 25000",
      await chamar("read_pdf", { url: A.pdfGrande, ...T }));
    reg("1", "read_pdf", "arxiv 1706.03762 maxChars 25000",
      await chamar("read_pdf", { url: A.pdfPaper, ...T }));

    // 9. read_feed — limit 100 (máximo)
    reg("1", "read_feed", "hnrss limit 100",
      await chamar("read_feed", { url: A.feed, limit: 100, ...T }));

    // 10. read_json — payload grande, sem path (raiz inteira)
    reg("1", "read_json", "github commits 100 (raiz)",
      await chamar("read_json", { url: A.apiJson, ...T }));
    reg("1", "read_json", "github contents (raiz)",
      await chamar("read_json", { url: A.apiJsonGrande, ...T }));

    // 11. find_on_page — maxHits 100, contexto 5 (ambos no máximo)
    reg("1", "find_on_page", "nodejs all 'function' maxHits 100 ctx 5",
      await chamar("find_on_page", { url: A.nodeApiAll, query: "function", maxHits: 100, contexto: 5, timeoutMs: TOOL_TIMEOUT }));
    reg("1", "find_on_page", "whatwg regex maxHits 100 ctx 5",
      await chamar("find_on_page", { url: A.whatwg, query: "\\bTODO\\b", regex: true, maxHits: 100, contexto: 5, timeoutMs: TOOL_TIMEOUT }));

    // 12. diff_page — marca e compara no teto
    reg("1", "diff_page", "guardian force (grava marca)",
      await chamar("diff_page", { url: A.guardian, force: true, ...T }));
    reg("1", "diff_page", "guardian compara (diff)",
      await chamar("diff_page", { url: A.guardian, ...T }));

    console.log("");
  }

  /* ================= FASE 2 — estresse de multiplicidade ================= */
  if (FASE === "tudo" || FASE === "2") {
    console.log("========== FASE 2: estresse (limites de cardinalidade) ==========");

    // crawl no máximo absoluto: 30 páginas
    reg("2", "crawl_site", "iana.org maxPages 30 maxChars 25000 (teto)",
      await chamar("crawl_site", { url: "https://www.iana.org", maxPages: 30, maxChars: T.maxChars, timeoutMs: TOOL_TIMEOUT }));

    // crawl num site grande de documentação
    reg("2", "crawl_site", "python.org docs maxPages 30",
      await chamar("crawl_site", { url: "https://docs.python.org/3/", maxPages: 30, maxChars: 5000, timeoutMs: TOOL_TIMEOUT }));

    // multiple pages com 30 URLs de HTML gigante
    {
      const urls = Array.from({ length: 30 }, (_, i) => [
        A.nodeApiAll, A.pythonStd, A.rfcHtml, A.gnuBash, A.whatwg,
      ][i % 5]);
      reg("2", "read_multiple_pages", "30 URLs de HTML gigante maxChars 25000",
        await chamar("read_multiple_pages", { urls, maxChars: T.maxChars, timeoutMs: TOOL_TIMEOUT }),
        { urls: 30 });
    }

    // find_on_page com regex ampla no HTML de 12 MB
    reg("2", "find_on_page", "whatwg '.' regex maxHits 100 ctx 5",
      await chamar("find_on_page", { url: A.whatwg, query: ".", regex: true, maxHits: 100, contexto: 5, timeoutMs: TOOL_TIMEOUT }));

    console.log("");
  }

  /* ===================== passada de cache quente ===================== */
  if (FASE === "tudo" || FASE === "cache") {
    console.log("========== CACHE QUENTE: mesma URL, segunda chamada ==========");
    reg("cache", "read_page", "nodejs all (2a chamada)",
      await chamar("read_page", { url: A.nodeApiAll, ...T }));
    reg("cache", "read_page", "whatwg (2a chamada)",
      await chamar("read_page", { url: A.whatwg, ...T }));
    reg("cache", "extract_links", "guardian (2a chamada)",
      await chamar("extract_links", { url: A.guardian, limit: 200, timeoutMs: TOOL_TIMEOUT }));
    reg("cache", "read_pdf", "rfc9000.pdf (2a chamada)",
      await chamar("read_pdf", { url: A.pdfGrande, ...T }));
    reg("cache", "find_on_page", "nodejs all (2a chamada)",
      await chamar("find_on_page", { url: A.nodeApiAll, query: "function", maxHits: 100, contexto: 5, timeoutMs: TOOL_TIMEOUT }));
    console.log("");
  }

  /* ============================== resumo ============================== */
  const ok = resultados.filter((r) => r.ok);
  console.log(`===== RESUMO: ${ok.length}/${resultados.length} chamadas OK =====`);
  const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
  const q = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * p))] : 0);
  console.log(
    `tempo das OK: min ${ms[0] || 0} ms | p50 ${q(0.5)} ms | p95 ${q(0.95)} ms | max ${ms[ms.length - 1] || 0} ms`
  );
  const totalChars = ok.reduce((s, r) => s + r.chars, 0);
  console.log(`bytes de saida somados: ${totalChars} chars`);
  const falhas = resultados.filter((r) => !r.ok);
  if (falhas.length) {
    console.log(`\nfalhas (${falhas.length}):`);
    for (const f of falhas) console.log(`  - ${f.ferramenta} [${f.alvo}]: ${f.erro}`);
  }
  registrarEmDisco();
  console.log(`\ngravado: ${SAIDA}`);
} finally {
  servidor.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  servidor.kill("SIGKILL");
}
