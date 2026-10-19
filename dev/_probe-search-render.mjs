#!/usr/bin/env node
/**
 * _probe-search-render.mjs — o deploy no Render (IP de datacenter) alcanca a
 * pagina de busca do DuckDuckGo? A pergunta que decide o plano: na maquina de
 * casa a sonda local passou; datacenter e tratado diferente.
 *
 * Nada aqui entra no produto: e sonda de campo. Como a ferramenta read_search
 * ainda nao existe, usa o read_page do proprio deploy para REVELAR se a pagina
 * de busca do DDG chega ou se o Render leva 403/429/bloqueio.
 *
 * Uso: node dev/_probe-search-render.mjs <https://...onrender.com> <token>
 */
const base = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || "";
if (!base || !token) {
  console.error("uso: node dev/_probe-search-render.mjs <https://sua-url.onrender.com> <token>");
  process.exit(1);
}

const CONSULTA = "web scraping etica";
const alvos = [
  ["ddg-html", `https://html.duckduckgo.com/html/?q=${encodeURIComponent(CONSULTA)}`],
  ["ddg-lite", `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(CONSULTA)}`],
];

async function chamar(name, args, id) {
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json().catch(() => null);
  const texto = (json && json.result && json.result.content && json.result.content[0].text) || "";
  return { status: res.status, isError: Boolean(json && json.result && json.result.isError), texto };
}

console.log(`alvo: ${base}\n`);

// 1. O deploy responde e esta vivo?
{
  const res = await fetch(base + "/health", { signal: AbortSignal.timeout(30000) });
  const txt = await res.text().catch(() => "");
  console.log(`/health -> status ${res.status} | ${txt.split("\n")[0].slice(0, 90)}`);
}

let id = 1;
for (const [nome, url] of alvos) {
  const r = await chamar("read_page", { url, maxChars: 4000, timeoutMs: 25000 }, id++);
  // Conta links de resultado que o markdown do read_page deixou passar.
  const links = [...r.texto.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]);
  const ddgHost = links.filter((u) => /duckduckgo\.com\/l\//.test(u)).length;
  console.log(`\n===== ${nome} =====`);
  console.log(`read_page -> status ${r.status} | isError ${r.isError} | ${r.texto.length} chars de saida`);
  console.log(`   trecho: ${r.texto.replace(/\s+/g, " ").slice(0, 240)}`);
  console.log(`   links totais na saida: ${links.length} | links de redirecionamento ddg: ${ddgHost}`);
}

console.log("\n===== fim =====");
