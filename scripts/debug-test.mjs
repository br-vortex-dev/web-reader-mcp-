#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "..", "server.js");

let server;
let msgId = 0;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function callTool(name, args) {
  const res = await send("tools/call", { name, arguments: args });
  if (res.error) throw new Error(res.error.message);
  return res.result;
}

async function main() {
  server = spawn("node", [SERVER_PATH], { stdio: ["pipe", "pipe", "inherit"] });

  server.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          const { resolve } = pending.get(msg.id);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch {}
    }
  });

  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "debug", version: "1.0.0" },
  });
  notify("notifications/initialized", {});

  console.log("Testando read_page com google.com...\n");
  try {
    const result = await callTool("read_page", { url: "https://www.google.com" });
    console.log("Resultado bruto:");
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.log("Erro:", e.message);
  }

  server.kill();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
