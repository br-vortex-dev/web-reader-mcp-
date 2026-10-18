#!/usr/bin/env node
/**
 * _repro-robots.mjs — reprodução do travamento: robots.txt que estaciona o corpo.
 *
 * Cenário suspeito: o servidor busca /robots.txt de uma origem; a resposta chega
 * com o cabeçalho 200 e um pedaço do corpo, e NUNCA termina. Em security.mjs o
 * tempo máximo (ROBOTS_TIMEOUT_MS) é cancelado assim que o cabeçalho chega — a
 * leitura do corpo fica SEM teto. Toda leitura daquela origem espera para sempre;
 * cada requisição admitida segura uma vaga de admissão e o servidor satura de vez
 * (foi o que aconteceu no Render depois da rajada de 4096: 128 vagas presas,
 * >100 minutos, conexoes 0, downloads 0 — mesmo sintoma).
 *
 * Este script:
 *   1. sobe DOIS fixtures: um normal (controle) e um com robots.txt que estaciona;
 *   2. sobe o servidor do repositório em modo HTTP (ALLOW_PRIVATE_HOSTS=1);
 *   3. lê uma página do fixture normal (controle — deve concluir);
 *   4. lê uma página do fixture travado com teto de cliente de 10s;
 *   5. aborta o cliente (como quem desiste na vida real) e observa o /health.
 *
 * Veredito:
 *   - chamada 2 pendente aos 10s e "ativas" preso em 1 -> REPRODUZIDO;
 *   - chamada 2 conclui em ~1,5-3s e "ativas" volta a 0 -> não reproduzido.
 *
 * Uso: node dev/_repro-robots.mjs [segundosDeObservacao]
 */

import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(__dirname, "..");
const OBSERVAR_S = Math.max(40, Number(process.argv[2] || 180));
const TOKEN = "repro-robots";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

/* --------------------------------- fixtures -------------------------------- */

function paginaDeTeste() {
  return (
    "<!DOCTYPE html><html><head><title>pagina de teste</title></head><body>" +
    "<h1>ok</h1><p>" +
    "texto de recheio para a pagina ter conteudo visivel. ".repeat(30) +
    "</p></body></html>"
  );
}

// Fixture NORMAL: robots.txt responde e termina.
async function subirFixtureNormal() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://local");
    if (u.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(paginaDeTeste());
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

// Fixture TRAVADO: robots.txt manda cabeçalho + um pedaço do corpo e nunca termina.
async function subirFixtureTravado() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://local");
    if (u.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("User-agent: *\n"); // e nunca res.end()
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(paginaDeTeste());
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

/* --------------------------------- servidor -------------------------------- */

async function subirServidor(port) {
  const child = spawn(process.execPath, [resolve(RAIZ, "server.js"), "--http"], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(port),
      MCP_AUTH_TOKEN: TOKEN,
      ALLOW_PRIVATE_HOSTS: "1",
      TRUST_PROXY_HOPS: "0",
      RATE_LIMIT_MAX: "1000000",
      ROBOTS_TIMEOUT_MS: "1500",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(base + "/health")).ok) return { child, base, stderr: () => stderr };
    } catch {
      // ainda subindo
    }
    await sleep(100);
  }
  child.kill();
  throw new Error(`servidor nao subiu:\n${stderr}`);
}

/* ------------------------------ chamada MCP -------------------------------- */

async function chamarReadPage(base, url, { controller, timeoutMs = 5000 } = {}) {
  const t0 = Date.now();
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "read_page", arguments: { url, maxChars: 500, timeoutMs } },
    }),
    signal: controller?.signal,
  });
  const texto = await res.text();
  return { ms: Date.now() - t0, texto };
}

async function lerAtivas(base) {
  try {
    const t = await (await fetch(base + "/health", { signal: AbortSignal.timeout(10000) })).text();
    const m = t.match(/requisicoes: (\d+) ativas, (\d+) na fila/);
    const c = t.match(/conexoes: (\d+)/);
    const d = t.match(/downloads: (\d+) ativos/);
    return { ativas: m && m[1], fila: m && m[2], downloads: d && d[1], conexoes: c && c[1] };
  } catch (e) {
    return { erro: String(e && e.message ? e.message : e) };
  }
}

/* ----------------------------------- main ---------------------------------- */

const normal = await subirFixtureNormal();
const travado = await subirFixtureTravado();
console.log(`fixture normal:  http://127.0.0.1:${normal.port} (robots.txt normal)`);
console.log(`fixture travado: http://127.0.0.1:${travado.port} (robots.txt estaciona o corpo)`);

const port = await freePort();
const srv = await subirServidor(port);
console.log(`servidor do repo: ${srv.base} (ROBOTS_TIMEOUT_MS=1500)`);

const pagina = (p) => `http://127.0.0.1:${p}/pagina`;

// 1) CONTROLE: origem com robots normal tem de concluir.
try {
  const ctrl = await chamarReadPage(srv.base, pagina(normal.port));
  console.log(`\n[controle] read_page no fixture normal: concluiu em ${ctrl.ms} ms`);
} catch (e) {
  console.log(`\n[controle] falhou (inesperado): ${e.message}`);
}

// 2) O CASO: origem com robots que estaciona.
const controller = new AbortController();
let resolvida = false;
let msResolvida = null;
const chamada = chamarReadPage(srv.base, pagina(travado.port), { controller })
  .then((r) => {
    resolvida = true;
    msResolvida = r.ms;
    return r;
  })
  .catch((e) => {
    resolvida = true;
    msResolvida = null;
    return { erro: String(e && e.message ? e.message : e) };
  });

const t0 = Date.now();
await sleep(10000);
console.log(
  `\n[travado] read_page com robots estacionado: ` +
    (resolvida ? `concluiu em ${msResolvida} ms` : `AINDA PENDENTE apos ${Math.round((Date.now() - t0) / 1000)}s`)
);
console.log(`abortando o cliente (o servidor n\u00e3o v\u00ea o abort \u2014 como quem desiste de verdade)...`);
controller.abort();
await chamada;

console.log(`health logo apos o abort: ${JSON.stringify(await lerAtivas(srv.base))}`);

const fim = t0 + OBSERVAR_S * 1000;
let liberou = false;
while (Date.now() < fim) {
  await sleep(15000);
  const h = await lerAtivas(srv.base);
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s] health: ${JSON.stringify(h)}`);
  if (h.ativas === "0") {
    liberou = true;
    break;
  }
}

console.log("");
if (liberou) {
  console.log("VEREDITO: n\u00e3o reproduziu \u2014 a vaga foi liberada.");
} else {
  console.log(
    `VEREDITO: REPRODUZIDO \u2014 a vaga ficou presa por pelo menos ${OBSERVAR_S}s ` +
      "(em produ\u00e7\u00e3o foram mais de 100 minutos)."
  );
}

try {
  srv.child.kill();
} catch {
  // encerrando
}
for (const f of [normal, travado]) {
  try {
    f.server.closeAllConnections?.();
    f.server.close();
  } catch {
    // encerrando
  }
}
process.exit(0);
