#!/usr/bin/env node
/**
 * _check-token.mjs — usa a URL e o token do deploy para chamar as ferramentas
 * de conteúdo no /mcp autenticado (prova de que o token abre as ferramentas).
 *
 * Uso: node dev/_check-token.mjs <https://...onrender.com> <token>
 */
const base = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || "";
if (!base || !token) {
  console.error("uso: node dev/_check-token.mjs <https://sua-url.onrender.com> <token>");
  process.exit(1);
}

async function chamar(name, args, id) {
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json().catch(() => null);
  const texto = (json && json.result && json.result.content && json.result.content[0].text) || "";
  return { status: res.status, isError: Boolean(json && json.result && json.result.isError), texto };
}

console.log(`alvo: ${base}\n`);

// 1. tools/list — o token enxerga o catálogo de ferramentas
{
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list" }),
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json().catch(() => null);
  const nomes = (json && json.result && json.result.tools ? json.result.tools.map((t) => t.name) : []);
  console.log(`tools/list -> status ${res.status} | ${nomes.length} ferramentas: ${nomes.join(", ")}`);
}

// 2. read_page num site simples
{
  const r = await chamar("read_page", { url: "https://example.com", maxChars: 800 }, 1);
  const titulo = (r.texto.match(/Titulo: [^\n]*/) || r.texto.match(/^# [^\n]*/m) || [""])[0];
  console.log(`\nread_page(example.com) -> status ${r.status} | isError ${r.isError}`);
  console.log(`   ${titulo.slice(0, 120)}`);
  console.log(`   trecho: ${r.texto.replace(/\s+/g, " ").slice(0, 220)}`);
}

// 3. extract_links num site com links
{
  const r = await chamar("extract_links", { url: "https://example.com" }, 2);
  const total = (r.texto.match(/\d+ links?/) || [""])[0];
  console.log(`\nextract_links(example.com) -> status ${r.status} | isError ${r.isError} | ${total}`);
}
