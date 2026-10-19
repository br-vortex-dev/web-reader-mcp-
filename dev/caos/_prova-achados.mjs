#!/usr/bin/env node
// Prova (ou derruba) os dois achados que sobraram:
//  1) a bomba brotli congela o EVENT LOOP (servidor mudo) ou so a requisicao?
//  2) a lentidao da rajada vem do robots.txt gigante ou da admissao?
import { spawn } from "node:child_process";
import http from "node:http";
import zlib from "node:zlib";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..", "..");
const TOKEN = "t";

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

async function subir(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(RAIZ, "server.js"), "--http"], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(port), MCP_AUTH_TOKEN: TOKEN, ALLOW_PRIVATE_HOSTS: "1", RATE_LIMIT_MAX: "1000000", ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (c) => (err += c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${base}/health`)).ok) return { base, port, child, stderr: () => err };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("nao subiu: " + err);
}

const call = async (mcp, name, cargs, ms = 120000) => {
  const t0 = Date.now();
  try {
    const r = await fetch(`${mcp.base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: cargs } }),
      signal: AbortSignal.timeout(ms),
    });
    const j = await r.json().catch(() => null);
    return { ms: Date.now() - t0, erro: null, isError: Boolean(j?.result?.isError), texto: String(j?.result?.content?.[0]?.text ?? "") };
  } catch (e) {
    return { ms: Date.now() - t0, erro: e.name === "TimeoutError" ? "timeout" : e.message, texto: "" };
  }
};

// ---------------------------------------------------------------------------
// 1) A bomba brotli trava o event loop?
// ---------------------------------------------------------------------------
console.log("=== ACHADO 1: bomba brotli congela o servidor inteiro? ===\n");

const alvo = http.createServer((req, res) => {
  if (req.url === "/bomba") {
    const corpo = Buffer.alloc(150 * 1024 * 1024, 0x41);
    const comp = zlib.brotliCompressSync(corpo);
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "br", "content-length": comp.length });
    res.end(comp);
    return;
  }
  if (req.url === "/ok") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body><h1>ok</h1></body></html>");
    return;
  }
  res.writeHead(404);
  res.end();
});
const portaAlvo = await freePort();
await new Promise((r) => alvo.listen(portaAlvo, "127.0.0.1", r));
const A = `http://127.0.0.1:${portaAlvo}`;

const mcp = await subir();

// Sonda: a cada 100 ms bate no /health e anota o round-trip.
const sondas = [];
let sondando = true;
const sonda = (async () => {
  while (sondando) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${mcp.base}/health`, { signal: AbortSignal.timeout(60000) });
      await r.text();
      sondas.push({ t: Date.now(), ms: Date.now() - t0, ok: true });
    } catch (e) {
      sondas.push({ t: Date.now(), ms: Date.now() - t0, ok: false, e: e.message });
    }
    await new Promise((r) => setTimeout(r, 100));
  }
})();

await new Promise((r) => setTimeout(r, 500));
console.log("disparando a bomba brotli (150 MB descomprimidos, poucos KB no fio)...");
const t0 = Date.now();
const bomba = await call(mcp, "read_page", { url: `${A}/bomba`, maxChars: 1000 });
const total = Date.now() - t0;
sondando = false;
await sonda;

console.log(`bomba terminou em ${total}ms | erro=${bomba.erro} | isError=${bomba.isError}`);
console.log(`texto: ${bomba.texto.slice(0, 140).replace(/\s+/g, " ")}\n`);

// Analisa as sondas: qual foi a maior pausa SEM resposta?
sondas.sort((a, b) => a.t - b.t);
let maiorBuraco = 0;
let inicioBuraco = 0;
for (let i = 1; i < sondas.length; i++) {
  const buraco = sondas[i].t - sondas[i - 1].t;
  if (buraco > maiorBuraco) {
    maiorBuraco = buraco;
    inicioBuraco = sondas[i - 1].t;
  }
}
const lentas = sondas.filter((s) => s.ms > 1000);
console.log(`sondas ao /health: ${sondas.length}`);
console.log(`maior pausa sem resposta do /health: ${(maiorBuraco / 1000).toFixed(1)}s`);
console.log(`sondas que demoraram >1s: ${lentas.length}`);
if (lentas.length) {
  console.log(`  a mais lenta: ${(Math.max(...lentas.map((s) => s.ms)) / 1000).toFixed(1)}s`);
}
const travado = maiorBuraco > 3000;
console.log(
  travado
    ? `\n>>> CONFIRMADO: durante a bomba o servidor ficou ${(maiorBuraco / 1000).toFixed(1)}s SEM ATENDER NADA.`
    : `\n>>> NAO confirmado: o /health continuou respondendo (maior pausa ${(maiorBuraco / 1000).toFixed(1)}s).`
);

// O servidor ainda esta inteiro depois?
const depois = await call(mcp, "read_page", { url: `${A}/ok`, maxChars: 500 });
console.log(`depois da bomba, read_page normal: ${depois.erro || depois.ms + "ms, isError=" + depois.isError}`);
mcp.child.kill();

// ---------------------------------------------------------------------------
// 2) Rajada: robots.txt gigante ou admissao?
// ---------------------------------------------------------------------------
console.log("\n=== ACHADO 2: rajada lenta — de onde vem o tempo? ===\n");

function criarAlvo(robotsGrande) {
  const regras = robotsGrande
    ? "User-agent: *\n" + Array.from({ length: 20000 }, (_, i) => `Disallow: /lixo${i}`).join("\n") + "\n"
    : "User-agent: *\nAllow: /\n";
  return http.createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(regras);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><body><h1>${req.url}</h1><p>rapido</p></body></html>`);
  });
}

