#!/usr/bin/env node
/**
 * Benchmark: mede quanto tempo o MCP leva para ler 30 URLs reais
 * de tipos variados (leves, medias e pesadas) numa unica chamada.
 *
 * Uso: node scripts/benchmark.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));

const URLS = [
  "https://example.com",
  "https://example.org",
  "https://www.iana.org/domains/example",
  "https://httpbin.org/html",
  "https://pt.wikipedia.org/wiki/Node.js",
  "https://pt.wikipedia.org/wiki/Python",
  "https://pt.wikipedia.org/wiki/Linux",
  "https://pt.wikipedia.org/wiki/JavaScript",
  "https://en.wikipedia.org/wiki/Elon_Musk",
  "https://en.wikipedia.org/wiki/Mark_Zuckerberg",
  "https://developer.mozilla.org/pt-BR/docs/Web/JavaScript",
  "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",
  "https://nodejs.org/en/docs",
  "https://docs.python.org/3/tutorial/",
  "https://www.rfc-editor.org/rfc/rfc2616",
  "https://httpbin.org/get",
  "https://jsonplaceholder.typicode.com/",
  "https://www.iana.org/help/example-domains",
  "https://blog.npmjs.org/",
  "https://github.com/nodejs/node",
  "https://github.com/microsoft/vscode",
  "https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array",
  "https://news.ycombinator.com/",
  "https://pt.wikipedia.org/wiki/Intelig%C3%AAncia_artificial",
  "https://pt.wikipedia.org/wiki/Banco_de_dados",
  "https://en.wikipedia.org/wiki/Web_scraping",
  "https://www.rust-lang.org/",
  "https://go.dev/doc/",
  "https://www.kernel.org/doc/html/latest/",
  "https://www.php.net/manual/en/",
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
    const timer = setTimeout(() => reject(new Error(`timeout em ${method}`)), 240000);
    pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "benchmark", version: "0" },
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

console.log(`Benchmark: ${URLS.length} URLs variadas (leves, medias e pesadas)\n`);

const startedAt = Date.now();
const call = await rpc("tools/call", {
  name: "read_multiple_pages",
  arguments: { urls: URLS, maxChars: 300 },
});
const elapsedMs = Date.now() - startedAt;

const text = (call.content || []).map((c) => c.text).join("\n");

const sessoes = text.split("========================================");
const okMatch = text.match(/(\d+)\/30 paginas OK/);
const ok = okMatch ? Number(okMatch[1]) : 0;
const falhas = sessoes.filter((s) => /^# Erro ao ler/.test(s.trim())).length;

const tamanhos = [];
const urlsLidas = [];
for (const sessao of sessoes) {
  const url = sessao.match(/URL: (\S+)/);
  const tam = sessao.match(/Conteudo: (\d+) caracteres/);
  if (url && tam && !sessao.includes("Erro ao ler")) {
    urlsLidas.push({ url: url[1], chars: Number(tam[1]) });
    tamanhos.push(Number(tam[1]));
  }
}

tamanhos.sort((a, b) => b - a);
const totalChars = tamanhos.reduce((s, n) => s + n, 0);

console.log(`Tempo total: ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(1)} s)`);
console.log(`Paginas OK: ${ok}/${URLS.length} | falhas: ${falhas}`);
console.log(`Bytes extraidos: ${(totalChars / 1024 / 1024).toFixed(2)} MB em ${urlsLidas.length} paginas`);
console.log(
  `Tamanho medio por pagina: ${urlsLidas.length ? Math.round(totalChars / urlsLidas.length / 1024) : 0} KB`
);
console.log(`Maior pagina: ${Math.round((tamanhos[0] || 0) / 1024)} KB`);
console.log(`Media por pagina: ${(elapsedMs / URLS.length).toFixed(0)} ms`);
console.log("");
console.log("Falharam (provavelmente anti-bot/paywall/JS):");
if (falhas === 0) console.log("  (nenhuma)");
else {
  sessoes
    .filter((s) => /^# Erro ao ler/.test(s.trim()))
    .forEach((s) => {
      const primeira = s.trim().split("\n").slice(0, 2).join(" — ");
      console.log(`  ${primeira}`);
    });
}

child.kill();
setTimeout(() => process.exit(0), 300);
