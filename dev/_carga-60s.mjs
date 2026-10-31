// Carga sustentada (60 s) contra o deploy: mede a vazão que se mantém, não a rajada.
const BASE = process.env.RENDER_URL || "https://web-reader-mcp-13z0.onrender.com";
const TOKEN = process.env.LIVE_TEST_TOKEN || "";
const CONC = Number(process.env.CONC || 64);
const SEG = Number(process.env.SEG || 60);
if (!TOKEN) {
  console.error("defina LIVE_TEST_TOKEN");
  process.exit(1);
}

const auth = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
let idSeq = 0;
const status = { ok: 0, http429: 0, http503: 0, outros: 0, rede: 0 };
const lat = [];
let enviados = 0;
let retryAfter = "";

async function uma() {
  const t0 = Date.now();
  enviados++;
  try {
    const res = await fetch(BASE + "/mcp", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++idSeq,
        method: "tools/call",
        params: { name: "read_page", arguments: { url: "https://example.com", maxChars: 500 } },
      }),
      signal: AbortSignal.timeout(20000),
    });
    await res.arrayBuffer();
    lat.push(Date.now() - t0);
    if (res.status === 200) status.ok++;
    else if (res.status === 429) {
      status.http429++;
      retryAfter = res.headers.get("retry-after") || "";
    } else if (res.status === 503) status.http503++;
    else status.outros++;
  } catch {
    lat.push(Date.now() - t0);
    status.rede++;
  }
}

const saudeAntes = await (await fetch(BASE + "/health")).text();
const t0 = Date.now();
const fim = t0 + SEG * 1000;
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (Date.now() < fim) await uma();
  })
);
const decorrido = (Date.now() - t0) / 1000;
lat.sort((a, b) => a - b);
const p = (q) => lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] || 0;

console.log(`conc=${CONC} durante ${decorrido.toFixed(1)}s | enviados ${enviados}`);
console.log(`OK ${status.ok} (${(status.ok / decorrido).toFixed(1)}/s) | 429 ${status.http429} | 503 ${status.http503} | outros ${status.outros} | rede ${status.rede}`);
console.log(`lat p50 ${p(0.5)}ms p95 ${p(0.95)}ms p99 ${p(0.99)}ms | retry-after: ${retryAfter || "-"}`);

const saudeDepois = await (await fetch(BASE + "/health")).text();
const extrair = (txt, re) => (txt.match(re) || [])[1] || "?";
console.log(`health: recusadas=${extrair(saudeDepois, /requisicoes:.*?recusadas (\d+)/)} conexoes=${extrair(saudeDepois, /conexoes: (\d+)/)} rss=${extrair(saudeDepois, /rss: (\d+ MB)/)}`);
if (process.env.MOSTRAR_HEALTH) console.log(saudeAntes + "\n" + saudeDepois);
