#!/usr/bin/env node
/**
 * benchmark-performance.mjs — mede latência do web-reader-mcp em modo HTTP.
 *
 * Sobe o servidor em porta livre, espera /health, e depois mede:
 *   - Cold fetch: primeira visita a cada URL (cache vazio)
 *   - Warm fetch: segunda visita a cada URL (cache quente)
 *   - Concorrencia: N requisições simultâneas a URLs diferentes
 *
 * Uso: node scripts/benchmark-performance.mjs
 */

import { spawn } from "node:child_process";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 5848;
const BASE = `http://localhost:${PORT}`;
const LOG_PREFIX = "[benchmark]";

const SITES = [
  { nome: "example.com", url: "https://example.com" },
  { nome: "github.com", url: "https://github.com" },
  { nome: "nodejs.org", url: "https://nodejs.org/en" },
  { nome: "pt.wikipedia.org", url: "https://pt.wikipedia.org/wiki/Web_crawler" },
  { nome: "httpbin.org", url: "https://httpbin.org/html" },
  { nome: "mozilla.org", url: "https://developer.mozilla.org/en-US/" },
  { nome: "nodejs.org/docs", url: "https://nodejs.org/api/documentation.html" },
  { nome: "pt.wikipedia.org/wiki/HTTP", url: "https://pt.wikipedia.org/wiki/Hypertext_Transfer_Protocol" },
];

const proc = spawn(`"${process.execPath}" server.js --http`, {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
});

let logBuf = "";
proc.stdout.on("data", (d) => (logBuf += d));
proc.stderr.on("data", (d) => (logBuf += d));

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "content-type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await httpGet(`${BASE}/health`);
      if (r.status === 200) return r.body;
    } catch { /* ainda não subiu */ }
    await sleep(250);
  }
  throw new Error(`servidor não subiu na porta ${PORT}`);
}

async function mcpCall(name, args) {
  const r = await httpPost(`${BASE}/mcp`, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }));
  const data = JSON.parse(r.body);
  if (data.error) throw new Error(data.error.message);
  const text = data.result?.content?.[0]?.text || "";
  return { status: r.status, text, raw: data };
}

function fmt(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function main() {
  console.log(`${LOG_PREFIX} esperando servidor subir...`);
  const health = await waitHealth();
  console.log(`${LOG_PREFIX} /health OK:`, JSON.stringify(health).slice(0, 200));

  // === COLD FETCH ===
  console.log(`\n${LOG_PREFIX} === COLD FETCH (cache vazio) ===`);
  const coldTimes = [];
  for (const s of SITES) {
    const t0 = Date.now();
    try {
      const r = await mcpCall("read_page", { url: s.url, maxOutputChars: 500 });
      const ms = Date.now() - t0;
      coldTimes.push(ms);
      console.log(`${LOG_PREFIX} ${s.nome.padEnd(25)} ${fmt(ms).padStart(8)} — ${r.text.length} chars`);
    } catch (e) {
      const ms = Date.now() - t0;
      coldTimes.push(ms);
      console.log(`${LOG_PREFIX} ${s.nome.padEnd(25)} ${fmt(ms).padStart(8)} — ERRO: ${e.message}`);
    }
  }

  // === WARM FETCH ===
  console.log(`\n${LOG_PREFIX} === WARM FETCH (cache quente) ===`);
  const warmTimes = [];
  for (const s of SITES) {
    const t0 = Date.now();
    try {
      const r = await mcpCall("read_page", { url: s.url, maxOutputChars: 500 });
      const ms = Date.now() - t0;
      warmTimes.push(ms);
      console.log(`${LOG_PREFIX} ${s.nome.padEnd(25)} ${fmt(ms).padStart(8)} — ${r.text.length} chars`);
    } catch (e) {
      const ms = Date.now() - t0;
      warmTimes.push(ms);
      console.log(`${LOG_PREFIX} ${s.nome.padEnd(25)} ${fmt(ms).padStart(8)} — ERRO: ${e.message}`);
    }
  }

  // === RESUMO ===
  const coldAvg = coldTimes.reduce((a, b) => a + b, 0) / coldTimes.length;
  const warmAvg = warmTimes.reduce((a, b) => a + b, 0) / warmTimes.length;
  const coldMax = Math.max(...coldTimes);
  const warmMax = Math.max(...warmTimes);
  const speedup = warmAvg > 0 ? (coldAvg / warmAvg).toFixed(1) : "N/A";

  console.log(`\n${LOG_PREFIX} === RESUMO ===`);
  console.log(`${LOG_PREFIX} Cold: avg ${fmt(coldAvg)}, max ${fmt(coldMax)}`);
  console.log(`${LOG_PREFIX} Warm: avg ${fmt(warmAvg)}, max ${fmt(warmMax)}`);
  console.log(`${LOG_PREFIX} Speedup (cold/warm): ${speedup}x`);

  console.log(`\n${LOG_PREFIX} teste de campo encerrado.`);
  proc.kill("SIGTERM");
  await sleep(500);
  process.exit(0);
}

main().catch((e) => {
  console.error(`${LOG_PREFIX} FALHA FATAL:`, e.message);
  console.error(logBuf);
  proc.kill("SIGKILL");
  process.exit(1);
});
