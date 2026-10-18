#!/usr/bin/env node
/**
 * _diag-yt-render.mjs — o que o Render consegue alcançar do YouTube?
 *
 * Testa, pelo serviço no ar, cada rota do YouTube que o read_video usa:
 *   a) watch (página do vídeo)   -> esperado: 429 do IP de datacenter
 *   b) oEmbed (metadados leves)  -> é o candidato a fallback
 *   c) i.ytimg.com (capa)        -> asset estático, costuma passar
 *   d) www.youtube.com/robots.txt (controle)
 *
 * read_page serve de sonda: se o fetch passa, o erro é "não é HTML" (JSON)
 * ou conteúdo; se não passa, o erro traz o status real.
 *
 * Uso: node dev/_diag-yt-render.mjs <url> <token>
 */
const base = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || process.env.MCP_AUTH_TOKEN || "";
if (!base || !token) {
  console.error("uso: node dev/_diag-yt-render.mjs <https://sua-url.onrender.com> <token>");
  process.exit(1);
}

const vid = "dQw4w9WgXcQ";
const sondas = [
  ["a) watch", `https://www.youtube.com/watch?v=${vid}`],
  ["b) oEmbed", `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}&format=json`],
  ["b2) oEmbed youtu.be", `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://youtu.be/${vid}`)}&format=json`],
  ["c) capa i.ytimg", `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`],
  ["d) robots.txt", "https://www.youtube.com/robots.txt"],
];

async function chamar(url, id) {
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "read_page", arguments: { url, maxChars: 400, timeoutMs: 20000 } },
    }),
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json().catch(() => null);
  const texto = (json && json.result && json.result.content && json.result.content[0].text) || JSON.stringify(json);
  const isError = Boolean(json && json.result && json.result.isError);
  return { isError, texto };
}

let n = 1;
for (const [rotulo, url] of sondas) {
  const t0 = Date.now();
  try {
    const r = await chamar(url, n++);
    const linha = r.texto.split("\n").slice(0, 3).join(" | ");
    console.log(`\n===== ${rotulo} =====`);
    console.log(`ms: ${Date.now() - t0} | isError: ${r.isError}`);
    console.log(linha.slice(0, 300));
  } catch (err) {
    console.log(`\n===== ${rotulo} =====\nfalha de rede: ${err.message}`);
  }
}
