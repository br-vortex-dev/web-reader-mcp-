/**
 * http-transport.mjs — o servidor web do Render: quem recebe a requisição.
 *
 * O QUE É
 *   O transporte HTTP Streamable. Ele cuida de tudo que acontece ANTES do
 *   JSON-RPC ser interpretado, e de algumas coisas depois:
 *   - rate limit por cliente e admissão (quantas requisições ao mesmo tempo);
 *   - autenticação por token (comparação em tempo constante);
 *   - leitura do corpo com teto de bytes e descompressão;
 *   - resposta comprimida (gzip/deflate/br) e resposta JSON;
 *   - as rotas de serviço: /health, OPTIONS e o 404.
 *
 *   Ele NÃO interpreta JSON-RPC: só entrega a mensagem para o roteador em
 *   server.mjs e devolve a resposta dele. Essa separação é o que permite
 *   testar o roteamento sem subir servidor HTTP.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: uma requisição HTTP (headers, corpo).
 *   Sai:   uma resposta HTTP — JSON-RPC, ou 401/413/429/404 com o motivo.
 *
 * QUEM USA
 *   Usado por: server.mjs (que é o ponto de entrada).
 *   Importa de: config, errors, fetch, tools, video.
 */

import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import http from "node:http";
import zlib from "node:zlib";
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
  BROTLI_QUALITY,
  COMPRESSAO_CACHE_ENTRIES,
  clampEnv,
} from "./config.mjs";
import { admissaoHttp, limiteSaida, limitesPorHost, orcamentoSaida, cacheStats, coalescedorDeBuscas, revalidacoes, revalidacaoCondicional } from "./fetch.mjs";
import { conversoesMemo } from "./tools.mjs";
import { analisesVideo } from "./video.mjs";
import { CorpoMuitoGrandeError } from "./errors.mjs";

// Referência global ao servidor HTTP (para encerramento por erro fatal).
let servidorHttp = null;

// Compressão da resposta HTTP. O corpo do /mcp é grande (o texto lido de uma
// página) e saía como JSON puro: todo byte trafegava cru na volta. Comprime
// só acima do limiar (resposta pequena não paga o custo de comprimir) e só
// quando o cliente declarou aceitar — sem Accept-Encoding, a resposta continua
// byte a byte igual à de antes.
const COMPRESSAO_MIN_BYTES = 1024;

/** Escolhe a melhor codificação declarada pelo cliente (br > gzip > deflate). */
export function escolherCodificacao(acceptEncoding) {
  const aceita = String(acceptEncoding || "").toLowerCase();
  if (!aceita) return null;
  // q=0 desliga a codificação; presença simples já basta (ignoramos pesos >0).
  const tem = (nome) =>
    new RegExp(`(^|[,\\s])${nome}\\s*(;|,|$)`).test(aceita) &&
    !new RegExp(`${nome}\\s*;\\s*q\\s*=\\s*0`).test(aceita);
  if (tem("br")) return "br";
  if (tem("gzip")) return "gzip";
  if (tem("deflate")) return "deflate";
  return null;
}

// Cache da compressão: a chave é o sha256 dos bytes do corpo + a codificação.
// O caso que paga é a resposta CONSTANTE reenviada (tools/list, initialize,
// resources/list): o JSON é sempre o mesmo, então comprimir de novo é trabalho
// jogado fora. Um corpo que muda não colide — o hash muda junto. LRU simples,
// inserção em ordem de Map (o primeiro é o mais antigo).
const cacheCompressao = new Map();
let acertosCompressao = 0;
let errosCompressao = 0;

/** Estatísticas do cache de compressão (para o /health). */
export function estatisticasCompressao() {
  return { entradas: cacheCompressao.size, acertos: acertosCompressao, ausencias: errosCompressao };
}

/** Limpa o cache de compressão (testes). */
export function limparCacheCompressao() {
  cacheCompressao.clear();
  acertosCompressao = 0;
  errosCompressao = 0;
}

