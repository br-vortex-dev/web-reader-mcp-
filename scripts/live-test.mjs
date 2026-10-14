// live-test.mjs - testa um deploy JA NO AR (ex.: Render) do web-reader-mcp.
// Uso: node scripts/live-test.mjs <https://sua-url.onrender.com> <token>
//
// Testa, na ordem:
//   1. GET  /health      -> servidor no ar
//   2. POST /mcp sem token      -> 401 (protegido)
//   3. POST /mcp token errado   -> 401
//   4. tools/list               -> 6 ferramentas
//   5. read_page (Wikipedia PT) -> conteudo real extraido
//   6. read_multiple_pages      -> lote paralelo com 2 URLs

const base = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || "";

if (!base || !token) {
  console.error("uso: node scripts/live-test.mjs <https://sua-url.onrender.com> <token>");
  process.exit(1);
}

const MCP_URL = base + "/mcp";
const TIMEOUT_MS = Number(process.env.LIVE_TEST_TIMEOUT_MS || 120000); // cobre cold start do plano free

let pass = 0, fail = 0;
function check(cond, label, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  ->  " + extra : ""}`);
  if (cond) pass++; else fail++;
}

async function fetchTimeout(url, opts) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// chamada JSON-RPC no /mcp (com ou sem Authorization)
async function mcpCall(method, params, id, auth = true) {
  const headers = { "content-type": "application/json" };
  if (auth) headers.authorization = `Bearer ${token}`;
  const res = await fetchTimeout(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* mantem null */ }
  return { status: res.status, json, text };
}

// 1. health check
try {
  const h = await fetchTimeout(base + "/health", { method: "GET" });
  const t = await h.text();
  check(h.status === 200 && /web-reader-mcp/.test(t), "GET /health responde 200", t.trim().slice(0, 60));
} catch (e) {
  check(false, "GET /health responde 200", e.message);
}

// 2. sem token -> 401
try {
  const r = await mcpCall("tools/list", undefined, 1, false);
  check(r.status === 401, "POST /mcp SEM token devolve 401", `status ${r.status}`);
} catch (e) {
  check(false, "POST /mcp SEM token devolve 401", e.message);
}

// 3. token errado -> 401
try {
  const res = await fetchTimeout(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-errado" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  await res.text();
  check(res.status === 401, "POST /mcp com token ERRADO devolve 401", `status ${res.status}`);
} catch (e) {
  check(false, "POST /mcp com token ERRADO devolve 401", e.message);
}

// 4. tools/list -> 6 ferramentas
try {
  const r = await mcpCall("tools/list", undefined, 2);
  const names = (r.json?.result?.tools || []).map((t) => t.name);
  const esperadas = ["read_page", "extract_links", "read_multiple_pages", "discover_urls", "crawl_site"];
  const okList = r.status === 200 && esperadas.every((n) => names.includes(n));
  check(okList, "tools/list traz as 5 ferramentas", names.join(", ") || `status ${r.status}`);
} catch (e) {
  check(false, "tools/list traz as 5 ferramentas", e.message);
}

// 5. read_page numa pagina real (Wikipedia PT - pagina complexa, muitos links)
try {
  const r = await mcpCall("tools/call", { name: "read_page", arguments: { url: "https://pt.wikipedia.org/wiki/Node.js" } }, 3);
  const content = r.json?.result?.content?.[0]?.text || "";
  check(r.status === 200 && content.length > 500, "read_page le a Wikipedia (Node.js)", `${content.length} chars de conteudo`);
} catch (e) {
  check(false, "read_page le a Wikipedia (Node.js)", e.message);
}

// 6. read_multiple_pages com 2 URLs (lote paralelo)
try {
  const r = await mcpCall("tools/call", {
    name: "read_multiple_pages",
    arguments: { urls: ["https://pt.wikipedia.org/wiki/Node.js", "https://example.com"] },
  }, 4);
  const text = r.json?.result?.content?.[0]?.text || "";
  check(r.status === 200 && text.includes("example.com"), "read_multiple_pages le 2 URLs em 1 chamada", `${text.length} chars de retorno`);
} catch (e) {
  check(false, "read_multiple_pages le 2 URLs em 1 chamada", e.message);
}

console.log(`\nresultado: ${pass} passaram, ${fail} falharam de 6`);
process.exit(fail ? 1 : 0);
