#!/usr/bin/env node
// _probe-bateria.mjs — health do deploy + quais variantes de token autenticam.
const base = "https://web-reader-mcp-13z0.onrender.com";

async function tryHealth() {
  const t0 = Date.now();
  try {
    const r = await fetch(base + "/health", { signal: AbortSignal.timeout(60000) });
    const t = await r.text();
    console.log(`health -> HTTP ${r.status} em ${Date.now() - t0} ms`);
    console.log(t.slice(0, 400));
  } catch (e) {
    console.log(`health FALHOU: ${e.message}`);
  }
}

async function tryToken(rotulo, tok) {
  const t0 = Date.now();
  try {
    const r = await fetch(base + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json().catch(() => null);
    const n = j?.result?.tools?.length;
    console.log(`token [${rotulo}] len=${tok.length} -> HTTP ${r.status} em ${Date.now() - t0} ms${n != null ? ` | ${n} ferramentas` : ""}`);
  } catch (e) {
    console.log(`token [${rotulo}] FALHOU: ${e.message}`);
  }
}

await tryHealth();
console.log("");
await tryToken("A (32)", "tRqOmW3l9kVq8rgOdIvi7hBIW3WV9YJs");
await tryToken("B (full)", "tRqOmW3l9kVq8rgOdIvi7hBIW3WV9YJs/LiBx446FYw=");
await tryToken("C (40?)", "LiBx446FYw=");
