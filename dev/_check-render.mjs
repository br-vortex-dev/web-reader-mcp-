// _check-render.mjs - superficie PUBLICA do MCP no Render (sem token).
//
// Ordem real dos guardas do /mcp (src/http-transport.mjs, handlerMcp):
//   1. auth  -> sem/errado token = 401 (mesmo em GET)
//   2. rate limit
//   3. metodo -> GET com token valido = 405
// Ou seja: GET /mcp SEM token devolve 401, nao 405. Testar aqui so o que
// nao precisa de token; o restante roda com scripts/live-test.mjs <url> <token>.
//
// Uso: node dev/_check-render.mjs
const base = "https://web-reader-mcp-13z0.onrender.com";
// Cobre o cold start do plano free (~50 s).
const TIMEOUT_MS = 120000;

let pass = 0, fail = 0;
const falhas = [];
function check(cond, label, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  ->  " + extra : ""}`);
  if (cond) pass++; else { fail++; falhas.push(label); }
}
const fetchT = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });

console.log(`alvo: ${base}\n`);

/* ------------------------- rotas publicas ------------------------- */

try {
  const t0 = Date.now();
  const res = await fetchT(base + "/");
  const t = await res.text();
  check(res.status === 200 && /web-reader-mcp/.test(t), "GET / devolve o health", `status ${res.status} em ${Date.now() - t0} ms`);
} catch (e) { check(false, "GET / devolve o health", e.message); }

try {
  const res = await fetchT(base + "/health");
  const t = await res.text();
  const formatoNovo = /cache: \d+ entradas, \d+ bytes/.test(t) && /rss: \d+ MB/.test(t) && /coalescidas/.test(t);
  check(res.status === 200 && formatoNovo, "GET /health com contadores (coalescidas/revalidacoes)", t.slice(0, 80));
} catch (e) { check(false, "GET /health com contadores", e.message); }

try {
  const res = await fetchT(base + "/nao-existe");
  const t = await res.text();
  check(res.status === 404 && t === "not found", "404 em path desconhecido", `status ${res.status}, corpo "${t.slice(0, 20)}"`);
} catch (e) { check(false, "404 em path desconhecido", e.message); }

/* ----------------------- CORS e autenticacao ---------------------- */

try {
  const res = await fetchT(base + "/mcp", { method: "OPTIONS" });
  await res.text();
  const ok = res.status === 204
    && res.headers.get("access-control-allow-origin") === "*"
    && res.headers.get("access-control-allow-methods") === "POST, GET, OPTIONS"
    && res.headers.get("access-control-allow-headers") === "content-type, mcp-session-id, last-event-id, authorization";
  check(ok, "OPTIONS /mcp devolve 204 com CORS completo", `status ${res.status}`);
} catch (e) { check(false, "OPTIONS /mcp devolve 204 com CORS completo", e.message); }

try {
  const res = await fetchT(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const t = await res.text();
  let j = null; try { j = JSON.parse(t); } catch { /* vazio */ }
  const ok = res.status === 401
    && res.headers.get("www-authenticate") === "Bearer"
    && res.headers.get("access-control-allow-origin") === "*"
    && j?.error?.code === -32001 && /Não autorizado/.test(j?.error?.message || "");
  check(ok, "POST /mcp SEM token: 401 + www-authenticate + -32001", `status ${res.status}`);
} catch (e) { check(false, "POST /mcp SEM token: 401 + www-authenticate + -32001", e.message); }

try {
  const res = await fetchT(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token-errado-de-proposito" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  await res.text();
  check(res.status === 401, "POST /mcp com token ERRADO: 401", `status ${res.status}`);
} catch (e) { check(false, "POST /mcp com token ERRADO: 401", e.message); }

try {
  const res = await fetchT(base + "/mcp", { method: "GET" });
  await res.text();
  check(res.status === 401, "GET /mcp SEM token: 401 (auth antes do metodo) — contrato", `status ${res.status}`);
} catch (e) { check(false, "GET /mcp SEM token: 401 (auth antes do metodo)", e.message); }

console.log(`\nresultado (superficie publica, sem token): ${pass} passaram, ${fail} falharam`);
if (falhas.length) console.log("falhas: " + falhas.join(" | "));
process.exit(fail ? 1 : 0);
