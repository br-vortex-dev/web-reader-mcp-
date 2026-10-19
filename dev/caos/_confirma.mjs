#!/usr/bin/env node
// Confirma os achados da bateria de caos, um por um, com a configuracao de
// PRODUCAO (ALLOW_PRIVATE_HOSTS desligado). Sem isso o relatorio mente.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { criarMalicioso } from "./fixture-malicioso.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..", "..");
const TOKEN = "token-confirma";

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
    env: { ...process.env, PORT: String(port), MCP_AUTH_TOKEN: TOKEN, TRUST_PROXY_HOPS: "0", RATE_LIMIT_MAX: "1000000", ...env },
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
  child.kill();
  throw new Error("nao subiu:\n" + err);
}

const call = async (mcp, name, cargs, ms = 30000) => {
  const t0 = Date.now();
  try {
    const r = await fetch(`${mcp.base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: cargs } }),
      signal: AbortSignal.timeout(ms),
    });
    const j = await r.json().catch(() => null);
    return { ms: Date.now() - t0, status: r.status, isError: Boolean(j?.result?.isError), texto: String(j?.result?.content?.[0]?.text ?? ""), erro: null };
  } catch (e) {
    return { ms: Date.now() - t0, status: 0, isError: false, texto: "", erro: e.name === "TimeoutError" ? "timeout" : e.message };
  }
};

const mal = criarMalicioso();
const portaAlvo = await freePort();
await new Promise((r) => mal.server.listen(portaAlvo, "127.0.0.1", r));
const alvo = `http://127.0.0.1:${portaAlvo}`;

// ------------------------------------------------------------------
// 1) SSRF com a guarda LIGADA (config de producao)
// ------------------------------------------------------------------
console.log("=== 1. SSRF com ALLOW_PRIVATE_HOSTS desligado (producao) ===");
const prod = await subir(); // sem ALLOW_PRIVATE_HOSTS
for (const [nome, url] of [
  ["metadata cloud 169.254.169.254", "http://169.254.169.254/latest/meta-data/"],
  ["rede 10.x", "http://10.0.0.1/"],
  ["rede 192.168.x", "http://192.168.1.1/"],
  ["rede 172.16.x", "http://172.16.0.1/"],
  ["127.0.0.1", "http://127.0.0.1:1/"],
]) {
  const r = await call(prod, "read_page", { url, maxChars: 500 }, 15000);
  const bloqueou = r.isError && /bloquead|privad|intern/i.test(r.texto);
  console.log(`  ${bloqueou ? "BLOQUEADO" : "!!! PASSOU"} — ${nome}: ${r.texto.slice(0, 100).replace(/\s+/g, " ")}`);
}

// redirect de host publico para interno — precisa de um host que a guarda
// aceite como publico. Usamos o "segredo" local via DNS nao resolve; entao
// testamos o caminho: a URL inicial e 127.0.0.1 (bloqueada ja na entrada).
const redir = await call(prod, "read_page", { url: `${alvo}/redirect-interno`, maxChars: 500 }, 15000);
console.log(`  redirect p/ interno com guarda ligada: ${redir.isError ? "bloqueado na entrada" : "PASSOU"} — ${redir.texto.slice(0, 100).replace(/\s+/g, " ")}`);
prod.child.kill();

// ------------------------------------------------------------------
// 2) bomba brotli: por que travou?
// ------------------------------------------------------------------
console.log("\n=== 2. Bomba brotli (150 MB descomprimidos) ===");
const dev = await subir({ ALLOW_PRIVATE_HOSTS: "1" });
for (const [nome, rota] of [["brotli 150MB", "/bomba-brotli"], ["gzip 200MB", "/bomba-gzip"]]) {
  const r = await call(dev, "read_page", { url: `${alvo}${rota}`, maxChars: 1000 }, 60000);
  console.log(`  ${nome}: ${r.erro ? "TIMEOUT" : r.ms + "ms"} | isError=${r.isError} | ${r.texto.slice(0, 110).replace(/\s+/g, " ")}`);
  const h = await fetch(`${dev.base}/health`).then((x) => x.text()).catch((e) => "health falhou: " + e.message);
  console.log(`    health: ${h.slice(0, 130)}`);
}

// ------------------------------------------------------------------
// 3) rajada de URLs distintas: onde engasga?
// ------------------------------------------------------------------
console.log("\n=== 3. Rajada de 300 URLs distintas (mesmo host) ===");
for (const n of [50, 150, 300]) {
  const t0 = Date.now();
  const res = await Promise.all(Array.from({ length: n }, (_, i) => call(dev, "read_page", { url: `${alvo}/p/r${n}-${i}?i=${i}`, maxChars: 300 }, 60000)));
  const ok = res.filter((r) => r.status === 200 && !r.erro).length;
  const erros = res.filter((r) => r.erro).length;
  const isErr = res.filter((r) => r.isError).length;
  const ms = res.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`  ${n} simultaneas: ${ok} ok, ${erros} timeout, ${isErr} isError | parede ${Date.now() - t0}ms | p50 ${ms[Math.floor(n / 2)]}ms p99 ${ms[Math.floor(n * 0.99)]}ms max ${ms[n - 1]}ms`);
  const motivos = new Map();
  for (const r of res) if (r.isError || r.erro) motivos.set((r.erro || r.texto).slice(0, 70).replace(/\d+/g, "N"), (motivos.get((r.erro || r.texto).slice(0, 70).replace(/\d+/g, "N")) || 0) + 1);
  for (const [m, c] of motivos) console.log(`      x${c}: ${m}`);
  const vivo = (await fetch(`${dev.base}/health`).then((x) => x.ok).catch(() => false)) && dev.child.exitCode === null;
  console.log(`    servidor vivo: ${vivo}`);
}

console.log("\nstderr do servidor:", dev.stderr().trim().split("\n").slice(-6).join("\n") || "(vazio)");
dev.child.kill();
mal.server.close();
process.exit(0);
