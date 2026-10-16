#!/usr/bin/env node
/**
 * dump-tools-list.mjs — gera o snapshot de tools/list (JSON exato do servidor).
 *
 * Uso: node scripts/dump-tools-list.mjs [caminho-de-saida]
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const saida = process.argv[2] || join(__dirname, "..", "tests", "snapshot", "tools-list.json");
const SERVER_PATH = join(__dirname, "..", "server.js");

const child = spawn(process.execPath, [SERVER_PATH, "--http"], {
  env: {
    ...process.env,
    PORT: "47311",
    HOST: "127.0.0.1",
    MCP_AUTH_TOKEN: "snapshot",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
child.stderr.on("data", () => {});

let ok = false;
for (let i = 0; i < 100 && !ok; i++) {
  try {
    if ((await fetch("http://127.0.0.1:47311/health")).ok) ok = true;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
if (!ok) {
  console.error("servidor nao subiu");
  child.kill();
  process.exit(1);
}

const res = await fetch("http://127.0.0.1:47311/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer snapshot" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
const json = await res.json();
await writeFile(saida, JSON.stringify(json.result.tools, null, 2) + "\n", "utf8");
console.log(`snapshot gravado em ${saida} (${json.result.tools.length} ferramentas)`);
child.kill();
process.exit(0);
