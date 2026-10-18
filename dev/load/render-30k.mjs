#!/usr/bin/env node
/**
 * render-30k.mjs — prova de carga REAL: rajada de admissão + volume de 30.000.
 *
 * FASE 1 — rajada de admissão (--ladder 256,512,1024,2048):
 *   cada cliente dispara UMA chamada `read_multiple_pages` na MESMA lista
 *   (os 20 sites difíceis). Mede quantas completam, quanto esperam e como o
 *   servidor responde quando não cabe: 503 (admissão cheia) ou 429 (rate
 *   limit do IP). As MESMAS URLs são de propósito: é o cenário "muita gente
 *   lendo os mesmo sites", que o cache + coalescing devem absorver.
 *
 * FASE 2 — volume (--volume 30000):
 *   entrega 30.000 requisições ao todo com concorrência fixa, no mesmo
 *   cenário. Mede vazão, latência (p50/p95/p99), distribuição de classes,
 *   bytes recebidos e páginas realmente lidas.
 *
 * Uso remoto:
 *   node dev/load/render-30k.mjs --url https://SEU-APP.onrender.com --token "$TOKEN"
 *   ... [--volume-rps 140] [--gap 75] [--warm-read 1] [--json resultado.json]
 *   node dev/load/render-30k.mjs --url ... --token ... --dry     # só valida token/conexão
 *
 * Uso local (sobe o servidor do repositório e roda contra ele):
 *   node dev/load/render-30k.mjs --local --set leves --ladder 4,8 --volume 60
 *
 * O token nunca é gravado em arquivo; passe por --token ou LIVE_TEST_TOKEN.
 *
 * Física do cliente: uma máquina não abre 30.000 conexões simultâneas (o
 * Windows tem 16.384 portas dinâmicas). A rajada vai até onde o cliente
 * aguentar; o resto da prova é o volume entregue e lido no /health.
 * Física do servidor: uma instância admite MAX_INFLIGHT_REQUESTS em voo,
 * enfileira o resto (MAX_WAITING_REQUESTS) e devolve 503 explícito ao que
 * não couber — medir isso é o ponto.
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(__dirname, "..", "..");

/* ---------------------------------- args ---------------------------------- */

const args = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i === -1 ? padrao : args[i + 1];
};
const temFlag = (nome) => args.includes(`--${nome}`);

const LOCAL = temFlag("local");
const DRY = temFlag("dry");
let BASE = String(arg("url", process.env.RENDER_URL || "")).replace(/\/+$/, "");
let TOKEN = String(arg("token", process.env.LIVE_TEST_TOKEN || ""));
const ESCADA = String(arg("ladder", "256,512,1024,2048"))
  .split(",")
  .map((n) => Math.floor(Number(n)))
  .filter((n) => n > 0);
const LADDER_CAP_MS = Number(arg("ladder-cap", 300)) * 1000;
const PAUSA_MS = Number(arg("pause", 1500));
const VOLUME = Math.max(0, Math.floor(Number(arg("volume", 30000))));
const VOLUME_CONC = Math.max(1, Math.floor(Number(arg("volume-conc", 512))));
const VOLUME_MODE = String(arg("volume-mode", "multi-cache")); // multi-cache | read-cache | tools
const VOLUME_CAP_MS = Number(arg("volume-cap", 3600)) * 1000;
const VOLUME_RPS = Math.max(0, Number(arg("volume-rps", 0))); // ritmo máximo (req/s); 0 = sem freio
const GAP_S = Math.max(0, Number(arg("gap", 0))); // pausa entre a rajada e o volume
const WARM_READ = String(arg("warm-read", "1")) !== "0"; // aquece o cache antes da rajada
const SET = String(arg("set", "hard")); // hard | leves
const MAXCHARS = Number(arg("maxchars", 2000));
const TOOL_TIMEOUT = Number(arg("tool-timeout", 60000));
const CLIENT_TIMEOUT = Number(arg("client-timeout", 120000));
const JSON_OUT = String(arg("json", ""));
const AQUECER = Number(arg("warmup", 4));

