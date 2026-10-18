/**
 * Transporte HTTP Streamable (Render): rate limiter, autenticação, corpo com
 * teto, handlers e /health. Sem lógica de roteamento JSON-RPC — isso vive em
 * server.mjs.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import http from "node:http";
import {
  SERVER_NAME,
  SERVER_VERSION,
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
import { admissaoHttp, limiteSaida, limitesPorHost, orcamentoSaida, cacheStats, coalescedorDeBuscas, revalidacoes } from "./fetch.mjs";
import { conversoesMemo } from "./tools.mjs";
import { CorpoMuitoGrandeError } from "./errors.mjs";

// Referência global ao servidor HTTP (para encerramento por erro fatal).
let servidorHttp = null;

/** Referência ao handleMessage do roteador (definida por registrarHandleMessage). */
let handleMessageFn = null;

/**
 * Registra o roteador JSON-RPC que o transporte HTTP usa no POST /mcp.
 * Evita import circular: server.mjs importa o transporte e registra o roteador.
 */
export function registrarHandleMessage(fn) {
  handleMessageFn = fn;
}

/* ===================================================================== *
 * Rate limiter                                                            *
 * ===================================================================== */

/**
 * Cria um limitador por IP: janela deslizante, teto de entradas no Map e
 * limpeza periódica (com unref, para não segurar o processo).
 */
export function criarRateLimiter({ windowMs, max, maxEntries = 10000 }) {
  const map = new Map();

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, times] of map) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length === 0) map.delete(key);
      else map.set(key, kept);
    }
  }, windowMs);
  cleanup.unref();

  const registrar = (ip, now) => {
    const requests = (map.get(ip) || []).filter((t) => t > now - windowMs);
    if (requests.length >= max) return { bloqueado: true, requests };
    requests.push(now);
    if (!map.has(ip) && map.size >= maxEntries) {
      const excedente = map.size - maxEntries + 1;
      let removidas = 0;
      for (const key of map.keys()) {
        map.delete(key);
        if (++removidas >= excedente) break;
      }
    }
    map.set(ip, requests);
    return { bloqueado: false, requests };
  };

  return { registrar };
}

/* ===================================================================== *
 * Peças do transporte                                                     *
 * ===================================================================== */

/**
 * Resolve o IP do cliente. Com TRUST_PROXY_HOPS > 0, confia nas N entradas da
 * direita do x-forwarded-for; sem ele, cai para o IP do socket.
 */
export function clientIpOf(req, trustProxyHops) {
  if (trustProxyHops > 0) {
    const parts = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const candidate = parts[parts.length - trustProxyHops];
    if (candidate) {
      if (isIP(candidate)) return candidate;
      const semPorta = candidate.replace(/:\d+$/, "");
      if (isIP(semPorta)) return semPorta;
    }
  }
  return req.socket.remoteAddress || "unknown";
}

/**
 * Comparação do token em tempo constante. Ambos passam por sha256 para que o
 * tamanho não vaze o comprimento do segredo (e para aceitar token de qualquer
 * tamanho sem exceção do timingSafeEqual).
 */
export function tokenConfere(recebido, esperado) {
  const sha256 = (valor) => createHash("sha256").update(String(valor), "utf8").digest();
  return timingSafeEqual(sha256(recebido), sha256(esperado));
}

/**
 * Lê o corpo do POST com um teto em bytes. Acima do teto, devolve
 * CorpoMuitoGrandeError (status 413) e pausa a requisição.
 */
