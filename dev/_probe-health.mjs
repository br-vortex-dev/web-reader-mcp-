#!/usr/bin/env node
// _probe-health.mjs - teto atual da instancia no Render, SEM token.
//
// Mede GET /health (rota publica, caminho HTTP leve do processo) sob
// concorrencia fixa: quantas requisicoes por segundo a instancia entrega
// agora. Serve para comparar o teto ATUAL com o das medicoes antigas.
//
// Uso: node dev/_probe-health.mjs [conc] [total]
//   node dev/_probe-health.mjs 16 150
//   node dev/_probe-health.mjs 64 300

import http from "node:http";
import https from "node:https";

const BASE = process.env.PROBE_URL || "https://web-reader-mcp-13z0.onrender.com";
const C = Math.max(1, Number(process.argv[2] || 16));
const N = Math.max(1, Number(process.argv[3] || 150));

const url = new URL(BASE + "/health");
const LIB = url.protocol === "https:" ? https : http;
const porta = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;

const agent = new LIB.Agent({ keepAlive: true, maxSockets: C + 4, maxFreeSockets: C + 4 });

function req() {
  return new Promise((resolve) => {
    const t = process.hrtime.bigint();
    const r = LIB.request(
      { hostname: url.hostname, port: porta, path: url.pathname, method: "GET", agent },
      (res) => {
        res.resume();
        res.on("end", () => {
          lats.push(Number(process.hrtime.bigint() - t) / 1e6);
          if (res.statusCode === 200) ok++;
          else erros++;
          resolve();
        });
      }
    );
    r.setTimeout(30000, () => r.destroy(new Error("timeout")));
    r.on("error", () => {
      erros++;
      resolve();
    });
    r.end();
  });
}

const lats = [];
let ok = 0;
let erros = 0;

// aquecimento: tira o cold start e deixa a instancia quente
for (let i = 0; i < 8; i++) await req();
lats.length = 0;
ok = 0;
erros = 0;

const t0 = Date.now();
let prox = 0;
async function worker() {
  for (;;) {
    const i = prox++;
    if (i >= N) return;
    await req();
  }
}
await Promise.all(Array.from({ length: C }, () => worker()));
const seg = (Date.now() - t0) / 1000;

lats.sort((a, b) => a - b);
const p = (q) => lats[Math.min(lats.length - 1, Math.floor((q / 100) * lats.length))] || 0;
console.log(
  `GET /health conc=${C} | enviados ${N} | ok ${ok} | erros ${erros} | ` +
    `${(N / seg).toFixed(1)} req/s | p50 ${p(50).toFixed(0)} ms | p95 ${p(95).toFixed(0)} ms | p99 ${p(99).toFixed(0)} ms`
);
agent.destroy();