if (LOCAL && !TOKEN) TOKEN = "valida-local";
if (!LOCAL && (!BASE || !TOKEN)) {
  console.error(
    "uso: node dev/load/render-30k.mjs --url https://... --token <token> " +
      "[--ladder 256,512,1024,2048] [--volume 30000] [--volume-conc 512] " +
      "[--volume-mode multi-cache|read-cache|tools] [--set hard|leves] [--json out.json] [--dry]\n" +
      "     node dev/load/render-30k.mjs --local [--set leves] [--ladder 4,8] [--volume 60]"
  );
  process.exit(1);
}

/* --------------------------------- alvos ---------------------------------- */

const SITES_HARD = [
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

const SITES_LEVES = ["https://example.com", "https://example.net", "https://httpbin.org/html"];

const ALVOS = SET === "leves" ? SITES_LEVES : SITES_HARD;
const NOME_SET = SET === "leves" ? "sites leves (validação)" : "os 20 sites difíceis";

/* --------------------------------- corpos --------------------------------- */

function corpoRajada(id) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "read_multiple_pages",
      arguments: { urls: ALVOS, maxChars: MAXCHARS, timeoutMs: TOOL_TIMEOUT },
    },
  });
}

function corpoVolume(id) {
  if (VOLUME_MODE === "tools") {
    return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" });
  }
  if (VOLUME_MODE === "read-cache") {
    const u = new URL(SITES_LEVES[0]);
    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "read_page", arguments: { url: u.href, maxChars: MAXCHARS, timeoutMs: TOOL_TIMEOUT } },
    });
  }
  // multi-cache (padrão): os mesmos alvos, cache quente + coalescing
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "read_multiple_pages",
      arguments: { urls: ALVOS, maxChars: MAXCHARS, timeoutMs: TOOL_TIMEOUT },
    },
  });
}

/* ------------------------------- conexão ---------------------------------- */

function alvoDe(base) {
  const u = new URL(base + "/mcp");
  const LIB = u.protocol === "https:" ? https : http;
  const porta = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  return { u, LIB, porta };
}

/* ----------------------------- uma requisição ----------------------------- */

function pedir(ctx, agent, corpo) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const req = ctx.LIB.request(
      {
        hostname: ctx.u.hostname,
        port: ctx.porta,
        path: ctx.u.pathname,
        method: "POST",
        agent,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
          "content-length": Buffer.byteLength(corpo),
        },
      },
      (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (texto += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            texto,
            ms: Number(process.hrtime.bigint() - t0) / 1e6,
            bytes: Buffer.byteLength(texto),
          })
        );
      }
    );
    req.setTimeout(CLIENT_TIMEOUT, () => req.destroy(new Error("timeout-cliente")));
    req.on("error", (err) =>
      resolve({ erroRede: err.code || err.message, ms: Number(process.hrtime.bigint() - t0) / 1e6 })
    );
    req.end(corpo);
  });
}

/* ------------------------------ classificação ----------------------------- */

function classificar(res) {
  if (res.erroRede) return { classe: "rede: " + res.erroRede };
  if (res.status === 503) return { classe: "503 admissao" };
  if (res.status === 429) return { classe: "429 rate limit" };
  if (res.status === 401) return { classe: "401 auth (token?)" };
  if (res.status !== 200) return { classe: "HTTP " + res.status };
  let j;
  try {
    j = JSON.parse(res.texto);
  } catch {
    return { classe: "resposta nao-JSON" };
  }
  const msg = Array.isArray(j) ? j[0] : j;
  if (msg?.error) return { classe: "rpc " + msg.error.code };
  const r = msg?.result;
  if (r?.isError) {
    const txt = String(r.content?.[0]?.text || "")
      .replace(/\s+/g, " ")
      .slice(0, 70)
      .replace(/\d+/g, "N");
    return { classe: "ferramenta: " + txt };
  }
  const texto = String(r?.content?.[0]?.text || "");
  const m = texto.match(/(\d+)\/(\d+)\s+paginas OK/);
  if (m) return { classe: "ok", paginasOK: Number(m[1]), paginasTotal: Number(m[2]) };
  return { classe: "ok" };
}

/* --------------------------------- coletor -------------------------------- */

function criarColetor() {
  return { req: 0, classes: new Map(), lat: [], ok: 0, paginasOK: 0, paginasTotal: 0, bytes: 0, travaram: 0 };
}