export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let encerrado = false;
    req.on("data", (c) => {
      if (encerrado) return;
      size += c.length;
      if (size > maxBytes) {
        encerrado = true;
        const err = new CorpoMuitoGrandeError(maxBytes);
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
}

/**
 * Monta o texto do /health. Formato preservado byte a byte.
 */
export async function montarTextoHealth(server) {
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
  return [
    `web-reader-mcp v${SERVER_VERSION} OK | cache: ${cache.entries} entradas, `,
    `${cache.bytes} bytes / ${cache.maxBytes} bytes `,
    `(max ${cache.maxEntries} entradas, ttl ${Math.round(cache.ttlMs / 60000)} min) | `,
    `requisicoes: ${req_.ativos} ativas, ${req_.naFila} na fila `,
    `(max ${req_.limite}/${req_.filaMax}, recusadas ${req_.recusados}) | `,
    `downloads: ${out.ativos} ativos, ${out.naFila} na fila `,
    `(max ${out.limite}/${out.filaMax}, recusados ${out.recusados}) | `,
    `por host: ${limitesPorHost.stats.chaves} host(s), ${limitesPorHost.stats.ativos} ativos, `,
    `${limitesPorHost.stats.naFila} na fila (max ${limitesPorHost.stats.limite}/${limitesPorHost.stats.filaMax}) | `,
    `memoria de download: ${Math.round(orcamentoSaida.stats.usado / 1024 / 1024)} MB de `,
    `${Math.round(orcamentoSaida.stats.orcamentoBytes / 1024 / 1024)} MB `,
    `(pico ${Math.round(orcamentoSaida.stats.picoUsado / 1024 / 1024)} MB, `,
    `${orcamentoSaida.stats.naFila} na fila, recusados ${orcamentoSaida.stats.recusados}) | `,
    `conexoes: ${conexoes} | `,
    `rss: ${Math.round(mem.rss / 1024 / 1024)} MB`,
    ` | coalescidas: ${coalescedorDeBuscas.stats.colapsadas} (em voo ${coalescedorDeBuscas.stats.emVoo})`,
    ` | revalidacoes: ${revalidacoes.tentadas} (falhas ${revalidacoes.falhas})`,
    ` | conversoes: ${conversoesMemo.realizadas} (reaproveitadas ${conversoesMemo.caronas})`,
  ].join("");
}

/* ===================================================================== *
 * Handlers                                                                *
 * ===================================================================== */

/** Handler de OPTIONS: só CORS. */
export function handlerOptions(res) {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type, mcp-session-id, last-event-id, authorization",
  });
  res.end();
}

/** Handler de /health e /. */
export async function handlerHealth(server, res) {
  const healthText = await montarTextoHealth(server);
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end(healthText);
}

/** Handler de 404. */
export function handlerNotFound(res) {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

/** Handler de 400 de request-line inválida. */
export function handlerRequestLineInvalida(res) {
  res.writeHead(400, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request-line invalida." } })
  );
}

/** Handler de autenticação (401). */
export function handlerNaoAutorizado(res) {
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
}

/** Handler de rate limit (429). */
export function handlerRateLimit(res, windowMs) {
  res.writeHead(429, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "retry-after": Math.ceil(windowMs / 1000),
  });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Rate limit excedido. Tente novamente em 60 segundos." },
    })
  );
}

/** Handler de método não permitido (405). */
export function handlerMetodoNaoPermitido(res) {
  res.writeHead(405, { "content-type": "text/plain", Allow: "POST" });
  res.end("Use POST /mcp com o JSON-RPC do MCP.");
}

/** Handler de admissão recusada (503). */
export function handlerAdmissaoRecusada(res, message) {
  res.writeHead(503, {
    "content-type": "application/json",
    "retry-after": 1,
    "access-control-allow-origin": "*",
  });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32002, message },
    })
  );
}

/** Handler de corpo grande (413). */
export function handlerCorpoMuitoGrande(res, maxBytes) {
  res.writeHead(413, { "content-type": "application/json", connection: "close" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: `Corpo muito grande (máximo ${maxBytes} bytes).` },
    })
  );
}

