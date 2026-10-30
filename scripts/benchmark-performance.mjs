#!/usr/bin/env node
/**
 * benchmark-performance.mjs — mede a latência de leitura nos sites reais.
 *
 * Sobe o servidor MCP em modo HTTP numa porta livre, espera ele responder,
 * e mede a latência de leitura de sites reais.
 *
 * Uso: node scripts/benchmark-performance.mjs
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4599;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const MCP_URL = `${BASE_URL}/mcp`;

// Sites para testar — mix de pesados e leves
const SITES = [
  "https://example.com/",
  "https://httpbin.org/html",
  "https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/filter",
  "https://nodejs.org/sitemap.xml",
  "https://www.google.com/robots.txt",
];

let passed = 0;
let failed = 0;

function log(msg) {
  console.log(`[benchmark] ${msg}`);
}

async function waitForServer(port, maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      // servidor ainda não subiu
    }
    await sleep(500);
  }
  return false;
}

async function callMcp(method, params, id = 1) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });
  return res.json();
}

async function readPage(url, maxChars = 3000) {
  return callMcp("tools/call", {
    name: "read_page",
    arguments: { url, maxChars },
  });
}

async function measureLatency(fn, label, iterations = 3) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await fn();
    const elapsed = Date.now() - start;
    times.push(elapsed);
    log(`${label} #${i + 1}: ${elapsed}ms`);
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const min = Math.min(...times);
  const max = Math.max(...times);
  log(`${label} — média: ${avg}ms, min: ${min}ms, max: ${max}ms`);
  return { avg, min, max };
}

async function main() {
  log("subindo servidor...");

  const __dirname = dirname(fileURLToPath(import.meta.url));
  // O servidor escolhe a porta pela variavel PORT (nao existe flag --port);
  // --http so e necessario para nao depender do ambiente ter PORT definido.
  const child = spawn(process.execPath, [join(__dirname, "..", "server.js"), "--http"], {
    cwd: join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), MCP_ALLOW_ANONYMOUS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (data) => {
    const text = data.toString().trim();
    if (text) log(`[server] ${text}`);
  });
  child.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) log(`[server:err] ${text}`);
  });

  try {
    const ok = await waitForServer(PORT);
    if (!ok) {
      log("FALHA FATAL: servidor não subiu na porta " + PORT);
      child.kill();
      process.exit(1);
    }

    log("servidor OK. medindo latência...\n");

    const results = {};

    for (const site of SITES) {
      log(`=== ${site} ===`);
      const stat = await measureLatency(() => readPage(site), site, 3);
      results[site] = stat;
      log("");
    }

    log("=== RESUMO ===");
    let totalAvg = 0;
    let count = 0;
    for (const [site, stat] of Object.entries(results)) {
      log(`${site} — ${stat.avg}ms`);
      totalAvg += stat.avg;
      count++;
    }
    log(`\nMédia geral: ${Math.round(totalAvg / count)}ms`);

    passed = count;
    failed = 0;
  } finally {
    child.kill("SIGTERM");
    await sleep(500);
    try {
      child.kill("SIGKILL");
    } catch {
      // processo já morreu
    }
  }

  log(`\nBenchmark completo: ${passed} sites medidos.`);
  process.exit(0);
}

main().catch((err) => {
  log("ERRO: " + (err.stack || err.message || String(err)));
  process.exit(1);
});