function absorver(st, r) {
  st.req++;
  st.lat.push(r.ms);
  st.bytes += r.bytes || 0;
  const c = classificar(r);
  st.classes.set(c.classe, (st.classes.get(c.classe) || 0) + 1);
  if (c.classe === "ok") st.ok++;
  if (c.paginasOK !== undefined) {
    st.paginasOK += c.paginasOK;
    st.paginasTotal += c.paginasTotal;
  }
}

const pct = (ord, p) =>
  ord.length ? ord[Math.min(ord.length - 1, Math.floor((p / 100) * ord.length))] : 0;

function linhaClasse(st) {
  return [...st.classes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" | ");
}

function resumir(st) {
  const ord = [...st.lat].sort((a, b) => a - b);
  const seg = st.ms / 1000;
  return {
    enviados: st.req,
    ok: st.ok,
    reqPorSeg: Number((st.req / seg).toFixed(2)),
    latP50: Math.round(pct(ord, 50)),
    latP95: Math.round(pct(ord, 95)),
    latP99: Math.round(pct(ord, 99)),
    latMax: Math.round(ord[ord.length - 1] || 0),
    ms: Math.round(st.ms),
    classes: Object.fromEntries(st.classes),
    classesResumo: linhaClasse(st),
    paginasOK: st.paginasOK,
    paginasTotal: st.paginasTotal,
    mbRecebidos: Number((st.bytes / 1048576).toFixed(1)),
    travaram: st.travaram || 0,
  };
}

/* --------------------------------- health --------------------------------- */

function parseHealth(t) {
  const g = (re) => {
    const m = t.match(re);
    return m ? m[1] : "?";
  };
  return {
    rssMB: g(/rss: (\d+) MB/),
    cache: g(/cache: (\d+) entradas/),
    reqRecusadas: g(/requisicoes:[^|]*?recusadas (\d+)/),
    dlRecusados: g(/downloads:[^|]*?recusados (\d+)/),
    conexoes: g(/conexoes: (\d+)/),
    coalescidas: g(/coalescidas: (\d+)/),
    revalidacoes: g(/revalidacoes: (\d+)/),
    conversoes: g(/conversoes: (\d+)/),
    raw: t,
  };
}

async function lerHealth(base) {
  try {
    const res = await fetch(base + "/health", { signal: AbortSignal.timeout(20000) });
    return parseHealth(await res.text());
  } catch (e) {
    return { raw: "erro health: " + e.message };
  }
}

const compacto = (h) =>
  `rss ${h.rssMB}MB | req recusadas ${h.reqRecusadas} | dl recusados ${h.dlRecusados} | ` +
  `coalescidas ${h.coalescidas} | revalidacoes ${h.revalidacoes} | conexoes ${h.conexoes}`;

/* -------------------------------- fase 1 ---------------------------------- */

async function degrauRajada(ctx, conc) {
  const agent = new ctx.LIB.Agent({ keepAlive: true, maxSockets: conc + 8, maxFreeSockets: conc + 8 });
  const st = criarColetor();
  let concluidas = 0;
  const t0 = Date.now();

  const clientes = Array.from({ length: conc }, (_, i) =>
    pedir(ctx, agent, corpoRajada(i + 1))
      .then((r) => {
        concluidas++;
        absorver(st, r);
      })
      .catch((e) => {
        concluidas++;
        st.req++;
        st.classes.set("script: " + e.message, (st.classes.get("script: " + e.message) || 0) + 1);
      })
  );

  console.log(`  ${conc} disparadas ao mesmo tempo...`);
  await Promise.race([Promise.all(clientes), new Promise((r) => setTimeout(r, LADDER_CAP_MS))]);
  if (concluidas < conc) {
    console.log(`  teto de ${Math.round(LADDER_CAP_MS / 1000)}s do degrau estourou — derrubando as pendentes`);
    agent.destroy();
    await new Promise((r) => setTimeout(r, 3000));
  }
  st.ms = Date.now() - t0;
  st.travaram = conc - concluidas;
  agent.destroy();
  return st;
}

/* -------------------------------- fase 2 ---------------------------------- */