for (const [rotulo, robotsGrande, n] of [
  ["robots.txt PEQUENO, 50 URLs", false, 50],
  ["robots.txt 20 MIL regras, 50 URLs", true, 50],
  ["robots.txt 20 MIL regras, 200 URLs", true, 200],
  ["robots.txt PEQUENO, 200 URLs", false, 200],
]) {
  const srv = criarAlvo(robotsGrande);
  const p = await freePort();
  await new Promise((r) => srv.listen(p, "127.0.0.1", r));
  const m2 = await subir();
  // dispara tudo de uma vez
  const tr = Date.now();
  const res = await Promise.all(Array.from({ length: n }, (_, i) => call(m2, "read_page", { url: `http://127.0.0.1:${p}/pg/${i}?u=${i}`, maxChars: 300 }, 120000)));
  const parede = Date.now() - tr;
  const ok = res.filter((r) => !r.erro && !r.isError).length;
  const lentos = res.filter((r) => r.erro).length;
  const ms = res.map((r) => r.ms).sort((a, b) => a - b);
  console.log(
    `${rotulo}: ${ok}/${n} ok, ${lentos} falhas | parede ${parede}ms | p50 ${ms[Math.floor(n / 2)]}ms | max ${ms[n - 1]}ms`
  );
  m2.child.kill();
  srv.close();
  await new Promise((r) => setTimeout(r, 200));
}

console.log("\n=== ACHADO 2b: e com o teto de admissao estourado? ===");
{
  const srv = criarAlvo(false);
  const p = await freePort();
  await new Promise((r) => srv.listen(p, "127.0.0.1", r));
  const m3 = await subir({ MAX_INFLIGHT_REQUESTS: "8", MAX_WAITING_REQUESTS: "4", MAX_WAIT_MS: "2000" });
  const tr = Date.now();
  const res = await Promise.all(Array.from({ length: 40 }, (_, i) => call(m3, "read_page", { url: `http://127.0.0.1:${p}/pg/${i}?x=${i}`, maxChars: 200 }, 40000)));
  const parede = Date.now() - tr;
  const motivos = new Map();
  for (const r of res) {
    const k = r.erro ? "timeout do cliente" : r.isError ? r.texto.slice(0, 60).replace(/\d+/g, "N") : "ok";
    motivos.set(k, (motivos.get(k) || 0) + 1);
  }
  console.log(`admissao 8+4, 40 requisicoes: parede ${parede}ms`);
  for (const [k, v] of motivos) console.log(`   x${v}: ${k}`);
  console.log(`   /health sob recusa: ${(await fetch(`${m3.base}/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.status).catch((e) => e.message))}`);
  m3.child.kill();
  srv.close();
}

process.exit(0);
