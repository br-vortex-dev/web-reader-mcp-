/**
 * Transporte MCP: stdio (local) e HTTP Streamable (Render).
 * Inclui autenticação por token, rate limiting e endpoint /health.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import http from "node:http";
import {
  SERVER_NAME,
  SERVER_VERSION,
  PROTOCOL_VERSIONS,
  HTTP_REQUEST_TIMEOUT_MS,
  HTTP_HEADERS_TIMEOUT_MS,
  HTTP_KEEPALIVE_TIMEOUT_MS,
  MAX_CONNECTIONS,
  MAX_INFLIGHT_REQUESTS,
  MAX_WAITING_REQUESTS,
  MAX_WAIT_MS,
  OUTBOUND_MAX_CONCURRENCY,
  OUTBOUND_MAX_QUEUE,
  clampEnv,
} from "./config.mjs";
import { admissaoHttp, limiteSaida, orcamentoSaida, cacheStats } from "./fetch.mjs";
import { CorpoMuitoGrandeError } from "./errors.mjs";
import { callTool } from "./tools.mjs";

// Referência global ao servidor HTTP (para encerramento por erro fatal).
let servidorHttp = null;

/**
 * Trata uma mensagem JSON-RPC do MCP.
 */
async function handleMessage(msg, send) {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
    if (msg && msg.id !== undefined) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32600, message: "Invalid Request" } });
    }
    return;
  }
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  const reply = (result) => send({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

  try {
    switch (method) {
      case "initialize": {
        const requested = params && params.protocolVersion;
        reply({
          protocolVersion: PROTOCOL_VERSIONS.has(requested) ? requested : "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions:
            "Para pesquisar: use extract_links para descobrir URLs em páginas conhecidas, " +
            "depois use read_page para ler o conteúdo. Não existe ferramenta de busca — " +
            "as URLs vêm de você.",
        });
        return;
      }
      case "ping":
        if (isRequest) reply({});
        return;
      case "tools/list":
        if (isRequest) reply({ tools: TOOLS });
        return;
      case "tools/call": {
        if (!isRequest) return;
        const name = params && params.name;
        const args = (params && params.arguments) || {};
        try {
          const text = await callTool(String(name), args);
          reply({ content: [{ type: "text", text: String(text) }] });
        } catch (err) {
          reply({
            content: [{ type: "text", text: `Erro: ${err && err.message ? err.message : String(err)}` }],
            isError: true,
          });
        }
        return;
      }
      case "resources/list":
        if (isRequest) reply({ resources: [] });
        return;
      case "prompts/list":
        if (isRequest) reply({ prompts: [] });
        return;
      case "roots/list":
        if (isRequest) reply({ roots: [] });
        return;
      case "logging/setLevel":
        if (isRequest) reply({});
        return;
      default:
        if (isRequest) fail(-32601, `Método não suportado: ${method}`);
        return;
    }
  } catch (err) {
    if (isRequest) {
      fail(-32603, `Erro interno: ${err && err.message ? err.message : String(err)}`);
    }
  }
}

// Definição das ferramentas (schema JSON).
const TOOLS = [
  {
    name: "read_page",
    description:
      "Lê uma página web (GET) e devolve o conteúdo extraído em markdown: título, meta descrição e texto principal. " +
      "Use para ler artigos, documentações, blogs, páginas de produto, etc.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa (http/https) da página a ler" },
        maxChars: {
          type: "number",
          description: "Máximo de caracteres do conteúdo retornado (padrão 8000, max 25000)",
        },
        timeoutMs: { type: "number", description: "Timeout da requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "extract_links",
    description:
      "Acessa uma página e lista seus links (texto + URL absoluta), sem duplicatas. " +
      "Use para descobrir para onde uma página aponta e escolher a próxima página a ler.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL da página" },
        limit: { type: "number", description: "Quantidade máxima de links a listar (padrão 50, max 200)" },
        timeoutMs: { type: "number", description: "Timeout da requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_multiple_pages",
    description:
      "Lê várias páginas por chamada (máx 30 URLs, em lotes paralelos) e devolve o conteúdo de cada uma, " +
      "com o status de sucesso/falha por URL.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Lista de URLs (http/https), máximo 30",
        },
        maxChars: {
          type: "number",
          description: "Máximo de caracteres por página (padrão 8000)",
        },
        timeoutMs: { type: "number", description: "Timeout por requisição em ms (padrão 8000)" },
      },
      required: ["urls"],
    },
  },
  {
    name: "discover_urls",
    description:
      "Descobre as URLs de um site: lê o sitemap.xml (e variantes, incluindo sitemap indexes) " +
      "e lista as páginas encontradas. Se não houver sitemap, devolve os links internos da home. " +
      "Use para saber o que dá para ler num site antes de chamar read_multiple_pages.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL do site (ex.: https://exemplo.com)" },
        limit: { type: "number", description: "Quantidade máxima de URLs a listar (padrão 100, max 300)" },
        timeoutMs: { type: "number", description: "Timeout por requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "crawl_site",
    description:
      "Lê um site sozinho: começa na URL, extrai os links internos e vai seguindo pelos não visitados " +
      "(BFS, lotes paralelos), devolvendo o conteúdo de cada página. " +
      "Ideal para varrer um blog, documentação ou seção de notícias sem a IA ter que pedir URL por URL. " +
      "Máximo de 30 páginas por chamada.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL inicial (página ou home do site)" },
        maxPages: { type: "number", description: "Máximo de páginas a ler (padrão 10, max 30)" },
        maxChars: { type: "number", description: "Máximo de caracteres por página (padrão 2000)" },
        timeoutMs: { type: "number", description: "Timeout por requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_dynamic_page",
    description:
      "Lê páginas que dependem de JavaScript para renderizar (React, Vue, Angular, Next.js, etc.) " +
      "sem precisar de Playwright. Detecta se a página é dinâmica e extrai dados embutidos no HTML " +
      "(__NEXT_DATA__, __NUXT__, __INITIAL_STATE__, JSON-LD, APIs internas). " +
      "Use quando read_page retornar conteúdo vazio ou muito curto em sites modernos.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa (http/https) da página a ler" },
        maxChars: {
          type: "number",
          description: "Máximo de caracteres do conteúdo retornado (padrão 8000, max 25000)",
        },
        timeoutMs: { type: "number", description: "Timeout da requisição em ms (padrão 8000)" },
      },
      required: ["url"],
    },
  },
];

