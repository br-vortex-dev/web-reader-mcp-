#!/usr/bin/env node
/**
 * live-test-real.mjs — teste de campo contra sites públicos reais.
 *
 * Sobe o servidor MCP em modo HTTP numa porta livre, espera ele responder
 * no /health, e entao bate em sites reais com as ferramentas do MCP.
 *
 * Uso: node scripts/live-test-real.mjs
 */

import { spawn } from "node:child_process";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 5847;
const BASE = `http://localhost:${PORT}`;
const LOG_PREFIX = "[live-test]";

// Sobe o servidor MCP em modo HTTP.
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
      if (r.status === 200) return JSON.parse(r.body);
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

async function main() {
  console.log(`${LOG_PREFIX} esperando servidor subir...`);
  const health = await waitHealth();
  console.log(`${LOG_PREFIX} /health OK:`, JSON.stringify(health).slice(0, 200));

  const sites = [
    { nome: "example.com", url: "https://example.com" },
    { nome: "github.com", url: "https://github.com" },
    { nome: "nodejs.org", url: "https://nodejs.org/en" },
    { nome: "pt.wikipedia.org", url: "https://pt.wikipedia.org/wiki/Web_crawler" },
    { nome: "httpbin.org (redirect)", url: "https://httpbin.org/redirect/2" },
  ];

  for (const s of sites) {
    console.log(`\n${LOG_PREFIX} === ${s.nome} — ${s.url} ===`);
    const t0 = Date.now();
    try {
      const r = await mcpCall("read_page", { url: s.url });
      const ms = Date.now() - t0;
      const preview = r.text.slice(0, 300).replace(/\n+/g, " ");
      console.log(`${LOG_PREFIX} [${ms}ms] HTTP ${r.status} — ${r.text.length} chars`);
      console.log(`${LOG_PREFIX} preview: ${preview}...`);
      // Verifica se o conteúdo veio vazio ou com erro
      if (r.text.length < 50) {
        console.log(`${LOG_PREFIX} ⚠️  resposta suspeita (muito curta)`);
      }
    } catch (e) {
      const ms = Date.now() - t0;
      console.log(`${LOG_PREFIX} [${ms}ms] ERRO: ${e.message}`);
    }
  }

  // Teste de extract_links
  console.log(`\n${LOG_PREFIX} === extract_links — github.com ===`);
  try {
    const r = await mcpCall("extract_links", { url: "https://github.com" });
    const links = JSON.parse(r.text);
    console.log(`${LOG_PREFIX} ${links.length} links extraídos`);
    console.log(`${LOG_PREFIX} primeiros:`, links.slice(0, 3));
  } catch (e) {
    console.log(`${LOG_PREFIX} ERRO: ${e.message}`);
  }

  // Teste de read_multiple_pages
  console.log(`\n${LOG_PREFIX} === read_multiple_pages — 3 sites ===`);
  try {
    const r = await mcpCall("read_multiple_pages", {
      urls: ["https://example.com", "https://httpbin.org/html", "https://pt.wikipedia.org/wiki/Crawler"],
      maxOutputChars: 500,
    });
    const results = JSON.parse(r.text);
    console.log(`${LOG_PREFIX} ${results.length} resultados`);
    for (const res of results.slice(0, 3)) {
      const preview = (res.content || res.text || JSON.stringify(res)).slice(0, 150);
      console.log(`${LOG_PREFIX}  - ${res.url || "?"}: ${preview}...`);
    }
  } catch (e) {
    console.log(`${LOG_PREFIX} ERRO: ${e.message}`);
  }

  // Teste de erro: URL inválida
  console.log(`\n${LOG_PREFIX} === URL inválida (deve dar erro) ===`);
  try {
    const r = await mcpCall("read_page", { url: "not-a-url" });
    console.log(`${LOG_PREFIX} resposta:`, r.text.slice(0, 200));
  } catch (e) {
    console.log(`${LOG_PREFIX} ERRO esperado: ${e.message}`);
  }

  // Teste de erro: host privado (deve ser bloqueado)
  console.log(`\n${LOG_PREFIX} === Host privado (deve ser bloqueado) ===`);
  try {
    const r = await mcpCall("read_page", { url: "http://127.0.0.1/" });
    console.log(`${LOG_PREFIX} resposta:`, r.text.slice(0, 200));
  } catch (e) {
    console.log(`${LOG_PREFIX} ERRO esperado: ${e.message}`);
  }

  // Teste de erro: DNS inexistente
  console.log(`\n${LOG_PREFIX} === DNS inexistente (deve dar erro) ===`);
  try {
    const r = await mcpCall("read_page", { url: "https://este-host-nao-existe-12345.com" });
    console.log(`${LOG_PREFIX} resposta:`, r.text.slice(0, 200));
  } catch (e) {
    console.log(`${LOG_PREFIX} ERRO esperado: ${e.message}`);
  }

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
