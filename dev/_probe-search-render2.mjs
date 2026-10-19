#!/usr/bin/env node
/**
 * _probe-search-render2.mjs — quais provedores de busca o DEPLOY alcanca?
 *
 * A sonda 1 provou que o Render nao alcanca o DuckDuckGo (timeout = IP de
 * datacenter bloqueado). Agora a pergunta que decide o caminho: existe algum
 * motor que ATENDA o Render? Aqui nao se julga o robots nem o parse — so se a
 * conexao completa e o que volta (status/corpo). O read_page do proprio deploy
 * e quem testa, porque quem precisa alcancar e ele, nao a maquina de casa.
 *
 * Uso: node dev/_probe-search-render2.mjs <https://...onrender.com> <token>
 */
const base = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || "";
if (!base || !token) {
  console.error("uso: node dev/_probe-search-render2.mjs <https://sua-url.onrender.com> <token>");
  process.exit(1);
}

const Q = "web scraping etica";
const alvos = [
  ["brave", `https://search.brave.com/search?q=${encodeURIComponent(Q)}`],
  ["ecosia", `https://www.ecosia.org/search?q=${encodeURIComponent(Q)}`],
  ["bing", `https://www.bing.com/search?q=${encodeURIComponent(Q)}`],
  ["startpage", `https://www.startpage.com/sp/search?query=${encodeURIComponent(Q)}`],
  ["marginalia", `https://search.marginalia.nu/search?query=${encodeURIComponent(Q)}`],
  ["mojeek", `https://www.mojeek.com/search?q=${encodeURIComponent(Q)}`],
  ["wikipedia-api", `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(Q)}&format=json&srlimit=5`],
  ["google", `https://www.google.com/search?q=${encodeURIComponent(Q)}`],
];

async function chamar(name, args, id) {
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(90000),
  });
  const json = await res.json().catch(() => null);
  const texto = (json && json.result && json.result.content && json.result.content[0].text) || "";
  return { status: res.status, isError: Boolean(json && json.result && json.result.isError), texto };
}

console.log(`alvo: ${base}\n`);

let id = 1;
for (const [nome, url] of alvos) {
  const t0 = Date.now();
  const r = await chamar("read_page", { url, maxChars: 3000, timeoutMs: 20000 }, id++);
  const ms = Date.now() - t0;
  // Links externos que o markdown deixou: sinal de que veio pagina de resultados.
  const links = [...r.texto.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]);
  const externos = links.filter((u) => !u.includes(new URL(url).hostname));
  const erro = (r.texto.match(/Erro: [^\n]*/) || [""])[0];
  console.log(`===== ${nome} =====`);
  console.log(`  ${r.isError ? "ERRO" : "OK"} | ${ms} ms | saida ${r.texto.length} chars | links externos ${externos.length}`);
  if (erro) console.log(`  ${erro.slice(0, 130)}`);
  console.log(`  trecho: ${r.texto.replace(/\s+/g, " ").slice(0, 200)}`);
}

console.log("\n===== fim =====");
