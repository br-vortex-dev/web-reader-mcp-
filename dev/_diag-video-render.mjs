#!/usr/bin/env node
/**
 * _diag-video-render.mjs — mostra VERBATIM o que o read_video devolve no
 * Render para o YouTube (o check agregado não conta a história toda).
 *
 * Uso: node dev/_diag-video-render.mjs <url> <token>
 */
const base = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || process.env.MCP_AUTH_TOKEN || "";
if (!base || !token) {
  console.error("uso: node dev/_diag-video-render.mjs <https://sua-url.onrender.com> <token>");
  process.exit(1);
}

const alvos = [
  ["YouTube watch", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ["YouTube youtu.be", "https://youtu.be/dQw4w9WgXcQ"],
];

for (const [rotulo, url] of alvos) {
  console.log(`\n========== ${rotulo} ==========`);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(base + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read_video", arguments: { url, maxChars: 3000 } },
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    console.log(`falha de rede: ${err.name}: ${err.message} (${Date.now() - t0} ms)`);
    continue;
  }
  const texto = await res.text();
  console.log(`HTTP ${res.status} em ${Date.now() - t0} ms | bytes ${texto.length}`);
  console.log("---- corpo cru ----");
  console.log(texto.slice(0, 2500));
  console.log("---- fim ----");
}
