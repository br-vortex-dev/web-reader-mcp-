#!/usr/bin/env node
/**
 * Demo: le varias fontes sobre o mesmo assunto via read_multiple_pages,
 * simulando o que a IA receberia ao cruzar informacoes de varios links.
 *
 * Uso: node scripts/demo-multiple.mjs [url1 url2 ...]
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));
const urls =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : [
        "https://www.britannica.com/biography/Elon-Musk",
        "https://en.wikipedia.org/wiki/Elon_Musk",
        "https://www.forbes.com/profile/elon-musk/",
      ];

const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "inherit"] });

let buffer = "";
let nextId = 1;
const pending = new Map();

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  }
});

const rpc = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`timeout em ${method}`)), 120000);
    pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

const out = [];
const log = (s) => {
  out.push(s);
  console.log(s);
};

const res = await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "demo", version: "0" },
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
log(`servidor: ${res.serverInfo.name} v${res.serverInfo.version}`);
log(`fontes: ${urls.length}`);

const call = await rpc("tools/call", {
  name: "read_multiple_pages",
  arguments: { urls, maxChars: 700 },
});
const text = (call.content || []).map((c) => c.text).join("\n");
log("");
log(text);

fs.writeFileSync(new URL("./demo-output.txt", import.meta.url), out.join("\n"), "utf8");
child.kill();
setTimeout(() => process.exit(0), 300);