/** Comprime um Buffer na codificação dada (devolve o próprio Buffer se nula). */
export function comprimirCorpo(buffer, codificacao) {
  if (codificacao === "br") {
    return zlib.brotliCompressSync(buffer, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
    });
  }
  if (codificacao === "gzip") return zlib.gzipSync(buffer);
  if (codificacao === "deflate") return zlib.deflateSync(buffer);
  return buffer;
}

/**
 * Comprime com cache. Só vale a pena quando o corpo se repete; a checagem do
 * hash custa ~microssegundos em 6 KB, muito abaixo dos milissegundos que a
 * compressão custa. Sem cache (COMPRESSAO_CACHE_ENTRIES = 0), cai direto.
 */
function comprimirComCache(buffer, codificacao) {
  if (codificacao === null) return buffer;
  if (COMPRESSAO_CACHE_ENTRIES === 0) return comprimirCorpo(buffer, codificacao);
  const chave = createHash("sha256").update(buffer).digest("base64") + ":" + codificacao;
  const guardado = cacheCompressao.get(chave);
  if (guardado) {
    acertosCompressao++;
    // Move para o fim (mais recente) sem recriar o valor.
    cacheCompressao.delete(chave);
    cacheCompressao.set(chave, guardado);
    return guardado;
  }
  errosCompressao++;
  const comprimido = comprimirCorpo(buffer, codificacao);
  cacheCompressao.set(chave, comprimido);
  if (cacheCompressao.size > COMPRESSAO_CACHE_ENTRIES) {
    cacheCompressao.delete(cacheCompressao.keys().next().value);
  }
  return comprimido;
}

/** ETag forte (sha256 do corpo), para revalidação condicional. */
function etagDe(buffer) {
  return '"' + createHash("sha256").update(buffer).digest("hex").slice(0, 32) + '"';
}

/**
 * Responde JSON comprimindo quando vale a pena. Centraliza o content-type e o
 * Vary para que a resposta comprimida nunca seja servida por engano a um
 * cliente que não a aceita (cache intermediário incluso).
 */
export function responderJson(req, res, status, payload, extraHeaders = {}) {
  const corpo = Buffer.from(JSON.stringify(payload), "utf8");
  const headers = { "content-type": "application/json", vary: "accept-encoding", ...extraHeaders };

  // ETag + 304: as respostas constantes (tools/list, initialize) são as mesmas
  // a cada chamada. Com o ETag, o cliente que revalida recebe 304 e não baixa
  // corpo nenhum — economiza a volta inteira, não só a compressão. O ETag sai
  // no corpo CRU (independe da codificação escolhida).
  const etag = etagDe(corpo);
  headers.etag = etag;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }

  const codificacao =
    corpo.length >= COMPRESSAO_MIN_BYTES ? escolherCodificacao(req.headers["accept-encoding"]) : null;
  if (!codificacao) {
    res.writeHead(status, headers);
    return res.end(corpo);
  }
  headers["content-encoding"] = codificacao;
  res.writeHead(status, headers);
  res.end(comprimirComCache(corpo, codificacao));
}

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

    // O corpo pode já ter se encerrado ANTES de o handler chegar aqui: sob
    // fila de admissão, a requisição espera a vez e o cliente pode morrer
    // nesse meio tempo — e os eventos de abandono já passaram. Sem esta
    // guarda síncrona, a promessa nunca resolve e a vaga fica presa para
    // sempre (visto em produção: 128 vagas presas por >100 min).
    if (req.destroyed || req.readableEnded || req.aborted) {
      reject(new Error("conexão encerrada antes do corpo completo"));
      return;
    }

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
    // Cliente que morre no meio do corpo (abort) precisa REJEITAR: sem isto, a
    // promessa nunca se resolve e a vaga de admissão fica presa para sempre.
    // Visto em produção: atrás do proxy do Render a conexão pode ficar meio
    // aberta (sem RST), o "end" nunca chega e o handler pendura — 128 vagas
    // presas por mais de 100 minutos depois de uma rajada.
    const abortar = () => {
      if (encerrado) return;
      encerrado = true;
      reject(new Error("conexão encerrada antes do corpo completo"));
    };
    req.on("aborted", abortar);
    req.on("close", () => {
      // "close" também chega depois de um POST normal (req.complete = true);
      // só é abandono quando o corpo ainda não foi lido por inteiro.
      if (!req.complete) abortar();
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
    ` | condicional: ${revalidacaoCondicional.tentadas} (304 ${revalidacaoCondicional.naoModificadas})`,
    ` | conversoes: ${conversoesMemo.realizadas} (reaproveitadas ${conversoesMemo.caronas})`,
    ` | video: ${analisesVideo.realizadas} (reaproveitadas ${analisesVideo.caronas})`,
    ` | sessoes: ${estatisticasSessoes().sessoes} (canais ${estatisticasSessoes().canaisSse})`,
  ].join("");
}

