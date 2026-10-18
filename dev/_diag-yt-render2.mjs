#!/usr/bin/env node
/**
 * _diag-yt-render2.mjs — o Render alcança as rotas ALTERNATIVAS do YouTube?
 *
 * A /watch do www responde 429 no Render (IP de datacenter). Este diagnóstico
 * sonda, pelo serviço no ar, as rotas candidatas a fallback:
 *   a) m.youtube.com/watch       (mesma estrutura de player?)
 *   b) youtube-nocookie.com/embed
 *   c) player do embed no www
 *   d) www.youtube.com/watch (controle — deve dar 429)
 *
 * read_page mostra se o fetch passou e o começo do conteúdo.
 *
 * Uso: node dev/_diag-yt-render2.mjs <url> <token>
 */
const base = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || process.env.MCP_AUTH_TOKEN || "";
if (!base || !token) {
  console.error("uso: node dev/_diag-yt-render2.mjs <https://sua-url.onrender.com> <token>");
  process.exit(1);
}

const vid = "dQw4w9WgXcQ";
const sondas = [
  ["a) m.youtube.com/watch", `https://m.youtube.com/watch?v=${vid}`],
  ["b) nocookie embed", `https://www.youtube-nocookie.com/embed/${vid}`],
  ["c) www embed", `https://www.youtube.com/embed/${vid}`],
  ["d) www watch (controle 429?)", `https://www.youtube.com/watch?v=${vid}`],
];

let n = 10;
for (const [rotulo, url] of sondas) {
  const t0 = Date.now();
  try {
    const res = await fetch(base + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: n++,
        method: "tools/call",
        params: { name: "read_page", arguments: { url, maxChars: 600, timeoutMs: 25000 } },
      }),
      signal: AbortSignal.timeout(120000),
    });
    const json = await res.json().catch(() => null);
    const texto = (json && json.result && json.result.content && json.result.content[0].text) || JSON.stringify(json);
    const isError = Boolean(json && json.result && json.result.isError);
    console.log(`\n===== ${rotulo} =====`);
    console.log(`ms: ${Date.now() - t0} | isError: ${isError}`);
    console.log(texto.slice(0, 260).replace(/\n/g, " | "));
    if (!isError && /Player|player|ytInitial/i.test(texto)) console.log("   (menção a player no início do conteúdo)");
  } catch (err) {
    console.log(`\n===== ${rotulo} =====\nfalha de rede: ${err.message}`);
  }
}
