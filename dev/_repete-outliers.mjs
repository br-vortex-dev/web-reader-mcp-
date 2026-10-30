#!/usr/bin/env node
/**
 * _repete-outliers.mjs — repete as medições que saíram fora da curva na
 * bateria de teto, em rodízio, para separar RUÍDO DE REDE de regressão real.
 *
 * Uma volta isolada na internet oscila muito (DNS, TLS, CDN do alvo). Aqui
 * cada alvo é medido N vezes alternadas e o resultado mostra min/mediana/max.
 *
 * Uso: node dev/_repete-outliers.mjs [voltas]
 */
const BASE = process.env.RENDER_URL || "https://web-reader-mcp-13z0.onrender.com";
const TOKEN = process.env.LIVE_TEST_TOKEN || process.env.MCP_AUTH_TOKEN || "";
if (!TOKEN) { console.error("defina LIVE_TEST_TOKEN (ou MCP_AUTH_TOKEN) com o token do servidor"); process.exit(1); }
const VOLTAS = Math.max(1, Number(process.argv[2] || 5));
const auth = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
let id = 1;

async function rpc(method, params, timeoutMs = 180000) {
  const res = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function chamar(name, args) {
  const t0 = Date.now();
  try {
    const { status, json } = await rpc("tools/call", { name, arguments: args });
    const txt = json?.result?.content?.[0]?.text || "";
    return { ok: status === 200 && !json?.result?.isError, ms: Date.now() - t0, chars: txt.length };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, chars: 0, erro: e.message };
  }
}

const ALVOS = [
  ["read_page", "nodejs all.html", { url: "https://nodejs.org/api/all.html", maxChars: 25000, timeoutMs: 120000 }],
  ["read_feed", "hnrss limit 100", { url: "https://hnrss.org/frontpage", limit: 100, maxChars: 25000, timeoutMs: 120000 }],
  ["discover_urls", "iana.org limit 300", { url: "https://www.iana.org", limit: 300, timeoutMs: 120000 }],
  ["extract_links", "bbc.com/news limit 200", { url: "https://www.bbc.com/news", limit: 200, timeoutMs: 120000 }],
];

// Aquece TLS + roteador.
await chamar("read_page", { url: "https://example.com", maxChars: 2000 });

const acumulado = new Map();
for (let v = 1; v <= VOLTAS; v++) {
  console.log(`\n=== volta ${v} ===`);
  for (const [ferramenta, alvo, args] of ALVOS) {
    const r = await chamar(ferramenta, args);
    const chave = `${ferramenta} | ${alvo}`;
    if (!acumulado.has(chave)) acumulado.set(chave, []);
    acumulado.get(chave).push(r.ms);
    console.log(
      `${r.ok ? "OK   " : "FALHA"} ${String(r.ms).padStart(7)} ms  ${String(r.chars).padStart(7)} chars  ${chave}` +
        (r.erro ? `  !! ${r.erro}` : "")
    );
  }
}

console.log("\n===== resumo (ms) =====");
const p = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
for (const [chave, arr] of acumulado) {
  const s = [...arr].sort((a, b) => a - b);
  console.log(
    `${chave.padEnd(46)} min ${String(s[0]).padStart(6)} | p50 ${String(p(s, 0.5)).padStart(6)} | max ${String(s[s.length - 1]).padStart(6)}`
  );
}
