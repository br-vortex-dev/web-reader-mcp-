#!/usr/bin/env node
/**
 * bateria-caos.mjs — teste de INTENCAO DE QUEBRAR o web-reader-mcp.
 *
 * Nao e a suite de regressao (npm test): e o ataque. Cada caso tenta derrubar,
 * travar, vazar memoria ou fazer o servidor mentir. O veredito e sempre um:
 *   OK    — sobreviveu e respondeu de forma honesta (erro claro, sem travar)
 *   FALHA — quebrou, travou, mentiu, vazou, ou violou uma promessa
 *
 * Uso: node dev/caos/bateria-caos.mjs [--so=grupo] [--verboso]
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { criarMalicioso } from "./fixture-malicioso.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..", "..");
const SERVER = join(RAIZ, "server.js");
const TOKEN = "token-caos";

const args = process.argv.slice(2);
const SO = (args.find((a) => a.startsWith("--so=")) || "").split("=")[1] || "";
const VERBOSO = args.includes("--verboso");

/* ---------------------------- placar ---------------------------- */
const resultados = [];
let grupoAtual = "";

function registrar(nome, ok, detalhe) {
  resultados.push({ grupo: grupoAtual, nome, ok, detalhe: String(detalhe ?? "").slice(0, 300) });
  if (!VERBOSO) {
    const marca = ok ? "\x1b[32mOK   \x1b[0m" : "\x1b[31mFALHA\x1b[0m";
    console.log(`  ${marca} ${nome}${detalhe ? " — " + String(detalhe).slice(0, 160) : ""}`);
  }
}
function grupo(nome) {
  grupoAtual = nome;
  if (!SO || nome.toLowerCase().includes(SO.toLowerCase())) console.log(`\n### ${nome}`);
  return !SO || nome.toLowerCase().includes(SO.toLowerCase());
}