async function faseVolume(ctx, total, conc, modo) {
  const agent = new ctx.LIB.Agent({ keepAlive: true, maxSockets: conc + 8, maxFreeSockets: conc + 8 });
  const st = criarColetor();
  let prox = 0;
  let parar = false;
  const t0 = Date.now();

  const progresso = setInterval(() => {
    const seg = (Date.now() - t0) / 1000;
    console.log(
      `  [volume] ${st.req}/${total} | ok ${st.ok} | ${(st.req / seg).toFixed(0)} req/s | ` +
        `recentes: ${linhaClasse(st).slice(0, 120)}`
    );
  }, 5000);
  const relogio = setTimeout(() => {
    parar = true;
    console.log("  [volume] teto de tempo atingido — parando os envios");
  }, VOLUME_CAP_MS);

  const trabalhar = async () => {
    for (;;) {
      if (parar) return;
      const i = prox++;
      if (i >= total) return;
      if (VOLUME_RPS > 0) {
        const alvo = t0 + (i * 1000) / VOLUME_RPS;
        const espera = alvo - Date.now();
        if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      }
      try {
        absorver(st, await pedir(ctx, agent, corpoVolume(i + 1)));
      } catch (e) {
        st.req++;
        st.classes.set("script: " + e.message, (st.classes.get("script: " + e.message) || 0) + 1);
      }
    }
  };

  await Promise.all(Array.from({ length: conc }, () => trabalhar()));
  clearInterval(progresso);
  clearTimeout(relogio);
  st.ms = Date.now() - t0;
  agent.destroy();
  return st;
}

/* --------------------------------- local ---------------------------------- */

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

async function subirLocal() {
  const port = await freePort();
  const child = spawn(process.execPath, [resolve(RAIZ, "server.js"), "--http"], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(port),
      MCP_AUTH_TOKEN: TOKEN,
      RATE_LIMIT_MAX: "1000000",
      TRUST_PROXY_HOPS: "0",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const base = `http://127.0.0.1:${port}`;
  let ok = false;
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(base + "/health")).ok) {
        ok = true;
        break;
      }
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ok) {
    child.kill();
    throw new Error("servidor local nao subiu:\n" + stderr);
  }
  const parar = () => {
    try {
      child.kill();
    } catch {}
  };
  process.on("exit", parar);
  return { base, parar };
}

/* ---------------------------------- main ---------------------------------- */

async function aquecer(ctx, seg) {
  const agent = new ctx.LIB.Agent({ keepAlive: true, maxSockets: 4 });
  const corpo = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list" });
  const fim = Date.now() + seg * 1000;
  while (Date.now() < fim) await pedir(ctx, agent, corpo);
  agent.destroy();
  if (WARM_READ) {
    process.stdout.write(`aquecendo o cache (1 read_multiple_pages de ${ALVOS.length} URLs)... `);
    const a2 = new ctx.LIB.Agent({ keepAlive: true, maxSockets: 8 });
    const r = await pedir(ctx, a2, corpoRajada(90001));
    a2.destroy();
    const c = classificar(r);
    console.log(
      `${c.classe} em ${Math.round(r.ms)} ms${c.paginasTotal ? ` (${c.paginasOK}/${c.paginasTotal} paginas)` : ""}`
    );
  }
}