/* ===================================================================== *
 * Handlers                                                                *
 * ===================================================================== */

/** Handler de OPTIONS: só CORS. */
export function handlerOptions(res) {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
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

/* ===================================================================== *
 * Sessões (Mcp-Session-Id) e canal SSE                                  *
 * ===================================================================== */

/**
 * Sessões do transporte HTTP.
 *
 * A spec do transporte MCP (2025-03-26 / 2025-06-18) permite que o servidor
 * emita `Mcp-Session-Id` na resposta do `initialize`; a partir daí o cliente
 * envia o header e pode abrir um canal SSE no GET e encerrar no DELETE.
 * Muitos clientes só funcionam assim — antes disso, este servidor era
 * stateless e um cliente exigente ficava sem caminho.
 *
 * Decisões de compatibilidade:
 * - EMITIR o header é aditivo: cliente que ignora continua funcionando.
 * - NÃO exigir o header nas chamadas seguintes: exigir quebraria os clientes
 *   que já funcionam hoje (e a spec permite servidor stateless). Quem manda,
 *   é reconhecido; quem não manda, é atendido como sempre.
 * - Teto de sessões e TTL: sessão é estado em memória — sem teto, um cliente
 *   que chama `initialize` em laço infla a memória.
 */
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
const MAX_SESSOES = 1000;
const sessoes = new Map(); // id -> { criadaEm, ultimoUso, sse: Set<res> }

function limparSessoes() {
  const agora = Date.now();
  for (const [id, s] of sessoes) {
    if (agora - s.ultimoUso > SESSION_TTL_MS) {
      for (const res of s.sse) {
        try {
          res.end();
        } catch {
          // já fechado
        }
      }
      sessoes.delete(id);
    }
  }
}

/** Cria (ou reusa) uma sessão e devolve o id. */
export function criarSessao() {
  limparSessoes();
  if (sessoes.size >= MAX_SESSOES) {
    // Despeja a mais antiga em uso (LRU por ultimoUso).
    let maisAntiga = null;
    let idAntigo = null;
    for (const [id, s] of sessoes) {
      if (!maisAntiga || s.ultimoUso < maisAntiga.ultimoUso) {
        maisAntiga = s;
        idAntigo = id;
      }
    }
    if (idAntigo) {
      for (const res of maisAntiga.sse) {
        try {
          res.end();
        } catch {
          // já fechado
        }
      }
      sessoes.delete(idAntigo);
    }
  }
  const id = randomUUID();
  sessoes.set(id, { criadaEm: Date.now(), ultimoUso: Date.now(), sse: new Set() });
  return id;
}

/** Marca uso da sessão (se existir) e devolve se ela é conhecida. */
export function tocarSessao(id) {
  const s = sessoes.get(id);
  if (!s) return false;
  s.ultimoUso = Date.now();
  return true;
}

/** Encerra uma sessão e fecha os canais SSE dela. */
export function encerrarSessao(id) {
  const s = sessoes.get(id);
  if (!s) return false;
  for (const res of s.sse) {
    try {
      res.end();
    } catch {
      // já fechado
    }
  }
  sessoes.delete(id);
  return true;
}

/** Estatísticas para o /health. */
export function estatisticasSessoes() {
  let canais = 0;
  for (const s of sessoes.values()) canais += s.sse.size;
  return { sessoes: sessoes.size, canaisSse: canais };
}

/** Autoriza a requisição (mesma regra do POST: Bearer ou x-mcp-token). */
function autorizado(req, authToken) {
  if (!authToken) return true;
  const authHeader = String(req.headers.authorization || "");
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const token = bearer || String(req.headers["x-mcp-token"] || "");
  return tokenConfere(token, authToken);
}

/**
 * GET /mcp — canal SSE (server→client).
 *
 * Este servidor não empurra notificação espontânea, então o canal serve para
 * o que o cliente espera dele: abrir, receber o `endpoint` e ficar vivo. O
 * keep-alive (comentário SSE) impede que proxy derrube a conexão ociosa.
 * Não passa pela admissão de propósito: um canal aberto não pode segurar
 * vaga de processamento (ficaria preso até o cliente fechar).
 */
export function handlerSse(req, res, ctx) {
  if (!autorizado(req, ctx.authToken)) return handlerNaoAutorizado(res);

  const sessionId = String(req.headers["mcp-session-id"] || "").trim();
  if (!sessionId || !tocarSessao(sessionId)) {
    res.writeHead(400, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "Sessao invalida: envie mcp-session-id de uma sessao ativa." },
      })
    );
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
    "x-accel-buffering": "no",
  });
  res.write("event: endpoint\ndata: /mcp\n\n");

  const sessao = sessoes.get(sessionId);
  sessao.sse.add(res);

  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      // conexão caiu; o close abaixo limpa
    }
  }, 25000);
  ping.unref();

  const fechar = () => {
    clearInterval(ping);
    sessao.sse.delete(res);
  };
  req.on("close", fechar);
  res.on("close", fechar);
}

