#!/usr/bin/env node
/**
 * _mede-robots-fixture.mjs — mede o custo REAL do robots.txt no caminho de leitura.
 *
 * Por que fixture local: numa medição contra a internet o ruído da rede
 * (100-800ms de variação por site) engole o ganho que se quer provar. Aqui o
 * servidor de teste responde o robots.txt com um atraso FIXO e conhecido
 * (ROBOTS_DELAY_MS), então a diferença entre as versões do código aparece
 * limpa, sem internet no meio.
 *
 * Lê N páginas distintas (URLs diferentes para não bater no cache) e devolve
 * a mediana por leitura.
 *
 * Uso: node dev/_mede-robots-fixture.mjs [voltas]
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const VOLTAS = Number(process.argv[2]) || 8;
const ROBOTS_DELAY_MS = Number(process.argv[3]) || 300;
// Atraso do HTML: página de verdade leva centenas de ms para chegar. É esse
// tempo que o robots em paralelo consegue cobrir — com página instantânea o
// ganho seria sempre ~0 e o fixture não representaria nada.
const PAGINA_DELAY_MS = Number(process.argv[4]) || 400;
const MCP_PORT = 6800 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${MCP_PORT}`;
const TOKEN = "fixture-token";
const auth = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };

/* ---------------- servidor de fixture (robots lento, página rápida) -------- */
const corpo = "<html><head><title>Fixture</title></head><body>" +
  "<h1>Titulo</h1>" + "<p>Texto de teste para o parser.</p>".repeat(40) +
  "</body></html>";

const fixture = createServer((req, res) => {
  if (req.url === "/robots.txt") {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
    }, ROBOTS_DELAY_MS);
    return;
  }
  if (req.url && req.url.startsWith("/p/")) {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(corpo);
    }, PAGINA_DELAY_MS);
    return;
  }
  res.writeHead(404).end("nao");
});
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
const FIX = `http://127.0.0.1:${fixture.address().port}`;

/* ------------------------------- servidor MCP ---------------------------- */
const servidor = spawn(process.execPath, ["server.js"], {
  env: {
    ...process.env,
    PORT: String(MCP_PORT),
    MCP_AUTH_TOKEN: TOKEN,
    ALLOW_PRIVATE_HOSTS: "1",
    RATE_LIMIT_MAX: "100000",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
servidor.stderr.on("data", () => {});

async function esperar() {
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    try {
      const r = await fetch(BASE + "/health", { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let idSeq = 1;
async function chamar(name, args, timeoutMs = 30000) {
  const t0 = Date.now();
  const res = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++idSeq, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.status === 200 && !json?.result?.isError, ms: Date.now() - t0, json };
}

function mediana(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

try {
  if (!(await esperar())) throw new Error("o servidor MCP nao subiu");
  await fetch(BASE + "/mcp", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ jsonrpc: "2.0", id: idSeq++, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mede", version: "1" } } }),
  });

  const tempos = [];
  const robots = [];
  for (let i = 0; i < VOLTAS; i++) {
    // URL nova a cada volta: sem cache de página. O robots.txt da origem é o
    // MESMO — então esse só é buscado de novo quando o TTL permite, e é por
    // isso que a primeira volta é medida à parte.
    const r = await chamar("read_page", { url: `${FIX}/p/${i}`, maxChars: 4000, timeoutMs: 30000 });
    if (!r.ok) {
      console.log(`volta ${i + 1}: FALHOU`);
      continue;
    }
    tempos.push(r.ms);
    console.log(`volta ${i + 1}: ${r.ms} ms`);
    if (i === 0) robots.push(r.ms);
  }

  console.log(`\nrobots.txt atrasado em ${ROBOTS_DELAY_MS} ms (atraso fixo do fixture)`);
  console.log(`1a leitura (robots frio): ${robots[0]} ms`);
  console.log(`leituras seguintes: mediana ${mediana(tempos.slice(1))} ms  (n=${tempos.length - 1})`);
  console.log(`todas: mediana ${mediana(tempos)} ms  min ${Math.min(...tempos)} ms  max ${Math.max(...tempos)} ms`);
} finally {
  servidor.kill("SIGTERM");
  fixture.close();
  await new Promise((r) => setTimeout(r, 300));
  servidor.kill("SIGKILL");
}
