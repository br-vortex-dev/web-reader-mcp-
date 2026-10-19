#!/usr/bin/env node
/**
 * _probe-token.mjs — confere QUAL token autentica no /mcp do Render.
 *
 * Uso: node dev/_probe-token.mjs <https://...onrender.com> <token1> [token2 ...]
 * Não grava nada em arquivo; só imprime o resultado de cada candidato.
 */
const [base, ...tokens] = process.argv.slice(2);
if (!base || !tokens.length) {
  console.error("uso: node dev/_probe-token.mjs <https://...onrender.com> <token...>");
  process.exit(1);
}

for (const token of tokens) {
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    signal: AbortSignal.timeout(120000),
  });
  const texto = await res.text();
  const autenticou = res.status === 200 && texto.includes("read_page");
  console.log(`token de ${token.length} chars -> status ${res.status} | autenticou: ${autenticou}`);
  if (!autenticou && res.status !== 200) console.log("  resposta: " + texto.slice(0, 160));
}