/**
 * Inicia o servidor em modo stdio (JSON-RPC newline-delimited).
 */
export function startStdio() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n"
        );
        continue;
      }
      handleMessage(msg, (message) => process.stdout.write(JSON.stringify(message) + "\n")).catch((err) => {
        console.error(`[${SERVER_NAME}] falha ao tratar mensagem:`, err);
        if (msg && msg.id !== undefined && msg.id !== null) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: {
                code: -32603,
                message: `Erro interno: ${err && err.message ? err.message : String(err)}`,
              },
            }) + "\n"
          );
        }
      });
    }
  });
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("error", () => process.exit(0));
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} no ar - modo stdio`);
}

/**
 * Inicia o servidor em modo HTTP Streamable (para o Render).
 */
export async function startHttp() {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || undefined;

  const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";

  if (!AUTH_TOKEN) {
    console.error(
      `[${SERVER_NAME}] AVISO: MCP_AUTH_TOKEN não definido — o endpoint /mcp está ABERTO para qualquer um.`
    );
  }

  const sha256 = (valor) => createHash("sha256").update(String(valor), "utf8").digest();
  const tokenConfere = (recebido) => timingSafeEqual(sha256(recebido), sha256(AUTH_TOKEN));

  // Rate limiting simples.
  const RATE_LIMIT_WINDOW_MS = clampEnv(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000, 1000, 3600000);
  const RATE_LIMIT_MAX = clampEnv(process.env.RATE_LIMIT_MAX, 60, 1, 1000000);
  const RATE_LIMIT_MAX_ENTRIES = 10000;
  const rateLimitMap = new Map();

  const TRUST_PROXY_HOPS = Math.max(0, Math.floor(Number(process.env.TRUST_PROXY_HOPS) || 0));

  const clientIpOf = (req) => {
    if (TRUST_PROXY_HOPS > 0) {
      const parts = String(req.headers["x-forwarded-for"] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const candidate = parts[parts.length - TRUST_PROXY_HOPS];
      if (candidate) {
        if (isIP(candidate)) return candidate;
        const semPorta = candidate.replace(/:\d+$/, "");
        if (isIP(semPorta)) return semPorta;
      }
    }
    return req.socket.remoteAddress || "unknown";
  };

  const rateLimitCleanup = setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    for (const [key, times] of rateLimitMap) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length === 0) rateLimitMap.delete(key);
      else rateLimitMap.set(key, kept);
    }
  }, RATE_LIMIT_WINDOW_MS);
  rateLimitCleanup.unref();

  const MAX_BODY_BYTES = Math.max(1024, Math.floor(Number(process.env.MAX_BODY_BYTES) || 1024 * 1024));

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let encerrado = false;
      req.on("data", (c) => {
        if (encerrado) return;
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          encerrado = true;
          const err = new CorpoMuitoGrandeError(MAX_BODY_BYTES);
          req.pause();
          reject(err);
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (!encerrado) resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", (err) => {
        if (!encerrado) reject(err);
      });
    });

  const server = http.createServer(async (req, res) => {
    let path;
    try {
      path = new URL(req.url || "/", "http://localhost").pathname;
    } catch {
      res.writeHead(400, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request-line invalida." } })
      );
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, GET, OPTIONS",
        "access-control-allow-headers": "content-type, mcp-session-id, last-event-id, authorization",
      });
      res.end();
      return;
    }

    if (path === "/health" || path === "/") {
      const cache = cacheStats();
      const req_ = admissaoHttp.stats;
      const out = limiteSaida.stats;
      const mem = process.memoryUsage();
      let conexoes = "?";
      if (typeof server.getConnections === "function") {
        conexoes = await new Promise((resolve) => {
          server.getConnections((err, count) => resolve(err ? -1 : count));
        });
      }
      const healthText = [
        `web-reader-mcp v${SERVER_VERSION} OK | cache: ${cache.entries} entradas, `,
        `${cache.bytes} bytes / ${cache.maxBytes} bytes `,
        `(max ${cache.maxEntries} entradas, ttl ${Math.round(cache.ttlMs / 60000)} min) | `,
        `requisicoes: ${req_.ativos} ativas, ${req_.naFila} na fila `,
        `(max ${req_.limite}/${req_.filaMax}, recusadas ${req_.recusados}) | `,
        `downloads: ${out.ativos} ativos, ${out.naFila} na fila `,
        `(max ${out.limite}/${out.filaMax}, recusados ${out.recusados}) | `,
        `memoria de download: ${Math.round(orcamentoSaida.stats.usado / 1024 / 1024)} MB de `,
        `${Math.round(orcamentoSaida.stats.orcamentoBytes / 1024 / 1024)} MB `,
        `(pico ${Math.round(orcamentoSaida.stats.picoUsado / 1024 / 1024)} MB, `,
        `${orcamentoSaida.stats.naFila} na fila, recusados ${orcamentoSaida.stats.recusados}) | `,
        `conexoes: ${conexoes} | `,
        `rss: ${Math.round(mem.rss / 1024 / 1024)} MB`,
      ].join("");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(healthText);
      return;
    }

    if (path !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }

    if (AUTH_TOKEN) {
      const authHeader = String(req.headers.authorization || "");
      const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const token = bearer || String(req.headers["x-mcp-token"] || "");
      if (!tokenConfere(token)) {
        res.writeHead(401, {
          "content-type": "application/json",
          "www-authenticate": "Bearer",
          "access-control-allow-origin": "*",
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32001, message: "Não autorizado: envie Authorization: Bearer <token>" },
          })
        );
        return;
      }
    }

    const clientIp = clientIpOf(req);
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const requests = (rateLimitMap.get(clientIp) || []).filter((t) => t > windowStart);
    if (requests.length >= RATE_LIMIT_MAX) {
      res.writeHead(429, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "retry-after": Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: "Rate limit excedido. Tente novamente em 60 segundos." },
        })
      );
      return;
    }
    requests.push(now);
    if (!rateLimitMap.has(clientIp) && rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
      const excedente = rateLimitMap.size - RATE_LIMIT_MAX_ENTRIES + 1;
      let removidas = 0;
      for (const key of rateLimitMap.keys()) {
        rateLimitMap.delete(key);
        if (++removidas >= excedente) break;
      }
    }
    rateLimitMap.set(clientIp, requests);

    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain", Allow: "POST" });
      res.end("Use POST /mcp com o JSON-RPC do MCP.");
      return;
    }

    try {
      await admissaoHttp.adquirir();
    } catch (err) {
      res.writeHead(503, {
        "content-type": "application/json",
        "retry-after": 1,
        "access-control-allow-origin": "*",
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32002, message: err.message },
        })
      );
      return;
    }

    try {
      let parsed;
      try {
        const raw = await readBody(req);
        parsed = JSON.parse(raw);
      } catch (err) {
        if (res.writableEnded || res.destroyed) return;
        if (err && err.status === 413) {
          res.writeHead(413, { "content-type": "application/json", connection: "close" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32600, message: `Corpo muito grande (máximo ${MAX_BODY_BYTES} bytes).` },
            })
          );
          return;
        }
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })
        );
        return;
      }

      const messages = Array.isArray(parsed) ? parsed : [parsed];
      const responses = [];
      for (const msg of messages) {
        await handleMessage(msg, (message) => responses.push(message));
      }

      if (responses.length === 0) {
        res.writeHead(202, { "content-type": "application/json", "access-control-allow-origin": "*" });
        res.end();
        return;
      }

      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(responses.length === 1 && !Array.isArray(parsed) ? responses[0] : responses));
    } finally {
      admissaoHttp.liberar();
    }
  });

  server.keepAliveTimeout = HTTP_KEEPALIVE_TIMEOUT_MS;
  server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
  server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  server.maxRequestsPerSocket = 0;
  if (MAX_CONNECTIONS > 0) server.maxConnections = MAX_CONNECTIONS;
  servidorHttp = server;

  server.listen(port, host, () => {
    console.error(
      `[${SERVER_NAME}] v${SERVER_VERSION} no ar - modo HTTP (Render) na porta ${port} | ` +
        `admissão: ${MAX_INFLIGHT_REQUESTS}+${MAX_WAITING_REQUESTS} (espera ${MAX_WAIT_MS} ms) | ` +
        `downloads: ${OUTBOUND_MAX_CONCURRENCY}+${OUTBOUND_MAX_QUEUE} | ` +
        `rate limit: ${RATE_LIMIT_MAX}/${Math.round(RATE_LIMIT_WINDOW_MS / 1000)}s | ` +
        `keep-alive: ${HTTP_KEEPALIVE_TIMEOUT_MS} ms`
    );
  });
  server.on("error", (err) => {
    console.error(`[${SERVER_NAME}] erro no servidor HTTP:`, err);
    process.exit(1);
  });

  let encerrando = false;
  const encerrar = (sinal) => {
    if (encerrando) return;
    encerrando = true;
    let limpando = null;
    console.error(`[${SERVER_NAME}] ${sinal} recebido — encerrando (aguardando até 5s)...`);
    const prazo = setTimeout(() => {
      clearInterval(limpando);
      console.error(`[${SERVER_NAME}] prazo de encerramento esgotado, saindo.`);
      process.exit(0);
    }, 5000);
    prazo.unref();

    if (typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections();
      limpando = setInterval(() => server.closeIdleConnections(), 100);
      limpando.unref();
    }

    server.close(() => {
      clearTimeout(prazo);
      clearInterval(limpando);
      console.error(`[${SERVER_NAME}] encerrado.`);
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => encerrar("SIGTERM"));
  process.on("SIGINT", () => encerrar("SIGINT"));
}

/**
 * Encerra o processo após erro fatal.
 */
export function encerrarPorErro(motivo) {
  console.error(`[${SERVER_NAME}] ${motivo} — encerrando o processo (código 1).`);
  const sair = () => process.exit(1);
  if (servidorHttp) {
    const prazo = setTimeout(sair, 5000);
    prazo.unref();
    try {
      servidorHttp.close(() => sair());
      if (typeof servidorHttp.closeIdleConnections === "function") servidorHttp.closeIdleConnections();
      return;
    } catch {
      // close() lançando: sem saída limpa possível, sai agora.
    }
  }
  sair();
}
