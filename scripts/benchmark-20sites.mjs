#!/usr/bin/env node
/**
 * benchmark-20sites.mjs — mede o tempo real de leitura de 20 sites.
 *
 * Uso: node scripts/benchmark-20sites.mjs
 *
 * Sobe o servidor MCP em modo HTTP numa porta livre e faz chamadas
 * read_multiple_pages com 20 URLs reais (2 chamadas paralelas de 15+5).
 */

import { spawn } from "node:child_process";
import http from "node:http";

const SITES = [
  "https://example.com",
  "https://httpbin.org/html",
  "https://jsonplaceholder.typicode.com",
  "https://www.wikipedia.org",
  "https://news.ycombinator.com",
  "https://github.com",
  "https://stackoverflow.com",
  "https://www.npmjs.com",
  "https://developer.mozilla.org",
  "https://nodejs.org",
  "https://www.google.com",
  "https://www.bbc.com",
  "https://www.cnn.com",
  "https://www.reddit.com",
  "https://www.medium.com",
  "https://www.linkedin.com",
  "https://www.twitter.com",
  "https://www.instagram.com",
  "https://www.facebook.com",
  "https://www.apple.com",
];

const PORT = 5800 + Math.floor(Math.random() * 500);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function fetchJSON(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      BASE_URL + path,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
          authorization: "Bearer benchmark-token",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve({ error: text });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // ainda não subiu
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  console.log("[benchmark] subindo servidor MCP...");

  const server = spawn(process.execPath, ["server.js", "--http"], {
    env: { ...process.env, PORT: String(PORT), MCP_AUTH_TOKEN: "benchmark-token" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[server-err] ${d}`));

  try {
    const subiu = await waitForServer(BASE_URL);
    if (!subiu) {
      console.error("[benchmark] FALHA: servidor não subiu na porta", PORT);
      process.exit(1);
    }
    console.log("[benchmark] servidor OK na porta", PORT);

    // initialize
    await fetchJSON("/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });

    console.log("[benchmark] lendo 20 sites em 2 chamadas paralelas (15+5)...\n");

    const start = Date.now();
    const [result1, result2] = await Promise.all([
      fetchJSON("/mcp", {
        jsonrpc: "2.0", id: 2,
        method: "tools/call",
        params: {
          name: "read_multiple_pages",
          arguments: { urls: SITES.slice(0, 15), maxChars: 2000, timeoutMs: 5000 },
        },
      }),
      fetchJSON("/mcp", {
        jsonrpc: "2.0", id: 3,
        method: "tools/call",
        params: {
          name: "read_multiple_pages",
          arguments: { urls: SITES.slice(15), maxChars: 2000, timeoutMs: 5000 },
        },
      }),
    ]);
    const elapsed = Date.now() - start;

    const text = (result1?.result?.content?.[0]?.text || "") + "\n" + (result2?.result?.content?.[0]?.text || "");
    console.log("[benchmark] resposta (primeiros 800 chars):", text.slice(0, 800));
    const sitesOk = (text.match(/Conteudo:/g) || []).length;
    const sitesErro = (text.match(/Erro:/g) || []).length;

    console.log("\n========================================");
    console.log("RESULTADO DO BENCHMARK");
    console.log("========================================");
    console.log(`Tempo total: ${elapsed}ms (${(elapsed / 1000).toFixed(2)}s)`);
    console.log(`Sites lidos com sucesso: ${sitesOk}/${SITES.length}`);
    console.log(`Sites com erro/timeout: ${sitesErro}/${SITES.length}`);
    console.log(`Tempo médio por site: ${(elapsed / SITES.length).toFixed(0)}ms`);
    console.log("========================================");

    if (elapsed < 5000) {
      console.log("✅ META ATINGIDA: 20 sites em menos de 5 segundos!");
    } else {
      console.log(`⚠️  Meta não atingida. Faltam ${elapsed - 5000}ms para chegar a 5s.`);
    }
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    server.kill("SIGKILL");
  }
}

main().catch((err) => {
  console.error("[benchmark] erro:", err);
  process.exit(1);
});
