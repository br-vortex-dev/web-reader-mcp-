#!/usr/bin/env node
/**
 * _check-pdf-live.mjs — prova LOCAL do read_pdf contra a web real.
 *
 * Sobe o servidor de verdade (modo HTTP, produção) numa porta livre e chama
 * a ferramenta read_pdf via JSON-RPC, como um cliente MCP faria. Mostra o
 * começo do texto extraído de cada PDF.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORTA = 8931;
const TOKEN = "t";

const servidor = spawn(process.execPath, [path.join(raiz, "server.js"), "--http"], {
  env: { ...process.env, PORT: String(PORTA), MCP_AUTH_TOKEN: TOKEN, RATE_LIMIT_MAX: "100000" },
  stdio: ["ignore", "pipe", "pipe"],
});
servidor.stderr.on("data", (d) => process.stderr.write("[servidor] " + d));

async function esperar() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA}/health`);
      if (r.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("servidor nao subiu");
}

async function chamar(url, maxChars = 4000) {
  const r = await fetch(`http://127.0.0.1:${PORTA}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "read_pdf", arguments: { url, maxChars, timeoutMs: 40000 } },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  return j.result;
}

const ALVOS = [
  "https://arxiv.org/pdf/1706.03762",
  "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
];

try {
  await esperar();
  console.log("servidor no ar na porta", PORTA, "\n");
  for (const url of ALVOS) {
    console.log("=".repeat(70));
    console.log("ALVO:", url);
    const res = await chamar(url);
    const t = (res.content && res.content[0] && res.content[0].text) || JSON.stringify(res);
    console.log("isError:", res.isError === true);
    console.log(t.slice(0, 900));
    console.log("...");
  }
} finally {
  servidor.kill();
}
