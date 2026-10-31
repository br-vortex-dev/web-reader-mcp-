#!/usr/bin/env node
/**
 * _live-pesado.mjs — latência de read_page em páginas reais pesadas, com URL
 * única por chamada (cache-busting) para medir download + conversão de verdade.
 *
 * Uso: LIVE_TEST_TOKEN=... node dev/_live-pesado.mjs [rotulo]
 */
const BASE = process.env.RENDER_URL || "https://web-reader-mcp-13z0.onrender.com";
const TOKEN = process.env.LIVE_TEST_TOKEN || process.env.MCP_AUTH_TOKEN || "";
if (!TOKEN) {
  console.error("defina LIVE_TEST_TOKEN com o token do servidor");
  process.exit(1);
}
const ROTULO = process.argv[2] || "rodada";
const auth = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
let seq = 0;

async function chamar(name, args) {
  const t0 = Date.now();
  const res = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json().catch(() => null);
  const texto = json?.result?.content?.[0]?.text || "";
  return { ok: res.status === 200 && !json?.result?.isError, ms: Date.now() - t0, chars: texto.length, erro: texto.slice(0, 120) };
}

const alvos = [
  ["whatwg multipage (~12MB)", "https://html.spec.whatwg.org/multipage/"],
  ["nodejs all.html (~8MB)", "https://nodejs.org/docs/latest/api/all.html"],
  ["washingtonpost.com", "https://www.washingtonpost.com/"],
  ["wikipedia Brazil", "https://pt.wikipedia.org/wiki/Brasil"],
];
const VOLTAS = Number(process.env.VOLTAS || 3);

console.log(`${ROTULO} | ${BASE} | ${VOLTAS} voltas de URLs unicas`);
for (const [nome, base] of alvos) {
  const tempos = [];
  let chars = 0;
  let falhas = 0;
  let erro = "";
  for (let i = 0; i < VOLTAS; i++) {
    const sep = base.includes("?") ? "&" : "?";
    const r = await chamar("read_page", { url: `${base}${sep}cb=${ROTULO}-${i}-${Date.now()}`, maxChars: 25000 });
    if (!r.ok) {
      falhas++;
      erro = r.erro;
    } else {
      tempos.push(r.ms);
      chars = r.chars;
    }
  }
  tempos.sort((a, b) => a - b);
  const med = tempos.length ? tempos[Math.floor(tempos.length / 2)] : 0;
  console.log(
    `${nome.padEnd(26)} min ${String(tempos[0] ?? "-").padStart(6)} ms | med ${String(med).padStart(6)} ms | ${chars} chars${falhas ? ` | ${falhas} falhas: ${erro}` : ""}`
  );
}