/* --------------------------- infraestrutura --------------------------- */
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function subirMcp(envExtra = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["--expose-gc", SERVER, "--http"], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(port),
      MCP_AUTH_TOKEN: TOKEN,
      ALLOW_PRIVATE_HOSTS: "1",
      TRUST_PROXY_HOPS: "0",
      RATE_LIMIT_MAX: "1000000",
      ...envExtra,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${base}/health`)).ok) {
        return { base, child, port, stderr: () => stderr, close: () => child.kill() };
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("MCP nao subiu:\n" + stderr);
}

// Chamada JSON-RPC com timeout de verdade: se o servidor pendurar, o caso
// falha por tempo, nao trava a bateria.
async function rpc(mcp, body, { timeoutMs = 20000, headers = {} } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${mcp.base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const texto = await res.text();
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {}
    return { status: res.status, texto, json, ms: Date.now() - t0, erro: null };
  } catch (e) {
    return { status: 0, texto: "", json: null, ms: Date.now() - t0, erro: e.name === "TimeoutError" ? "timeout" : e.message };
  }
}

const chamar = (mcp, name, cargs, opts) =>
  rpc(mcp, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: cargs } }, opts);

const textDe = (r) => (r.json?.result?.content?.[0]?.text ?? r.texto ?? "").toString();
const isErro = (r) => Boolean(r.json?.result?.isError);

async function health(mcp) {
  try {
    const r = await fetch(`${mcp.base}/health`, { signal: AbortSignal.timeout(5000) });
    return { ok: r.ok, texto: await r.text() };
  } catch (e) {
    return { ok: false, texto: e.message };
  }
}

async function vivo(mcp) {
  if (mcp.child.exitCode !== null) return { vivo: false, motivo: `processo saiu com codigo ${mcp.child.exitCode}` };
  const h = await health(mcp);
  if (!h.ok) return { vivo: false, motivo: "health nao respondeu" };
  // confirma que ainda atende de verdade
  const r = await rpc(mcp, { jsonrpc: "2.0", id: 9, method: "tools/list" }, { timeoutMs: 8000 });
  return { vivo: r.status === 200 && Boolean(r.json?.result?.tools), motivo: `tools/list status ${r.status} em ${r.ms}ms` };
}

const mem = (texto) => {
  const m = /rss=(\d+)|memoria:\s*([\d.]+)\s*MB/i.exec(texto);
  return m ? m[0] : "";
};

/* ------------------------------- grupos ------------------------------- */

// A. Abuso de protocolo HTTP/JSON-RPC
async function grupoProtocolo(mcp, alvo) {
  if (!grupo("A. Protocolo e JSON-RPC")) return;

  let r = await rpc(mcp, '{"jsonrpc":', {});
  registrar("JSON truncado devolve Parse error, nao crash", r.status === 400 || r.json?.error, `status ${r.status}`);

  r = await rpc(mcp, "", {});
  registrar("corpo vazio devolve Parse error", r.status === 400, `status ${r.status}`);

  r = await rpc(mcp, "null", {});
  registrar("corpo null nao derruba", r.status === 400 || r.status === 200, `status ${r.status}`);

  r = await rpc(mcp, "[]", {});
  registrar("batch vazio responde (nao explode)", r.status >= 200 && r.status < 500, `status ${r.status}`);

  // 5 MB de JSON: acima do teto do corpo deve dar 413.
  const gigante = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { lixo: "a".repeat(6 * 1024 * 1024) } });
  r = await rpc(mcp, gigante, { timeoutMs: 30000 });
  registrar("corpo de 6 MB e recusado sem derrubar", r.status === 413 || r.status === 400, `status ${r.status} em ${r.ms}ms`);

  // JSON-RPC fora da spec
  const foraDaSpec = [
    ["versao inexistente", { jsonrpc: "9.9", id: 1, method: "tools/list" }],
    ["id objeto", { jsonrpc: "2.0", id: { a: 1 }, method: "tools/list" }],
    ["id array", { jsonrpc: "2.0", id: [1, 2], method: "tools/list" }],
    ["method numero", { jsonrpc: "2.0", id: 1, method: 123 }],
    ["method nulo", { jsonrpc: "2.0", id: 1, method: null }],
    ["params string", { jsonrpc: "2.0", id: 1, method: "tools/call", params: "texto" }],
    ["arguments array", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_page", arguments: [] } }],
    ["name vazio", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "", arguments: {} } }],
    ["initialize sem params", { jsonrpc: "2.0", id: 1, method: "initialize" }],
    ["tools/call sem params", { jsonrpc: "2.0", id: 1, method: "tools/call" }],
  ];
  for (const [nome, corpo] of foraDaSpec) {
    const res = await rpc(mcp, corpo, { timeoutMs: 10000 });
    registrar(`JSON-RPC invalido (${nome}) responde sem crash`, res.status === 200 || res.status === 400, `status ${res.status} em ${res.ms}ms`);
  }

  // batch gigante: 2000 chamadas
  const lote = Array.from({ length: 2000 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "tools/list" }));
  r = await rpc(mcp, lote, { timeoutMs: 40000 });
  registrar("batch de 2000 chamadas atendido", r.status === 200 || r.status === 413, `status ${r.status} em ${r.ms}ms`);

  // metodos HTTP errados
  for (const metodo of ["PUT", "DELETE", "PATCH", "TRACE"]) {
    const res = await fetch(`${mcp.base}/mcp`, {
      method: metodo,
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: metodo === "DELETE" ? undefined : "{}",
      signal: AbortSignal.timeout(8000),
    }).catch((e) => ({ status: e.name }));
    registrar(`${metodo} no /mcp e recusado`, res.status === 405 || res.status === 400, `status ${res.status}`);
  }

  // headers hostis
  r = await rpc(mcp, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { headers: { "x-forwarded-for": "a".repeat(20000) } });
  registrar("x-forwarded-for de 20 KB nao derruba", r.status < 500, `status ${r.status}`);

  r = await rpc(mcp, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { headers: { authorization: "Bearer " + "a".repeat(50000) } });
  registrar("token de 50 KB devolve 401 sem crash", r.status === 401, `status ${r.status}`);

  // URL estranhas
  const res404 = await fetch(`${mcp.base}/nao-existe-${"x".repeat(100)}`, { signal: AbortSignal.timeout(5000) }).catch(() => ({ status: 0 }));
  registrar("path inexistente devolve 404", res404.status === 404, `status ${res404.status}`);

  const v = await vivo(mcp);
  registrar("servidor continua vivo depois de todo o abuso de protocolo", v.vivo, v.motivo);
}

// B. SSRF e vestindo a pele de outro
async function grupoSsrf(mcp) {
  if (!grupo("B. SSRF e alvos proibidos")) return;

  const proibidos = [
    ["metadata do cloud", "http://169.254.169.254/latest/meta-data/"],
    ["localhost", "http://127.0.0.1:1/"],
    ["IPv6 loopback", "http://[::1]:1/"],
    ["rede privada 10.x", "http://10.0.0.1/"],
    ["rede privada 192.168.x", "http://192.168.1.1/"],
    ["172.16.x", "http://172.16.0.1/"],
    ["decimal disfarcado", "http://2130706433/"],
    ["hex disfarcado", "http://0x7f000001/"],
    ["octal disfarcado", "http://017700000001/"],
    ["localhost com ponto", "http://localhost./"],
    ["subdominio de localhost", "http://localtest.me/"],
    ["file://", "file:///C:/Windows/win.ini"],
    ["gopher://", "gopher://127.0.0.1:6379/_INFO"],
    ["dict://", "dict://127.0.0.1:11211/stat"],
    ["ftp://", "ftp://127.0.0.1/"],
    ["data:", "data:text/html,<h1>x</h1>"],
    ["javascript:", "javascript:alert(1)"],
    ["sem esquema", "127.0.0.1"],
    ["credencial na URL", "http://user:pass@127.0.0.1/"],
    ["0.0.0.0", "http://0.0.0.0/"],
    ["IPv4 mapeado em IPv6", "http://[::ffff:127.0.0.1]/"],
  ];

  for (const [nome, url] of proibidos) {
    const r = await chamar(mcp, "read_page", { url, maxChars: 500 }, { timeoutMs: 15000 });
    const t = textDe(r);
    const alcancou = /SEGREDO|root:|\[boot loader\]|redis_version/i.test(t);
    const recusou = isErro(r) || /bloquead|nao permitid|inv[aá]lid|proibid|n[aã]o suportad/i.test(t);
    registrar(`SSRF (${nome}) bloqueado`, recusou && !alcancou, `isError=${isErro(r)} ${t.slice(0, 90).replace(/\s+/g, " ")}`);
  }

  // Usar o codigo como proxy: redirect que aponta para dentro.
  const r = await chamar(mcp, "read_page", { url: `${alvo}/redirect-interno`, maxChars: 1000 }, { timeoutMs: 20000 });
  const t = textDe(r);
  registrar("redirect para host interno nao entrega o alvo", !/SEGREDO-INTERNO-ALCANCADO/.test(t), t.includes("SEGREDO") ? "VAZOU: " + t.slice(0, 100) : "bloqueado ou erro");

  const r2 = await chamar(mcp, "read_page", { url: `${alvo}/redirect-file`, maxChars: 1000 }, { timeoutMs: 20000 });
  registrar("redirect para file:// nao le o disco", !/\[boot loader\]|for 16-bit app support/i.test(textDe(r2)), "sem vazamento");

  // Todas as ferramentas tem de aplicar a mesma guarda (nao so read_page).
  const ferramentas = ["extract_links", "read_multiple_pages", "read_feed", "read_json", "read_pdf", "read_dynamic_page", "find_on_page", "discover_urls", "crawl_site", "diff_page"];
  const alvoRuim = "http://127.0.0.1:1/";
  let furadas = [];
  for (const f of ferramentas) {
    const cargs = f === "read_multiple_pages" ? { urls: [alvoRuim] } : f === "find_on_page" ? { url: alvoRuim, query: "x" } : { url: alvoRuim };
    const rr = await chamar(mcp, f, cargs, { timeoutMs: 20000 });
    const tt = textDe(rr);
    if (!isErro(rr) && !/bloquead|nao permitid|inv[aá]lid|proibid|n[aã]o suportad|conex[aã]o|ECONNREFUSED/i.test(tt)) furadas.push(f);
  }
  registrar("guarda de SSRF vale em TODAS as ferramentas", furadas.length === 0, furadas.length ? "furadas: " + furadas.join(", ") : "nenhuma furo");

  const v = await vivo(mcp);
  registrar("servidor vivo depois de todo o SSRF", v.vivo, v.motivo);
}

// C. Venenos servidos pelo "site malicioso"
async function grupoVenenos(mcp, alvo) {
  if (!grupo("C. Venenos de conteudo (bomba, lixo, lento)")) return;

  const casos = [
    // [nome, rota, ferramenta, args, limite de tempo ms, checagem]
    ["bomba gzip (200 MB -> KB)", "/bomba-gzip", "read_page", { maxChars: 4000 }, 30000],
    ["bomba brotli (150 MB)", "/bomba-brotli", "read_page", { maxChars: 4000 }, 30000],
    ["content-length mentiroso", "/content-length-mente", "read_page", { maxChars: 4000 }, 30000],
    ["HTML gigante 25 MB", "/html-gigante", "read_page", { maxChars: 4000 }, 45000],
    ["aninhamento de 200 mil divs", "/aninhamento", "read_page", { maxChars: 4000 }, 45000],
    ["cercas de codigo abertas", "/cerca-aberta", "read_page", { maxChars: 4000 }, 30000],
    ["tabela de 2000x200", "/tabela-monstro", "read_page", { maxChars: 4000 }, 45000],
    ["billion laughs (XML)", "/billion-laughs", "read_feed", {}, 30000],
    ["JSON com 100 mil niveis", "/json-profundo", "read_json", {}, 30000],
    ["JSON de 300 mil itens", "/json-doente", "read_json", {}, 40000],
    ["UTF-8 invalido", "/utf8-quebrado", "read_page", { maxChars: 2000 }, 20000],
    ["NUL e controles no corpo", "/nul", "read_page", { maxChars: 2000 }, 20000],
    ["sem content-type", "/sem-content-type", "read_page", { maxChars: 1000 }, 20000],
    ["binario disfarcado de HTML", "/binario-como-html", "read_page", { maxChars: 1000 }, 20000],
    ["HTML disfarcado de PDF", "/html-como-pdf", "read_pdf", { maxChars: 1000 }, 20000],
    ["headers monstro (5 mil)", "/headers-monstro", "read_page", { maxChars: 1000 }, 20000],
    ["10 mil links (extract)", "/muitos-links", "extract_links", {}, 30000],
    ["sitemap com 50 mil URLs", "/sitemap.xml", "discover_urls", {}, 40000],
    ["robots.txt de 1 MB", "/robots.txt", "read_page", { maxChars: 1000 }, 25000],
  ];

  for (const [nome, rota, ferramenta, cargs, limite] of casos) {
    const r = await chamar(mcp, ferramenta, { url: `${alvo}${rota}`, ...cargs }, { timeoutMs: limite });
    const travou = r.erro === "timeout";
    const explodiu = r.status >= 500 && r.status !== 0;
    const v = await vivo(mcp);
    const ok = !travou && !explodiu && v.vivo;
    registrar(
      `${nome} (${ferramenta})`,
      ok,
      travou ? `TRAVOU >${limite}ms` : explodiu ? `HTTP ${r.status}` : !v.vivo ? "SERVIDOR MORREU: " + v.motivo : `${r.ms}ms, isError=${isErro(r)}, saida ${textDe(r).length} chars`
    );
  }

  // Penduradas: tem de desistir no timeout, nao esperar 60 s.
  for (const [nome, rota] of [
    ["servidor lento (60 s)", "/lento"],
    ["resposta que nunca termina", "/nunca-termina"],
    ["pinga 1 byte/s para sempre", "/pinga"],
    ["redirect infinito", "/redirect-infinito"],
    ["429 eterno com Retry-After 1 dia", "/retry-infinito"],
  ]) {
    const t0 = Date.now();
    const r = await chamar(mcp, "read_page", { url: `${alvo}${rota}`, maxChars: 1000, timeoutMs: 3000 }, { timeoutMs: 25000 });
    const ms = Date.now() - t0;
    const v = await vivo(mcp);
    const ok = ms < 22000 && v.vivo && (isErro(r) || r.status === 0 || r.ms < 22000);
    registrar(`${nome} desiste no prazo`, ok, `${ms}ms, isError=${isErro(r)}, vivo=${v.vivo}`);
  }
}

// D. Argumentos absurdos em cada ferramenta
async function grupoArgumentos(mcp, alvo) {
  if (!grupo("D. Argumentos hostis")) return;

  const url = `${alvo}/ok`;
  const absurdos = [
    ["maxChars negativo", { url, maxChars: -999999 }],
    ["maxChars 1e12", { url, maxChars: 1e12 }],
    ["maxChars NaN", { url, maxChars: "abc" }],
    ["maxChars Infinity", { url, maxChars: 1e308 }],
    ["timeout 0", { url, timeoutMs: 0 }],
    ["timeout negativo", { url, timeoutMs: -1 }],
    ["timeout 1e9", { url, timeoutMs: 1e9 }],
    ["url numero", { url: 12345 }],
    ["url objeto", { url: { a: 1 } }],
    ["url array", { url: ["a", "b"] }],
    ["url null", { url: null }],
    ["url vazia", { url: "" }],
    ["url so espacos", { url: "   " }],
    ["url de 100 KB", { url: "https://example.com/" + "a".repeat(100000) }],
    ["url com NUL dentro", { url: "https://example.com/\u0000" }],
    ["url com CRLF (injecao de header)", { url: "https://example.com/\r\nX-Injetado: 1" }],
    ["url com newline no host", { url: "https://exa\nmple.com/" }],
  ];

  for (const [nome, cargs] of absurdos) {
    const r = await chamar(mcp, "read_page", cargs, { timeoutMs: 25000 });
    const v = await vivo(mcp);
    const ok = v.vivo && r.status !== 0 && r.status < 500;
    registrar(`read_page com ${nome}`, ok, `status ${r.status}, isError=${isErro(r)}, ${r.ms}ms`);
  }

  // read_multiple_pages: lista monstro
  const lista = await chamar(mcp, "read_multiple_pages", { urls: Array.from({ length: 5000 }, (_, i) => `${alvo}/p/${i}`), maxChars: 100 }, { timeoutMs: 90000 });
  const v1 = await vivo(mcp);
  registrar("read_multiple_pages com 5000 URLs nao trava nem derruba", v1.vivo && lista.status === 200, `${lista.ms}ms, status ${lista.status}, vivo=${v1.vivo}`);

  const listaVazia = await chamar(mcp, "read_multiple_pages", { urls: [] }, { timeoutMs: 15000 });
  registrar("read_multiple_pages com lista vazia responde claro", listaVazia.status === 200, `isError=${isErro(listaVazia)} ${textDe(listaVazia).slice(0, 80)}`);

  const listaNaoLista = await chamar(mcp, "read_multiple_pages", { urls: "nao e lista" }, { timeoutMs: 15000 });
  registrar("read_multiple_pages com urls string nao derruba", listaNaoLista.status === 200, `isError=${isErro(listaNaoLista)}`);

  // crawl_site: profundidade absurda
  const crawl = await chamar(mcp, "crawl_site", { url: `${alvo}/muitos-links`, maxPages: 100000, maxDepth: 100000, maxChars: 50 }, { timeoutMs: 90000 });
  const v2 = await vivo(mcp);
  registrar("crawl_site com maxPages 100 mil respeita teto", v2.vivo && crawl.status === 200, `${crawl.ms}ms, ${textDe(crawl).length} chars, vivo=${v2.vivo}`);

  // find_on_page: regex catastrófica
  const redos = "(a+)+$";
  const alvoRedos = `${alvo}/cerca-aberta`;
  const r = await chamar(mcp, "find_on_page", { url: alvoRedos, query: redos, regex: true, maxHits: 100 }, { timeoutMs: 30000 });
  const v3 = await vivo(mcp);
  registrar("ReDoS (a+)+$ nao congela o servidor", v3.vivo && r.erro !== "timeout", `${r.ms}ms, vivo=${v3.vivo}`);

  const rNested = await chamar(mcp, "find_on_page", { url: alvoRedos, query: "((((((((((a))))))))))*", regex: true }, { timeoutMs: 30000 });
  const v4 = await vivo(mcp);
  registrar("regex profundamente aninhada nao congela", v4.vivo && rNested.erro !== "timeout", `${rNested.ms}ms, vivo=${v4.vivo}`);

  const rInvalida = await chamar(mcp, "find_on_page", { url, query: "[", regex: true }, { timeoutMs: 15000 });
  registrar("regex invalida devolve erro claro", isErro(rInvalida) || /inv[aá]lid/i.test(textDe(rInvalida)), textDe(rInvalida).slice(0, 80));

  const v = await vivo(mcp);
  registrar("servidor vivo depois dos argumentos absurdos", v.vivo, v.motivo);
}

// E. Inundação e recursos
async function grupoInundacao(mcp, alvo) {
  if (!grupo("E. Inundacao e memoria")) return;

  const antes = await health(mcp);

  // 800 rajadas simultâneas na mesma URL (deve coalescer)
  const mesmaUrl = `${alvo}/ok`;
  const t0 = Date.now();
  const rajada = await Promise.allSettled(
    Array.from({ length: 800 }, () => chamar(mcp, "read_page", { url: mesmaUrl, maxChars: 500 }, { timeoutMs: 30000 }))
  );
  const ms = Date.now() - t0;
  const okN = rajada.filter((x) => x.status === "fulfilled" && x.value.status === 200).length;
  const v1 = await vivo(mcp);
  registrar("800 requisicoes simultaneas na mesma URL", okN > 0 && v1.vivo, `${okN}/800 ok em ${ms}ms, vivo=${v1.vivo}`);

  // 300 URLs distintas ao mesmo tempo (sem cache, pressao real)
  const t1 = Date.now();
  const distintas = await Promise.allSettled(
    Array.from({ length: 300 }, (_, i) => chamar(mcp, "read_page", { url: `${alvo}/p/raja-${i}?x=${i}`, maxChars: 300 }, { timeoutMs: 40000 }))
  );
  const ms1 = Date.now() - t1;
  const ok1 = distintas.filter((x) => x.status === "fulfilled" && x.value.status === 200).length;
  const v2 = await vivo(mcp);
  registrar("300 URLs distintas em paralelo", ok1 > 0 && v2.vivo, `${ok1}/300 ok em ${ms1}ms, vivo=${v2.vivo}`);

  // 20 páginas gigantes em paralelo (pressão de memória)
  const t2 = Date.now();
  await Promise.allSettled(
    Array.from({ length: 20 }, () => chamar(mcp, "read_page", { url: `${alvo}/html-gigante`, maxChars: 2000 }, { timeoutMs: 90000 }))
  );
  const ms2 = Date.now() - t2;
  const v3 = await vivo(mcp);
  const h3 = await health(mcp);
  registrar("20 paginas de 25 MB em paralelo nao estouram a memoria", v3.vivo, `${ms2}ms, vivo=${v3.vivo}, health: ${h3.texto.slice(0, 120)}`);

  // 30 bombas gzip ao mesmo tempo (o pior caso de descompressão)
  const t3 = Date.now();
  await Promise.allSettled(
    Array.from({ length: 30 }, () => chamar(mcp, "read_page", { url: `${alvo}/bomba-gzip`, maxChars: 1000 }, { timeoutMs: 60000 }))
  );
  const ms3 = Date.now() - t3;
  const v4 = await vivo(mcp);
  const h4 = await health(mcp);
  registrar("30 bombas gzip simultaneas nao derrubam", v4.vivo, `${ms3}ms, vivo=${v4.vivo}, health: ${h4.texto.slice(0, 120)}`);

  // cliente que morre no meio: abre e fecha socket sem enviar corpo
  let mortos = 0;
  await Promise.all(
    Array.from({ length: 200 }, () =>
      new Promise((resolve) => {
        const req = http.request({ host: "127.0.0.1", port: mcp.port, path: "/mcp", method: "POST" });
        req.on("error", () => resolve());
        req.write("{"); // corpo pela metade
        setTimeout(() => {
          req.destroy();
          mortos++;
          resolve();
        }, 20);
      })
    )
  );
  await new Promise((r) => setTimeout(r, 1000));
  const v5 = await vivo(mcp);
  registrar("200 clientes que morrem no meio do corpo", v5.vivo, `${mortos} abortados, vivo=${v5.vivo}`);

  // /health nunca pode ser recusado nem enfileirado, mesmo sob carga
  const sobCarga = Array.from({ length: 400 }, () => chamar(mcp, "read_page", { url: `${alvo}/lento`, timeoutMs: 2000 }, { timeoutMs: 10000 }));
  const h = await health(mcp);
  await Promise.allSettled(sobCarga);
  registrar("/health responde sob carga pesada", h.ok, h.texto.slice(0, 120));

  const depois = await health(mcp);
  const v = await vivo(mcp);
  registrar("servidor vivo no fim da inundacao", v.vivo, v.motivo);
  registrar("estado final do /health e legivel", depois.ok, depois.texto.slice(0, 200));
}

// F. Fidelidade: o servidor nao pode mentir
async function grupoFidelidade(mcp, alvo) {
  if (!grupo("F. Honestidade das respostas")) return;

  // Página boa continua boa depois de todo o caos.
  const ok = await chamar(mcp, "read_page", { url: `${alvo}/ok`, maxChars: 2000 }, { timeoutMs: 15000 });
  const t = textDe(ok);
  registrar("pagina saudavel ainda e lida corretamente", !isErro(ok) && /Controle/.test(t) && /pagina saudavel/.test(t), `${t.length} chars`);

  // Erro de verdade tem de vir como erro (nao 200 mudo com texto vazio).
  const inexistente = await chamar(mcp, "read_page", { url: `${alvo}/nao-existe-de-verdade`, maxChars: 1000 }, { timeoutMs: 15000 });
  registrar("404 vira erro explicito, nao texto vazio", isErro(inexistente) && textDe(inexistente).length > 10, textDe(inexistente).slice(0, 90));

  // Truncamento declarado: se cortou, tem de avisar.
  const cortado = await chamar(mcp, "read_page", { url: `${alvo}/html-gigante`, maxChars: 500 }, { timeoutMs: 60000 });
  const tc = textDe(cortado);
  registrar("truncamento e declarado ao cliente", /truncad|truncat|exibid/i.test(tc) && tc.length < 3000, `${tc.length} chars, aviso=${/truncad/i.test(tc)}`);

  // Saida nunca passa do teto pedido (com folga do cabecalho).
  registrar("saida respeita o maxChars pedido", tc.length < 500 + 600, `${tc.length} chars para maxChars=500`);

  // HTML disfarcado de PDF tem de reclamar, nao inventar texto.
  const pdfFalso = await chamar(mcp, "read_pdf", { url: `${alvo}/html-como-pdf`, maxChars: 1000 }, { timeoutMs: 20000 });
  const tp = textDe(pdfFalso);
  registrar("PDF falso e recusado com motivo", isErro(pdfFalso) || /n[aã]o (e|é) pdf|n[aã]o parece/i.test(tp), tp.slice(0, 90));

  // JSON invalido nao pode ser entregue como se fosse valido.
  const jsonRuim = await chamar(mcp, "read_json", { url: `${alvo}/ok` }, { timeoutMs: 15000 });
  registrar("read_json em HTML explica em vez de mentir", isErro(jsonRuim) || /n[aã]o (e|é) json|html/i.test(textDe(jsonRuim)), textDe(jsonRuim).slice(0, 90));
}

/* ------------------------------- execucao ------------------------------- */
const malicioso = criarMalicioso();
const portaAlvo = await freePort();
await new Promise((r) => malicioso.server.listen(portaAlvo, "127.0.0.1", r));
const alvo = `http://127.0.0.1:${portaAlvo}`;

console.log(`alvo malicioso: ${alvo}`);
const mcp = await subirMcp();
console.log(`MCP: ${mcp.base}`);
console.log("(cada caso tenta quebrar; OK = sobreviveu e respondeu honesto)\n");

const t0 = Date.now();
try {
  await grupoProtocolo(mcp, alvo);
  await grupoSsrf(mcp);
  await grupoVenenos(mcp, alvo);
  await grupoArgumentos(mcp, alvo);
  await grupoInundacao(mcp, alvo);
  await grupoFidelidade(mcp, alvo);
} catch (e) {
  console.error("bateria abortou:", e);
} finally {
  const stderr = mcp.stderr();
  const v = await vivo(mcp).catch(() => ({ vivo: false, motivo: "sem resposta" }));
  mcp.close();
  malicioso.server.close();
  await new Promise((r) => setTimeout(r, 300));

  const total = resultados.length;
  const falhas = resultados.filter((r) => !r.ok);
  const porGrupo = new Map();
  for (const r of resultados) {
    const g = porGrupo.get(r.grupo) || { ok: 0, falha: 0 };
    if (r.ok) g.ok++;
    else g.falha++;
    porGrupo.set(r.grupo, g);
  }

  console.log("\n================ PLACAR ================");
  for (const [g, c] of porGrupo) console.log(`${g}: ${c.ok} ok, ${c.falha} falha(s)`);
  console.log(`\ntotal: ${total} casos | ok: ${total - falhas.length} | FALHAS: ${falhas.length}`);
  console.log(`duracao: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`servidor vivo no fim: ${v.vivo} (${v.motivo})`);
  console.log(`requisicoes recebidas pelo site malicioso: ${malicioso.estado.requisicoes}`);
  if (stderr.trim()) {
    const linhas = stderr.trim().split("\n");
    const suspeitas = linhas.filter((l) => /exce[cç][aã]o|rejei[cç][aã]o|uncaught|unhandled|ENOMEM|FATAL|heap out of memory/i.test(l));
    console.log(`\nstderr do servidor: ${linhas.length} linhas (${suspeitas.length} suspeitas)`);
    for (const l of suspeitas.slice(0, 15)) console.log("  ! " + l.slice(0, 200));
  } else {
    console.log("\nstderr do servidor: vazio (nenhum erro registrado)");
  }

  if (falhas.length) {
    console.log("\n---------------- FALHAS ----------------");
    for (const f of falhas) console.log(`[${f.grupo}] ${f.nome}\n    ${f.detalhe}`);
  }
  process.exit(falhas.length > 0 ? 1 : 0);
}
