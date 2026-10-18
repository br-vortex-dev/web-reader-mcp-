#!/usr/bin/env node
/**
 * _espera-deploy-video.mjs — espera o deploy do fallback de vídeo aparecer.
 *
 * Como a versão segue 1.2.0, o marcador do deploy novo é o COMPORTAMENTO:
 * o /watch do YouTube dá 429 no Render, e a partir deste deploy a resposta
 * tem de vir com "Aviso: metadados parciais (via oEmbed)" em vez de
 * "Erro: HTTP 429".
 *
 * Uso: node dev/_espera-deploy-video.mjs <url> <token> [minutos]
 */
const base = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || process.env.MCP_AUTH_TOKEN || "";
const minutos = Number(process.argv[4]) || 6;
if (!base || !token) {
  console.error("uso: node dev/_espera-deploy-video.mjs <url> <token> [minutos]");
  process.exit(1);
}

const limite = Date.now() + minutos * 60 * 1000;
let tentativa = 0;
while (Date.now() < limite) {
  tentativa++;
  try {
    const res = await fetch(base + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "read_video",
          arguments: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", maxChars: 1500 },
        },
      }),
      signal: AbortSignal.timeout(120000),
    });
    const json = await res.json().catch(() => null);
    const texto = (json && json.result && json.result.content && json.result.content[0].text) || "";
    const isError = Boolean(json && json.result && json.result.isError);
    const fallback = /Aviso: metadados parciais \(via oEmbed\)/.test(texto);
    const resumo = texto.split("\n").slice(0, 4).join(" | ");
    console.log(`[${tentativa}] isError=${isError} fallback=${fallback}`);
    console.log(`     ${resumo.slice(0, 220)}`);
    if (!isError && fallback) {
      console.log("\nOK: deploy com o fallback no ar.");
      process.exit(0);
    }
  } catch (err) {
    console.log(`[${tentativa}] falha de rede: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 20000));
}
console.log(`\nTEMPO ESGOTADO após ${minutos} min.`);
process.exit(1);
