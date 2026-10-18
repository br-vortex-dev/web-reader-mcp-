#!/usr/bin/env node
/**
 * render-load.mjs — carga REMOTA contra um web-reader-mcp publicado (Render).
 *
 * Diferente de dev/load/harness.mjs, este script NÃO sobe servidor local:
 * dispara requisições HTTP reais contra a URL informada (conexões keep-alive),
 * em degraus de concorrência, e mede throughput, latência (p50/p95/p99),
 * erros e o estado do /health antes/depois de cada degrau.
 *
 * Uso:
 *   node dev/load/render-load.mjs --url https://SEU-APP.onrender.com --token "$TOKEN" \
 *     --mode tools --ladder 8,32,64 --seconds 8
 *
 * Modos:
 *   tools       -> tools/list (sem I/O externo: mede a camada HTTP/CPU pura)
 *   read        -> read_page em URLs leves com parâmetro único (cache miss)
 *   read-pesado -> read_page em portais pesados de verdade
 *   multi       -> read_multiple_pages com 20 sites; o degrau = nº de chamadas paralelas
 *
 * O token nunca é gravado em arquivo; passe por --token ou LIVE_TEST_TOKEN.
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";

/* ---------------------------------- args ---------------------------------- */

const args = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i === -1 ? padrao : args[i + 1];
};

const BASE = String(arg("url", process.env.RENDER_URL || "")).replace(/\/+$/, "");
const TOKEN = String(arg("token", process.env.LIVE_TEST_TOKEN || ""));
const MODO = String(arg("mode", "tools"));
const ESCADA = String(arg("ladder", "8"))
  .split(",")
  .map((n) => Math.floor(Number(n)))
  .filter((n) => n > 0);
const SEGUNDOS = Number(arg("seconds", 8));
const PIPELINE = Math.max(1, Number(arg("pipeline", 1)));
const TIMEOUT_MS = Number(arg("timeout", 60000)); // teto local por requisição HTTP
const TIMEOUT_FERR = Number(arg("tool-timeout", 12000)); // timeoutMs da ferramenta
const MAXCHARS = Number(arg("maxchars", 2000));
const AQUECER = Number(arg("warmup", 2));
const FRESH = args.includes("--fresh"); // multi: URL única por chamada (cache miss forçado)
const ONCE = args.includes("--once"); // cada cliente dispara UMA requisicao e sai (teste de admissao)
const JSON_OUT = String(arg("json", ""));

if (!BASE || !TOKEN) {
  console.error(
    "uso: node dev/load/render-load.mjs --url https://... --token <token> " +
      "[--mode tools|read|read-pesado|multi] [--ladder 8,32,64] [--seconds 8] [--json arquivo.json]"
  );
  process.exit(1);
}

/* --------------------------------- alvos ---------------------------------- */

const SITES_LEVES = [
  "https://example.com",
  "https://example.net",
  "https://httpbin.org/html",
  "https://pt.wikipedia.org/wiki/Node.js",
];

// Portais pesados de verdade ("os mais difíceis de ler").
const SITES_PESADOS = [
  "https://g1.globo.com",
  "https://www.bbc.com",
  "https://www.apple.com",
  "https://www.uol.com.br",
  "https://www.terra.com.br",
];

// Os mesmos 20 sites do benchmark do projeto (scripts/benchmark-20sites.mjs).
const SITES20 = [
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

/* ------------------------------- conexão ---------------------------------- */

const MCP = new URL(BASE + "/mcp");
const LIB = MCP.protocol === "https:" ? https : http;
const PORTA = MCP.port ? Number(MCP.port) : MCP.protocol === "https:" ? 443 : 80;

/* --------------------------------- corpos --------------------------------- */

function corpoPara(id) {
  if (MODO === "tools") {
    return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" });
  }
  if (MODO === "read" || MODO === "read-pesado" || MODO === "read-cache") {
    const lista = MODO === "read-pesado" ? SITES_PESADOS : SITES_LEVES;
    const u = new URL(lista[id % lista.length]);
    // read-cache: URL fixa (cache quente); os demais forçam cache miss
    if (MODO !== "read-cache") u.searchParams.set("lzc", String(id));
    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "read_page",
        arguments: { url: u.href, maxChars: MAXCHARS, timeoutMs: TIMEOUT_FERR },
      },
    });
  }
  if (MODO === "multi") {
    const urls = FRESH
      ? SITES20.map((s) => {
          const u = new URL(s);
          u.searchParams.set("lzc", String(id));
          return u.href;
        })
      : SITES20;
    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "read_multiple_pages",
        arguments: { urls, maxChars: MAXCHARS, timeoutMs: TIMEOUT_FERR },
      },
    });
  }
  throw new Error(`modo desconhecido: ${MODO}`);
}