/** Handler de corpo que não é JSON (400 Parse error). */
export function handlerParseErro(res) {
  res.writeHead(400, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
}

/**
 * Processa o corpo já lido: parseia, despacha cada mensagem e monta a resposta.
 */
export async function processarCorpo(parsed) {
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const responses = [];
  for (const msg of messages) {
    await handleMessageFn(msg, (message) => responses.push(message));
  }
  return { responses, eraArray: Array.isArray(parsed) };
}

/**
 * Handler de POST /mcp: a sequência de validações (auth → rate limit → método →
 * admissão → corpo → dispatch).
 */
export async function handlerMcp(req, res, ctx) {
  const { authToken, rateLimiter, rateLimitWindowMs, maxBodyBytes } = ctx;

  if (authToken) {
    const authHeader = String(req.headers.authorization || "");
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const token = bearer || String(req.headers["x-mcp-token"] || "");
    if (!tokenConfere(token, authToken)) return handlerNaoAutorizado(res);
  }

  const clientIp = clientIpOf(req, ctx.trustProxyHops);
  const { bloqueado } = rateLimiter.registrar(clientIp, Date.now());
  if (bloqueado) return handlerRateLimit(res, rateLimitWindowMs);

  if (req.method !== "POST") return handlerMetodoNaoPermitido(res);

  try {
    await admissaoHttp.adquirir();
  } catch (err) {
    return handlerAdmissaoRecusada(res, err.message);
  }

  try {
    let parsed;
    try {
      const raw = await readBody(req, maxBodyBytes);
      parsed = JSON.parse(raw);
    } catch (err) {
      if (res.writableEnded || res.destroyed) return;
      if (err && err.status === 413) return handlerCorpoMuitoGrande(res, maxBodyBytes);
      return handlerParseErro(res);
    }

    const { responses, eraArray } = await processarCorpo(parsed);

    if (responses.length === 0) {
      res.writeHead(202, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end();
      return;
    }

    res.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify(responses.length === 1 && !eraArray ? responses[0] : responses));
  } finally {
    admissaoHttp.liberar();
  }
}

/**
 * Monta o contexto do /mcp (token, rate limiter, hops, teto de corpo).
 */
export function criarContextoMcp() {
  const RATE_LIMIT_WINDOW_MS = clampEnv(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000, 1000, 3600000);
  const RATE_LIMIT_MAX = clampEnv(process.env.RATE_LIMIT_MAX, 60, 1, 1000000);
  return {
    authToken: process.env.MCP_AUTH_TOKEN || "",
    rateLimiter: criarRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX }),
    rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
    trustProxyHops: Math.max(0, Math.floor(Number(process.env.TRUST_PROXY_HOPS) || 0)),
    maxBodyBytes: Math.max(1024, Math.floor(Number(process.env.MAX_BODY_BYTES) || 1024 * 1024)),
  };
}

/**
 * Cria o servidor HTTP e registra o roteamento. Não liga a porta nem os sinais
 * de shutdown — isso é de startHttp (server.mjs).
 */
export function criarServidorHttp(ctx) {
  const server = http.createServer(async (req, res) => {
    let path;
    try {
      path = new URL(req.url || "/", "http://localhost").pathname;
    } catch {
      return handlerRequestLineInvalida(res);
    }

    if (req.method === "OPTIONS") return handlerOptions(res);
    if (path === "/health" || path === "/") return handlerHealth(server, res);
    if (path !== "/mcp") return handlerNotFound(res);

    return handlerMcp(req, res, ctx);
  });

  server.keepAliveTimeout = HTTP_KEEPALIVE_TIMEOUT_MS;
  server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
  server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  server.maxRequestsPerSocket = 0;
  if (MAX_CONNECTIONS > 0) server.maxConnections = MAX_CONNECTIONS;
  servidorHttp = server;

  server.on("error", (err) => {
    console.error(`[${SERVER_NAME}] erro no servidor HTTP:`, err);
    process.exit(1);
  });

  return server;
}