/** DELETE /mcp — encerra a sessão (spec do transporte). */
export function handlerEncerrarSessao(req, res, ctx) {
  if (!autorizado(req, ctx.authToken)) return handlerNaoAutorizado(res);
  const sessionId = String(req.headers["mcp-session-id"] || "").trim();
  if (!sessionId) {
    res.writeHead(400, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Informe mcp-session-id." } }));
    return;
  }
  const existia = encerrarSessao(sessionId);
  res.writeHead(existia ? 204 : 404, { "access-control-allow-origin": "*" });
  res.end();
}

/**
 * Handler de POST /mcp: a sequência de validações (auth → rate limit → método →
 * admissão → corpo → dispatch).
 */
/**
 * Guarda 1: autenticação por token.
 * Devolve true quando a requisição FOI RECUSADA (a resposta já foi enviada).
 *
 * O token pode vir no header Authorization: Bearer, ou em x-mcp-token. A
 * comparação é em tempo constante (tokenConfere) para não vazar o conteúdo
 * do token pelo tempo de resposta.
 */
function recusarPorAuth(req, res, authToken) {
  if (!authToken) return false;
  const authHeader = String(req.headers.authorization || "");
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const token = bearer || String(req.headers["x-mcp-token"] || "");
  if (tokenConfere(token, authToken)) return false;
  handlerNaoAutorizado(res);
  return true;
}

/**
 * Guarda 2: rate limit por cliente.
 * Devolve true quando a requisição FOI RECUSADA (a resposta já foi enviada).
 */
function recusarPorRateLimit(req, res, ctx) {
  const clientIp = clientIpOf(req, ctx.trustProxyHops);
  const { bloqueado } = ctx.rateLimiter.registrar(clientIp, Date.now());
  if (!bloqueado) return false;
  handlerRateLimit(res, ctx.rateLimitWindowMs);
  return true;
}

/**
 * Guarda 3: método HTTP.
 * GET e DELETE do /mcp são da spec do transporte (canal SSE e encerramento de
 * sessão). Quando chegam por este caminho, cada um recebe a resposta certa.
 * Devolve true quando a requisição já foi tratada aqui.
 */
function tratarMetodoEspecial(req, res, ctx) {
  if (req.method === "POST") return false;
  if (req.method === "GET") {
    handlerSse(req, res, ctx);
    return true;
  }
  if (req.method === "DELETE") {
    handlerEncerrarSessao(req, res, ctx);
    return true;
  }
  handlerMetodoNaoPermitido(res);
  return true;
}

/**
 * Cria o par "liberar a vaga da admissão + watchdog".
 *
 * A vaga é liberada UMA vez, aconteça o que acontecer. O watchdog cobre o
 * caso em que o cliente some de um jeito que o Node não sinaliza (proxy que
 * não propaga o abort): sem ele, o handler fica pendurado e a vaga nunca
 * volta — foi o estado visto em produção (128 vagas presas por >100 min).
 */
function criarTravaDeVaga(res) {
  let liberado = false;
  const liberar = () => {
    if (liberado) return;
    liberado = true;
    admissaoHttp.liberar();
  };
  const watchdog = setTimeout(() => {
    liberar();
    if (res.writableEnded || res.destroyed) return;
    try {
      res.writeHead(503, {
        "content-type": "application/json",
        "retry-after": 1,
        "access-control-allow-origin": "*",
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32002, message: "Tempo de processamento excedido." },
        })
      );
    } catch {
      // a resposta já foi encerrada/derrubada; o que importa é a vaga liberada
    }
  }, HTTP_REQUEST_TIMEOUT_MS);
  watchdog.unref();
  return { liberar, watchdog };
}