/* ----------------------------- uma requisição ----------------------------- */

function umaRequisicao(agent, id) {
  return new Promise((resolve) => {
    const corpo = corpoPara(id);
    const t0 = process.hrtime.bigint();
    const req = LIB.request(
      {
        hostname: MCP.hostname,
        port: PORTA,
        path: MCP.pathname,
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
          })
        );
      }
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("timeout-local")));
    req.on("error", (err) =>
      resolve({ erroRede: err.code || err.message, ms: Number(process.hrtime.bigint() - t0) / 1e6 })
    );
    req.end(corpo);
  });
}

/* ------------------------------ classificação ----------------------------- */

function classificar(res) {
  if (res.erroRede) return { tipo: "rede", chave: "rede: " + res.erroRede };
  if (res.status !== 200) return { tipo: "status", chave: "HTTP " + res.status };
  let json;
  try {
    json = JSON.parse(res.texto);
  } catch {
    return { tipo: "lixo", chave: "resposta não-JSON" };
  }
  const resultado = Array.isArray(json) ? json[0]?.result : json?.result;
  if (json?.error) return { tipo: "rpc", chave: "rpc " + json.error.code };
  if (resultado?.isError) {
    const msg = String(resultado.content?.[0]?.text || "")
      .replace(/\s+/g, " ")
      .slice(0, 80)
      .replace(/\d+/g, "N");
    return { tipo: "ferramenta", chave: "isError: " + msg };
  }
  const texto = String(resultado?.content?.[0]?.text || "");
  const pag = texto.match(/Leitura concluida: (\d+)\/(\d+)/);
  if (pag) return { tipo: "ok", paginasOK: Number(pag[1]), paginasTotal: Number(pag[2]) };
  return { tipo: "ok" };
}

/* --------------------------------- degrau --------------------------------- */

async function executarDegrau(conc, segundos = SEGUNDOS) {
  const agent = new LIB.Agent({
    keepAlive: true,
    maxSockets: Math.max(conc * PIPELINE + 4, 8),
    maxFreeSockets: Math.max(conc * PIPELINE + 4, 8),
  });
  const st = {
    conc,
    req: 0,
    ok: 0,
    status: new Map(),
    erros: new Map(),
    lat: [],
    paginasOK: 0,
    paginasTotal: 0,
    chamadas: 0,
  };
  const contar = (map, chave) => map.set(chave, (map.get(chave) || 0) + 1);
  const t0 = Date.now();
  let parar = false;
  let seq = 0;

  const consumir = (r) => {
    st.lat.push(r.ms);
    const c = classificar(r);
    if (c.tipo === "ok") {
      st.ok++;
      if (c.paginasOK !== undefined) {
        st.paginasOK += c.paginasOK;
        st.paginasTotal += c.paginasTotal;
      }
    } else if (c.tipo === "status") contar(st.status, c.chave);
    else contar(st.erros, c.chave);
  };

  const cliente = async () => {
    if (MODO === "multi" || ONCE) {
      const id = ++seq;
      st.req++;
      if (MODO === "multi") st.chamadas++;
      consumir(await umaRequisicao(agent, id));
      return;
    }
    for (;;) {
      if (parar) return;
      const id = ++seq;
      st.req++;
      consumir(await umaRequisicao(agent, id));
    }
  };

  const clientes = Array.from({ length: conc }, () => cliente());
  if (MODO === "multi" || ONCE) {
    // Cada cliente faz UMA requisição; o degrau espera todas terminarem.
    await Promise.race([
      Promise.all(clientes),
      new Promise((r) => setTimeout(r, TIMEOUT_MS + 5000)),
    ]);
  } else {
    await new Promise((r) => setTimeout(r, segundos * 1000));
    parar = true;
    await Promise.all(clientes);
  }
  st.ms = Date.now() - t0;
  st.lat.sort((a, b) => a - b);
  agent.destroy();
  return st;
}

/* --------------------------------- health --------------------------------- */