/** Liga a porta e registra o shutdown limpo (SIGTERM/SIGINT). */
export function ligarServidor(server, { port, host, rateLimitWindowMs, rateLimitMax }) {
  server.listen(port, host, () => {
    console.error(
      `[${SERVER_NAME}] v${SERVER_VERSION} no ar - modo HTTP (Render) na porta ${port} | ` +
        `admissão: ${MAX_INFLIGHT_REQUESTS}+${MAX_WAITING_REQUESTS} (espera ${MAX_WAIT_MS} ms) | ` +
        `downloads: ${OUTBOUND_MAX_CONCURRENCY}+${OUTBOUND_MAX_QUEUE} | ` +
        `rate limit: ${rateLimitMax}/${Math.round(rateLimitWindowMs / 1000)}s | ` +
        `keep-alive: ${HTTP_KEEPALIVE_TIMEOUT_MS} ms`
    );
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
 * Inicia o servidor em modo HTTP Streamable (para o Render).
 *
 * Clusters: com WEB_CONCURRENCY > 1, o processo principal vira o coordenador
 * e sobe N workers, cada um com um servidor na MESMA porta (o compartilhamento
 * de porta do cluster distribui as conexões entre os processos). É o que
 * multiplica o teto de CPU — o gargalo medido é um núcleo. Sem a variável (ou
 * com 1), comportamento idêntico ao de sempre: processo único. Quando um
 * worker morre sem ser por encerramento pedido, o coordenador sobe outro:
 * um crash isolado não derruba o serviço.
 */
export async function startHttp() {
  // import("node:cluster") devolve o namespace; o objeto cluster em si vem
  // no default (é ele que tem isPrimary/fork/on). Sem o fallback, cl.on
  // estoura "is not a function" no ESM.
  const namespaceCluster = await import("node:cluster");
  const cl = namespaceCluster.default ?? namespaceCluster;
  // SEM a variável, tudo igual a hoje: processo único. O cluster é opt-in —
  // quem tem núcleos de sobra define WEB_CONCURRENCY (ex.: 4) e o serviço
  // passa a usar um worker por núcleo. Valor 0, inválido ou ausente = 1.
  const querWorkers = clampEnv(process.env.WEB_CONCURRENCY, 1, 1, 64);

  if (cl.isPrimary && querWorkers > 1) {
    console.error(
      `[${SERVER_NAME}] modo cluster: ${querWorkers} workers (WEB_CONCURRENCY=${process.env.WEB_CONCURRENCY})`
    );
    let saindo = false;
    const subir = () => cl.fork();
    for (let i = 0; i < querWorkers; i++) subir();
    cl.on("exit", () => {
      if (saindo) {
        // Encerramento pedido: quando o último worker sair, o coordenador sai.
        if (Object.keys(cl.workers).length === 0) process.exit(0);
        return;
      }
      console.error(`[${SERVER_NAME}] um worker caiu — subindo outro.`);
      subir();
    });
    for (const sinal of ["SIGTERM", "SIGINT"]) {
      process.on(sinal, () => {
        saindo = true;
        for (const id in cl.workers) {
          try {
            cl.workers[id]?.kill(sinal);
          } catch {
            // worker já saiu
          }
        }
        // Rede de segurança: se algum worker travar, o coordenador sai de
        // qualquer jeito depois do mesmo prazo do encerramento individual.
        const prazo = setTimeout(() => process.exit(0), 6000);
        prazo.unref();
      });
    }
    return;
  }

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || undefined;

  const authToken = process.env.MCP_AUTH_TOKEN || "";

  if (!authToken) {
    console.error(
      `[${SERVER_NAME}] AVISO: MCP_AUTH_TOKEN não definido — o endpoint /mcp está ABERTO para qualquer um.`
    );
  }

  const ctx = criarContextoMcp();
  const server = criarServidorHttp(ctx);
  const rateLimitMax = clampEnv(process.env.RATE_LIMIT_MAX, 60, 1, 1000000);
  ligarServidor(server, {
    port,
    host,
    rateLimitWindowMs: ctx.rateLimitWindowMs,
    rateLimitMax,
  });
}

/** Encerra o processo após erro fatal. */
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