/**
 * Decide os cabeçalhos de sessão da resposta.
 *
 * Se a resposta trouxe um `initialize`, emite o Mcp-Session-Id: cliente que já
 * mandou uma sessão válida mantém a dele, quem não mandou recebe uma nova. O
 * header é ADITIVO — quem ignora não é afetado. Nos outros casos a sessão
 * enviada só é tocada (mantém o prazo de validade viva).
 */
function cabecalhosDeSessao(req, responses) {
  const headersExtra = { "access-control-allow-origin": "*" };
  const enviada = String(req.headers["mcp-session-id"] || "").trim();
  const houveInitialize = responses.some((r) => r && r.result && r.result.protocolVersion);
  if (houveInitialize) {
    headersExtra["mcp-session-id"] = enviada && tocarSessao(enviada) ? enviada : criarSessao();
  } else if (enviada) {
    tocarSessao(enviada);
  }
  return headersExtra;
}

/**
 * Handler de POST /mcp: a sequência de validações (auth → rate limit → método →
 * admissão → corpo → dispatch).
 *
 * A ordem importa e não é aleatória: a autenticação vem antes de qualquer
 * trabalho (não se gasta CPU com quem não tem token) e a admissão vem depois
 * do rate limit (quem está bloqueado não ocupa vaga). Cada guarda devolve
 * "já respondi?" para que o fluxo principal fique legível de cima a baixo.
 */
export async function handlerMcp(req, res, ctx) {
  const { maxBodyBytes } = ctx;

  if (recusarPorAuth(req, res, ctx.authToken)) return;
  if (recusarPorRateLimit(req, res, ctx)) return;
  if (tratarMetodoEspecial(req, res, ctx)) return;

  try {
    await admissaoHttp.adquirir();
  } catch (err) {
    return handlerAdmissaoRecusada(res, err.message);
  }

  const { liberar, watchdog } = criarTravaDeVaga(res);

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
      res.writeHead(202, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        vary: "accept-encoding",
      });
      res.end();
      return;
    }

    responderJson(
      req,
      res,
      200,
      responses.length === 1 && !eraArray ? responses[0] : responses,
      cabecalhosDeSessao(req, responses)
    );
  } finally {
    clearTimeout(watchdog);
    liberar();
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

    // Rotas da spec do transporte HTTP do MCP. Continuam exigindo o token.
    if (req.method === "GET") return handlerSse(req, res, ctx);
    if (req.method === "DELETE") return handlerEncerrarSessao(req, res, ctx);

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