async function lerHealth() {
  try {
    const res = await fetch(BASE + "/health", { signal: AbortSignal.timeout(20000) });
    const t = await res.text();
    const g = (re) => {
      const m = t.match(re);
      return m ? m[1] : "?";
    };
    return {
      rss: g(/rss: (\d+) MB/),
      cache: g(/cache: (\d+) entradas/),
      reqRecusadas: g(/requisicoes:[^|]*?recusadas (\d+)/),
      dlRecusados: g(/downloads:[^|]*?recusados (\d+)/),
      conexoes: g(/conexoes: (\d+)/),
      bruto: t,
    };
  } catch (e) {
    return { rss: "?", cache: "?", reqRecusadas: "?", dlRecusados: "?", bruto: "erro health: " + e.message };
  }
}

/* -------------------------------- relatório ------------------------------- */

const pctDe = (lat, p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] : 0);

function imprimirDegrau(st, h) {
  const seg = st.ms / 1000;
  const okPct = st.req ? ((100 * st.ok) / st.req).toFixed(1) : "0.0";
  console.log(`\n=== degrau conc=${st.conc} | decorrido ${seg.toFixed(1)}s ===`);
  console.log(
    `enviados: ${st.req} | ok: ${st.ok} (${okPct}%) | req/s: ${(st.req / seg).toFixed(1)} | uteis/s: ${(
      st.ok / seg
    ).toFixed(1)}`
  );
  console.log(
    `lat ms: p50 ${pctDe(st.lat, 50).toFixed(0)} | p95 ${pctDe(st.lat, 95).toFixed(0)} | p99 ${pctDe(
      st.lat,
      99
    ).toFixed(0)} | max ${(st.lat[st.lat.length - 1] || 0).toFixed(0)}`
  );
  if (st.paginasTotal) {
    console.log(`paginas lidas: ${st.paginasOK}/${st.paginasTotal} OK em ${st.chamadas} chamada(s)`);
  }
  if (st.status.size) {
    console.log(`HTTP: ${[...st.status.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  if (st.erros.size) {
    console.log(`erros: ${[...st.erros.entries()].map(([k, v]) => `${k}=${v}`).join(" | ")}`);
  }
  console.log(
    `health: rss ${h.rss}MB | cache ${h.cache} | req recusadas ${h.reqRecusadas} | downloads recusados ${h.dlRecusados} | conexoes ${h.conexoes}`
  );
}

/* ---------------------------------- main ---------------------------------- */

(async () => {
  console.log(`alvo:    ${BASE}`);
  console.log(
    `modo:    ${MODO} | escada: ${ESCADA.join(",")} | segundos/degrau: ${SEGUNDOS} | pipeline: ${PIPELINE} | tool-timeout: ${TIMEOUT_FERR}ms`
  );

  const h0 = await lerHealth();
  console.log(`health inicial: ${h0.bruto.slice(0, 140)}...`);

  if (AQUECER > 0 && MODO !== "multi") {
    process.stdout.write(`aquecendo (${AQUECER}s, conc 2)... `);
    await executarDegrau(2, AQUECER);
    console.log("ok");
  }

  const resultados = [];
  for (const conc of ESCADA) {
    const hAntes = await lerHealth();
    const st = await executarDegrau(conc);
    const hDepois = await lerHealth();
    imprimirDegrau(st, hDepois);
    resultados.push({
      conc,
      enviados: st.req,
      ok: st.ok,
      reqPorSeg: Number((st.req / (st.ms / 1000)).toFixed(2)),
      uteisPorSeg: Number((st.ok / (st.ms / 1000)).toFixed(2)),
      latP50: Number(pctDe(st.lat, 50).toFixed(0)),
      latP95: Number(pctDe(st.lat, 95).toFixed(0)),
      latP99: Number(pctDe(st.lat, 99).toFixed(0)),
      latMax: Number((st.lat[st.lat.length - 1] || 0).toFixed(0)),
      http: Object.fromEntries(st.status),
      erros: Object.fromEntries(st.erros),
      paginasOK: st.paginasOK,
      paginasTotal: st.paginasTotal,
      chamadas: st.chamadas,
      healthAntes: { rss: hAntes.rss, cache: hAntes.cache },
      healthDepois: {
        rss: hDepois.rss,
        cache: hDepois.cache,
        reqRecusadas: hDepois.reqRecusadas,
        dlRecusados: hDepois.dlRecusados,
      },
    });
    // pausa curta para o servidor respirar entre degraus
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (JSON_OUT) {
    fs.writeFileSync(
      JSON_OUT,
      JSON.stringify({ base: BASE, modo: MODO, quando: new Date().toISOString(), resultados }, null, 2)
    );
    console.log(`\njson salvo em ${JSON_OUT}`);
  }
})().catch((e) => {
  console.error("erro inesperado:", e);
  process.exit(1);
});
