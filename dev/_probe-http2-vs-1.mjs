#!/usr/bin/env node
/**
 * _probe-http2-vs-1.mjs — a primeira rajada do crawl custa handshake?
 *
 * A sonda _probe-crawl-fases.mjs mostrou download = 93% do pipeline e uma
 * página de 9 KB levando 557 ms para baixar: latência pura (DNS+TCP+TLS).
 * O net.mjs já tem keep-alive, mas HTTP/1.1 abre UM socket por download
 * simultâneo — o crawl solta ~16 páginas para o mesmo host e paga até 16
 * apertos de TLS na primeira rajada. HTTP/2 multiplexa todas numa única
 * conexão: um handshake só.
 *
 * Este arquivo mede as duas formas contra o MESMO site, com o MESMO lote:
 *   A) http/1.1 + keep-alive (como o net.mjs faz hoje)
 *   B) http/2   + uma conexão multiplexada
 * e imprime o tempo total e por URL. Se B ganhar de fato, vale migrar o
 * fetch para http/2 com fallback; se não, o gargalo é o RTT da origem e
 * não se mexe no transporte.
 *
 * Uso: node dev/_probe-http2-vs-1.mjs [urlBase] [nPaginas]
 */
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import { performance } from "node:perf_hooks";

const base = process.argv[2] || "https://www.iana.org";
const nPaginas = Math.max(2, Math.min(16, Number(process.argv[3]) || 10));

const ms = (n) => `${n.toFixed(0)} ms`;
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

// Descobre URLs internas pela página raiz (links simples, sem parser).
const raizHtml = await new Promise((resolve, reject) => {
  const lib = base.startsWith("https:") ? https : http;
  const t = performance.now();
  lib.get(base, (res) => {
    let corpo = "";
    res.setEncoding("utf8");
    res.on("data", (c) => (corpo += c));
    res.on("end", () => {
      console.log(`raiz: ${kb(Buffer.byteLength(corpo))} em ${ms(performance.now() - t)}\n`);
      resolve(corpo);
    });
  }).on("error", reject);
});
const origin = new URL(base).origin;
const urls = [...new Set([...raizHtml.matchAll(/href="([^"#?]+)"/g)].map((m) => m[1]))]
  .filter((h) => h.startsWith("/") && !/^\/(login|tag|page|feed|wp-)/i.test(h))
  .map((h) => `${origin}${h}`)
  .filter((u, i, a) => a.indexOf(u) === i)
  .slice(0, nPaginas);
console.log(`alvos (${urls.length}):`, urls.slice(0, 4).join(" "), "...\n");

const baixar = async (lib, agent, url) => {
  const t = performance.now();
  return new Promise((resolve) => {
    lib.get(url, { agent }, (res) => {
      let bytes = 0;
      res.on("data", (c) => (bytes += c.length));
      res.on("end", () => resolve({ url, ms: performance.now() - t, bytes }));
    }).on("error", (e) => resolve({ url, ms: performance.now() - t, bytes: 0, erro: e.code }));
  });
};

/* A) http/1.1 + keep-alive — como o net.mjs hoje */
const agent = new https.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 16 });
// aquece o agente com a raiz (o crawl real lê a raiz antes do pool)
await baixar(https, agent, origin + "/");
let t = performance.now();
const r1 = await Promise.all(urls.map((u) => baixar(https, agent, u)));
const total1 = performance.now() - t;
agent.destroy();

/* B) http/2 — uma conexão, N streams */
t = performance.now();
const r2 = await new Promise((resolve) => {
  const sessao = http2.connect(origin);
  sessao.setTimeout(30000, () => sessao.destroy());
  const saida = [];
  let pendentes = urls.length;
  for (const url of urls) {
    const ti = performance.now();
    const req = sessao.request({ ":path": new URL(url).pathname });
    let bytes = 0;
    req.on("data", (c) => (bytes += c.length));
    req.on("end", () => {
      saida.push({ url, ms: performance.now() - ti, bytes });
      if (--pendentes === 0) {
        sessao.close();
        resolve(saida);
      }
    });
    req.on("error", (e) => {
      saida.push({ url, ms: performance.now() - ti, bytes: 0, erro: e.code });
      if (--pendentes === 0) {
        sessao.close();
        resolve(saida);
      }
    });
    req.end();
  }
  sessao.on("error", () => resolve(saida));
});
const total2 = performance.now() - t;

/* Resultado */
console.log("================ http/1.1 + keep-alive ================");
console.log(`rajada de ${urls.length} páginas: ${ms(total1)}`);
for (const r of r1.sort((a, b) => b.ms - a.ms).slice(0, 3)) console.log(`  mais lenta: ${ms(r.ms)} ${kb(r.bytes)} ${r.url}`);
console.log("\n================ http/2 (1 conexão) ==================");
console.log(`rajada de ${urls.length} páginas: ${ms(total2)}`);
for (const r of r2.sort((a, b) => b.ms - a.ms).slice(0, 3)) console.log(`  mais lenta: ${ms(r.ms)} ${kb(r.bytes)} ${r.url}`);
console.log(`\nhttp/2 é ${((1 - total2 / total1) * 100).toFixed(0)}% mais rápido nesta rajada`);
process.exit(0);