(async () => {
  let pararLocal = null;
  if (LOCAL) {
    const sub = await subirLocal();
    BASE = sub.base;
    pararLocal = sub.parar;
    console.log(`local: servidor do repositorio no ar em ${BASE}`);
  }
  const ctx = alvoDe(BASE);

  console.log(`alvo:  ${BASE}`);
  console.log(`set:   ${NOME_SET} (${ALVOS.length} URLs)`);
  console.log(
    `fase1: rajada ${ESCADA.join(",")} x 1 read_multiple_pages | fase2: volume ${VOLUME} (modo ${VOLUME_MODE}, conc ${VOLUME_CONC})`
  );

  const h0 = await lerHealth(BASE);
  console.log(`health inicial: ${h0.raw.slice(0, 160)}`);

  if (DRY) {
    const agent = new ctx.LIB.Agent({ keepAlive: false });
    const r = await pedir(ctx, agent, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    agent.destroy();
    console.log(`teste seco (tools/list): ${JSON.stringify(classificar(r))} em ${Math.round(r.ms)} ms`);
    if (pararLocal) pararLocal();
    return;
  }

  if (AQUECER > 0) {
    process.stdout.write(`aquecendo ${AQUECER}s (tools/list)... `);
    await aquecer(ctx, AQUECER);
    console.log("ok");
  }

  const rajada = [];
  for (const conc of ESCADA) {
    console.log(`\n=== fase 1 | rajada conc=${conc} ===`);
    const st = await degrauRajada(ctx, conc);
    const h = await lerHealth(BASE);
    const r = resumir(st);
    console.log(
      `  responderam: ${r.enviados}/${conc}${r.travaram ? ` (travaram ${r.travaram})` : ""} em ${(r.ms / 1000).toFixed(1)}s | ` +
        `ok ${r.ok} | ${r.reqPorSeg} req/s`
    );
    console.log(`  lat ms: p50 ${r.latP50} | p95 ${r.latP95} | p99 ${r.latP99} | max ${r.latMax} | recebido ${r.mbRecebidos} MB`);
    console.log(`  classes: ${r.classesResumo}`);
    if (r.paginasTotal) console.log(`  paginas lidas: ${r.paginasOK}/${r.paginasTotal}`);
    console.log(`  health: ${compacto(h)}`);
    rajada.push({ conc, ...r, healthDepois: h });
    await new Promise((r2) => setTimeout(r2, PAUSA_MS));
  }

  if (VOLUME > 0 && GAP_S > 0) {
    console.log(`\nesperando ${GAP_S}s para a janela do rate limit esvaziar antes do volume...`);
    await new Promise((r) => setTimeout(r, GAP_S * 1000));
  }

  let volume = null;
  if (VOLUME > 0) {
    console.log(`\n=== fase 2 | volume de ${VOLUME} requisições ===`);
    const antes = await lerHealth(BASE);
    const st = await faseVolume(ctx, VOLUME, VOLUME_CONC, VOLUME_MODE);
    const depois = await lerHealth(BASE);
    const r = resumir(st);
    console.log(
      `  entregues: ${r.enviados}/${VOLUME} em ${(r.ms / 1000).toFixed(1)}s | ok ${r.ok} | ${r.reqPorSeg} req/s | recebido ${r.mbRecebidos} MB`
    );
    console.log(`  lat ms: p50 ${r.latP50} | p95 ${r.latP95} | p99 ${r.latP99} | max ${r.latMax}`);
    console.log(`  classes: ${r.classesResumo}`);
    if (r.paginasTotal) console.log(`  paginas lidas: ${r.paginasOK}/${r.paginasTotal}`);
    console.log(`  health: ${compacto(depois)}`);
    volume = { modo: VOLUME_MODE, conc: VOLUME_CONC, ...r, healthAntes: antes, healthDepois: depois };
  }

  const hFim = await lerHealth(BASE);
  console.log("\n===== RESUMO DA PROVA =====");
  for (const r of rajada) {
    console.log(`rajada ${r.conc} em voo: responderam ${r.enviados}/${r.conc} | ok ${r.ok} | p95 ${r.latP95} ms | ${r.classesResumo}`);
  }
  if (volume) {
    console.log(
      `volume ${volume.modo}: ${volume.enviados}/${VOLUME} | ok ${volume.ok} | p95 ${volume.latP95} ms | ` +
        `${volume.reqPorSeg} req/s | paginas ${volume.paginasOK}/${volume.paginasTotal} | ${volume.classesResumo}`
    );
  }
  console.log(`health final: ${compacto(hFim)}`);

  if (JSON_OUT) {
    fs.writeFileSync(
      JSON_OUT,
      JSON.stringify(
        { base: BASE, quando: new Date().toISOString(), set: SET, alvos: ALVOS, rajada, volume, healthFinal: hFim },
        null,
        2
      )
    );
    console.log(`\njson salvo em ${JSON_OUT}`);
  }
  if (pararLocal) pararLocal();
  // Encerra de vez: sockets keep-alive e o servidor local podem segurar o loop
  // de eventos; o teste já terminou e gravou a evidência.
  process.exit(0);
})().catch((e) => {
  console.error("erro inesperado:", e);
  process.exit(1);
});
