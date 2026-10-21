#!/usr/bin/env node
/**
 * _mede-alvos-lentos.mjs — separa REDE de CPU nos dois piores tempos da
 * bateria contra o Render: read_feed (hnrss, 20.446 ms) e read_pdf
 * (arxiv, 7.724 ms).
 *
 * A pergunta que ele responde: o tempo é do ALVO (servidor lento, RTT,
 * handshake) ou do NOSSO código (download duplicado, parser, retry)?
 * Mede cada etapa separadamente, no mesmo processo e na mesma rede.
 *
 * Uso: node dev/_mede-alvos-lentos.mjs [voltas]
 */
import { fetchTextCached } from "../src/fetch.mjs";
import { analisarFeed } from "../src/feeds.mjs";

const VOLTAS = Math.max(1, Number(process.argv[2] || 3));

async function etapa(rotulo, fn) {
  const t0 = performance.now();
  try {
    const r = await fn();
    return { ms: performance.now() - t0, ok: true, info: r };
  } catch (e) {
    return { ms: performance.now() - t0, ok: false, info: e.message };
  }
}

/** Mede o download CRU, sem cache e sem parser (só a rede do alvo). */
async function redeCrua(url, headers) {
  const t0 = performance.now();
  const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(120000) });
  const buf = await res.arrayBuffer();
  return { ms: performance.now() - t0, status: res.status, bytes: buf.byteLength };
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

console.log("=== read_feed: hnrss.org/frontpage ===");
for (let v = 1; v <= VOLTAS; v++) {
  const cru = await etapa("rede crua", () => redeCrua("https://hnrss.org/frontpage", { "user-agent": UA }));
  console.log(
    `volta ${v} | rede crua: ${cru.ms.toFixed(0)} ms | status ${cru.info?.status ?? "-"} | ${cru.info?.bytes ?? "-"} bytes`
  );
}

// Com o pipeline do projeto (SSRF + robots + fetch pinado + cache + parser).
const t0 = performance.now();
const payload = await fetchTextCached("https://hnrss.org/frontpage", { timeoutMs: 60000 });
const tPipeline = performance.now() - t0;
const t1 = performance.now();
const feed = analisarFeed(payload.text);
const tParser = performance.now() - t1;
console.log(
  `pipeline completo: ${tPipeline.toFixed(0)} ms | parser: ${tParser.toFixed(1)} ms | ` +
    `${payload.text.length} chars de XML | ${feed?.itens?.length ?? 0} itens | cortado=${payload.cortado}`
);

// Segunda leitura: com cache quente, quanto sobra?
const t2 = performance.now();
await fetchTextCached("https://hnrss.org/frontpage", { timeoutMs: 60000 });
console.log(`segunda leitura (cache quente): ${(performance.now() - t2).toFixed(0)} ms`);

console.log("\n=== read_pdf: arxiv 1706.03762 ===");
const PDF = "https://arxiv.org/pdf/1706.03762";
for (let v = 1; v <= VOLTAS; v++) {
  const cru = await etapa("rede crua", () => redeCrua(PDF, { "user-agent": UA }));
  console.log(
    `volta ${v} | download cru: ${cru.ms.toFixed(0)} ms | status ${cru.info?.status ?? "-"} | ` +
      `${cru.info?.bytes ?? "-"} bytes (${cru.info?.bytes ? (cru.info.bytes / 1024).toFixed(0) + " KB" : ""})`
  );
}

const { toolReadPdf } = await import("../src/pdf.mjs");
const t3 = performance.now();
const saida = await toolReadPdf({ url: PDF, maxChars: 25000, timeoutMs: 60000 });
console.log(
  `pipeline completo (1a vez): ${(performance.now() - t3).toFixed(0)} ms | ${saida.length} chars de saida`
);
const t4 = performance.now();
await toolReadPdf({ url: PDF, maxChars: 25000, timeoutMs: 60000 });
console.log(`pipeline completo (cache quente): ${(performance.now() - t4).toFixed(0)} ms`);
