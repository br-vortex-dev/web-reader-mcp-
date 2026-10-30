#!/usr/bin/env node
/**
 * _mede-render-repete.mjs — mede os sites pesados N vezes em rodízio e devolve
 * a MEDIANA de cada um, para separar ruído de ganho real.
 *
 * Por que rodízio: se medir o site A três vezes seguidas e depois o B três
 * vezes, o A pega o cache frio e o B o cache quente. Alternando A,B,C,A,B,C,
 * cada site enfrenta as mesmas condições e a mediana fica comparável.
 *
 * Uso: node dev/_mede-render-repete.mjs [voltas]
 */
import { writeFileSync } from "node:fs";

const BASE = "https://web-reader-mcp-13z0.onrender.com";
const TOKEN = process.env.LIVE_TEST_TOKEN || process.env.MCP_AUTH_TOKEN || "";
if (!TOKEN) { console.error("defina LIVE_TEST_TOKEN (ou MCP_AUTH_TOKEN) com o token do servidor"); process.exit(1); }
const VOLTAS = Number(process.argv[2]) || 3;
const auth = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
let idSeq = 1;

const ALVOS = [
  ["amazon.com", "https://www.amazon.com/"],
  ["washingtonpost.com", "https://www.washingtonpost.com/"],
  ["guardian.com", "https://www.theguardian.com/international"],
  ["wikipedia/Brazil", "https://en.wikipedia.org/wiki/Brazil"],
  ["bbc.com/news", "https://www.bbc.com/news"],
];

async function chamar(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + "/mcp", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++idSeq,
        method: "tools/call",
        params: { name: "read_page", arguments: { url, maxChars: 25000, timeoutMs: 90000, cache: false } },
      }),
      signal: AbortSignal.timeout(150000),
    });
    const json = await res.json().catch(() => null);
    const texto = json?.result?.content?.[0]?.text || "";
    return {
      ok: res.status === 200 && !json?.result?.isError,
      ms: Date.now() - t0,
      chars: texto.length,
      erro: json?.result?.isError ? texto.replace(/\s+/g, " ").slice(0, 120) : "",
    };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, chars: 0, erro: e.message };
  }
}

const mediana = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// Aquecimento: TLS, roteador e cold start do plano free.
await chamar("https://example.com");
console.log(`[mede] alvo ${BASE} | ${VOLTAS} voltas em rodizio, cache desligado\n`);

const amostras = new Map(ALVOS.map(([nome]) => [nome, []]));
for (let v = 1; v <= VOLTAS; v++) {
  for (const [nome, url] of ALVOS) {
    const r = await chamar(url);
    amostras.get(nome).push(r);
    console.log(`volta ${v} ${nome.padEnd(20)} ${r.ok ? "OK" : "FALHA"} ${String(r.ms).padStart(6)} ms ${r.ok ? "" : "!! " + r.erro}`);
  }
}

console.log("\n===== MEDIANA por site (cache desligado) =====");
const resumo = [];
for (const [nome] of ALVOS) {
  const list = amostras.get(nome).filter((r) => r.ok);
  if (!list.length) { console.log(`${nome.padEnd(20)} todas falharam`); continue; }
  const ms = list.map((r) => r.ms);
  resumo.push({ site: nome, medianaMs: mediana(ms), minMs: Math.min(...ms), maxMs: Math.max(...ms), amostras: ms.length });
  console.log(`${nome.padEnd(20)} mediana ${String(mediana(ms)).padStart(6)} ms   (min ${Math.min(...ms)} / max ${Math.max(...ms)}, n=${ms.length})`);
}

const somaMediana = resumo.reduce((a, b) => a + b.medianaMs, 0);
console.log(`\nsoma das medianas: ${somaMediana} ms`);

writeFileSync("dev/load/render-repete.json", JSON.stringify({ base: BASE, quando: new Date().toISOString(), voltas: VOLTAS, resumo }, null, 2));
console.log("gravado: dev/load/render-repete.json");
