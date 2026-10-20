#!/usr/bin/env node
// Diagnóstico do /health local: sobe o servidor e mostra o erro real de cada tentativa.
import { spawn } from "node:child_process";

const PORT = 6311;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "diag-token";

const s = spawn(process.execPath, ["server.js", "--http"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), MCP_AUTH_TOKEN: TOKEN, RATE_LIMIT_MAX: "1000000" },
  stdio: ["ignore", "pipe", "pipe"],
});
s.stdout.on("data", (d) => process.stdout.write(`[out] ${d}`));
s.stderr.on("data", (d) => process.stdout.write(`[err] ${d}`));
s.on("exit", (c, sig) => console.log(`[exit] code=${c} sig=${sig} em ${Date.now() - t0}ms`));

const t0 = Date.now();
await new Promise((r) => setTimeout(r, 2500));

async function tentar(rotulo, url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(4000) });
    const txt = await r.text();
    console.log(`${rotulo}: HTTP ${r.status} | ${txt.slice(0, 120).replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(`${rotulo}: FALHOU (${e.name}) ${e.message} | cause=${e.cause?.code || e.cause?.message || "-"}`);
  }
}

await tentar("GET /health", BASE + "/health");
await tentar("GET /", BASE + "/");
await tentar("POST /mcp init", BASE + "/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }),
});

s.kill("SIGKILL");
process.exit(0);
