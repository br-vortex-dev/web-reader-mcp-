#!/usr/bin/env node
/**
 * Teste de ponta a ponta do web-reader-mcp.
 * Cliente MCP minimo feito a mao: fala JSON-RPC newline-delimited direto no stdio do server.js.
 *
 * Uso: node scripts/smoke-test.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));
const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "inherit"] });

let buffer = "";
let nextId = 1;
const pending = new Map();
const failures = [];

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  }
});

child.on("exit", () => {
  for (const { reject } of pending.values()) {
    reject(new Error("servidor encerrou antes de responder"));
  }
  pending.clear();
});

function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout aguardando resposta de ${method}`));
    }, 45000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function check(condition, label) {
  if (condition) {
    console.log(`  OK  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FALHOU  ${label}`);
  }
}

function show(title, text, max = 700) {
  console.log(`\n----- ${title} -----`);
  console.log(text.length > max ? text.slice(0, max) + `\n... [${text.length} caracteres no total]` : text);
}

async function main() {
  console.log("Inicializando servidor MCP...");
  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.1" },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const list = await rpc("tools/list");
  const names = (list.tools || []).map((t) => t.name);
  console.log("Ferramentas:", names.join(", "));
  check(names.length === 13, "tools/list retornou as 13 ferramentas");

  const p1 = await rpc("tools/call", {
    name: "read_page",
    arguments: { url: "https://example.com", maxChars: 500 },
  });
  const t1 = (p1.content || []).map((c) => c.text).join("\n");
  check(!p1.isError && t1.includes("Example"), "read_page leu example.com");
  show("read_page(example.com)", t1);

  const p2 = await rpc("tools/call", {
    name: "read_page",
    arguments: { url: "https://pt.wikipedia.org/wiki/Node.js", maxChars: 900 },
  });
  const t2 = (p2.content || []).map((c) => c.text).join("\n");
  check(!p2.isError && t2.length > 300 && /Node\.js/.test(t2), "read_page leu pagina complexa (Wikipedia)");
  show("read_page(pt.wikipedia.org/wiki/Node.js)", t2);

  const l1 = await rpc("tools/call", {
    name: "extract_links",
    arguments: { url: "https://pt.wikipedia.org/wiki/Node.js", limit: 8 },
  });
  const tl1 = (l1.content || []).map((c) => c.text).join("\n");
  check(!l1.isError && tl1.includes("/wiki/"), "extract_links encontrou links na Wikipedia");
  show("extract_links(pt.wikipedia.org/wiki/Node.js)", tl1, 500);

  const m1 = await rpc("tools/call", {
    name: "read_multiple_pages",
    arguments: { urls: ["https://example.com", "https://example.org"], maxChars: 300 },
  });
  const tm1 = (m1.content || []).map((c) => c.text).join("\n");
  check(!m1.isError && /[0-9]\/2 paginas OK/.test(tm1), "read_multiple_pages leu as 2 paginas");
  show("read_multiple_pages(2 URLs)", tm1, 500);

  // --- 30 URLs por chamada (limite ampliado, lotes paralelos) ---
  // O pool tem 30 URLs DISTINTAS de propósito: repetir a mesma URL 5x contorna
  // a deduplicacao (o servidor le uma so), e o teste parava de medir a leitura
  // real das 30 paginas. A unica URL ruim fica no pool pequeno, la embaixo.
  const many = Array.from(
    { length: 30 },
    (_, i) => `https://example.com/?smoke=${i}`
  );
  const startedAt = Date.now();
  const m2 = await rpc("tools/call", {
    name: "read_multiple_pages",
    arguments: { urls: many, maxChars: 200 },
  });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const tm2 = (m2.content || []).map((c) => c.text).join("\n");
  check(!m2.isError, "read_multiple_pages aceita 30 URLs");
  const ok30 = Number((tm2.match(/(\d+)\/30 paginas OK/) || [])[1] || 0);
  check(ok30 >= 24, `30 URLs lidas em lotes (${ok30}/30 OK em ${elapsed}s)`);
  show("read_multiple_pages(30 URLs) — resumo", tm2.slice(0, 260), 260);

  // 31 URLs distintas (o pool de cima mais uma): acima do teto, tem de ser erro.
  const e31 = await rpc("tools/call", {
    name: "read_multiple_pages",
    arguments: { urls: [...many, "https://example.org/?smoke=31"] },
  });
  const te31 = (e31.content || []).map((c) => c.text).join("\n");
  check(Boolean(e31.isError) && /Máximo de 30/.test(te31), "rejeita 31 URLs com erro claro");

  // --- discover_urls (sitemap) ---
  const du1 = await rpc("tools/call", {
    name: "discover_urls",
    arguments: { url: "https://pt.wikipedia.org", limit: 5 },
  });
  const duText = (du1.content || []).map((c) => c.text).join("\n");
  check(!du1.isError && /sitemap|links internos/i.test(duText), "discover_urls respondeu (sitemap ou fallback)");
  show("discover_urls(pt.wikipedia.org)", duText, 400);

  // --- crawl_site (BFS real) ---
  const startedCrawl = Date.now();
  const cs1 = await rpc("tools/call", {
    name: "crawl_site",
    arguments: { url: "https://pt.wikipedia.org/wiki/Node.js", maxPages: 3, maxChars: 200 },
  });
  const crawlSeconds = ((Date.now() - startedCrawl) / 1000).toFixed(1);
  const csText = (cs1.content || []).map((c) => c.text).join("\n");
  check(!cs1.isError && /Crawl de/.test(csText), "crawl_site executou o crawl");
  show(`crawl_site(Node.js, 3 paginas, ${crawlSeconds}s)`, csText, 400);

  const e1 = await rpc("tools/call", {
    name: "read_page",
    arguments: { url: "nao-e-uma-url" },
  });
  check(Boolean(e1.isError), "read_page rejeita URL invalida com isError");

  // --- modo HTTP remoto (transporte usado no Render) ---
  const httpChild = spawn(process.execPath, [serverPath, "--http"], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, PORT: "3999", MCP_AUTH_TOKEN: "token-de-teste-123" },
  });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const health = await fetch("http://127.0.0.1:3999/health");
      if (health.ok) {
        ready = true;
        break;
      }
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  check(ready, "modo HTTP (Render) subiu e respondeu em /health");
  if (ready) {
    const semToken = await fetch("http://127.0.0.1:3999/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 90, method: "tools/list" }),
    });
    check(semToken.status === 401, "HTTP rejeita chamada sem token (401)");
    const tokenErrado = await fetch("http://127.0.0.1:3999/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer errado" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 91, method: "tools/list" }),
    });
    check(tokenErrado.status === 401, "HTTP rejeita token errado (401)");
    const post = async (body) => {
      const res = await fetch("http://127.0.0.1:3999/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token-de-teste-123",
        },
        body: JSON.stringify(body),
      });
      return res.json();
    };
    const initData = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "smoke-http", version: "0" },
      },
    });
    check(initData.result?.serverInfo?.name === "web-reader", "HTTP initialize respondeu serverInfo");
    const listData = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    check((listData.result?.tools || []).length === 13, "HTTP tools/list retornou 13 ferramentas");
    const callData = await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "read_page", arguments: { url: "https://example.com", maxChars: 300 } },
    });
    const callText = callData.result?.content?.[0]?.text || "";
    check(!callData.result?.isError && callText.includes("Example"), "HTTP read_page funcionou");
    show("HTTP read_page(example.com) via POST /mcp", callText, 300);
  }
  httpChild.kill();

  console.log("");
  if (failures.length === 0) {
    console.log("RESULTADO: todos os testes passaram.");
  } else {
    console.log(`RESULTADO: ${failures.length} falha(s):`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Erro no teste:", err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  });
