/**
 * Fetch HTTP com cache LRU, redirects manuais, retries e proteção SSRF.
 */

import {
  DEFAULT_TIMEOUT_MS,
  USER_AGENT,
  ALT_USER_AGENTS,
  MAX_REDIRECTS,
  RETRY_AFTER_MAX_MS,
  MAX_RESPONSE_BYTES,
  CACHE_TTL_MS,
  CACHE_MAX_ENTRIES,
  CACHE_MAX_BYTES,
  CACHE_MAX_ENTRY_BYTES,
  OUTBOUND_MAX_CONCURRENCY,
  OUTBOUND_MAX_QUEUE,
  OUTBOUND_MEMORY_BUDGET,
  MAX_WAIT_MS,
  MAX_INFLIGHT_REQUESTS,
  MAX_WAITING_REQUESTS,
  DEFAULT_MAX_CHARS,
  HARD_MAX_CHARS,
} from "./config.mjs";
import { criarLimitador, criarLimitadorDeBytes, CacheLRU } from "./utils.mjs";
import { assertPublicHost, agentValidado, checarRobots } from "./security.mjs";
import { extractMeta } from "./html-parser.mjs";
import {
  UrlInvalidaError,
  ProtocoloNaoSuportadoError,
  RedirectError,
  HttpError,
  ConteudoNaoHtmlError,
  RespostaMuitoGrandeError,
  RedeError,
  TimeoutError,
  RequisicaoCanceladaError,
} from "./errors.mjs";

// Limadores de admissão e saída.
export const admissaoHttp = criarLimitador({
  limite: MAX_INFLIGHT_REQUESTS,
  filaMax: MAX_WAITING_REQUESTS,
  esperaMaxMs: MAX_WAIT_MS,
  nome: "requisições",
});
export const limiteSaida = criarLimitador({
  limite: OUTBOUND_MAX_CONCURRENCY,
  filaMax: OUTBOUND_MAX_QUEUE,
  nome: "downloads",
});
export const orcamentoSaida = criarLimitadorDeBytes({
  orcamentoBytes: OUTBOUND_MEMORY_BUDGET,
  filaMax: OUTBOUND_MAX_QUEUE,
  esperaMaxMs: MAX_WAIT_MS,
  nome: "memória-de-download",
});

// Cache em memória (LRU + TTL).
export const pageCache = new CacheLRU({
  ttlMs: CACHE_TTL_MS,
  maxEntries: CACHE_MAX_ENTRIES,
  maxBytes: CACHE_MAX_BYTES,
});

// Limpeza periódica de entradas expiradas.
const cacheCleanup = setInterval(() => pageCache.cleanup(), CACHE_TTL_MS);
cacheCleanup.unref();

/**
 * Calcula o tamanho em bytes de um payload de cache.
 */
const payloadBytes = (payload) =>
  Buffer.byteLength(payload.text || "", "utf8") + Buffer.byteLength(payload.finalUrl || "", "utf8");

/**
 * Extrai a causa real de um erro de rede do Node.
 */
function erroComCausa(err) {
  const descrever = (c) => {
    if (!c) return "";
    if (c.errors && c.errors.length > 0) {
      return c.errors.map((e) => e.code || e.message).filter(Boolean).join("; ");
    }
    return c.message || c.code || String(c);
  };
  const causa = descrever(err.cause);
  const melhorado = new RedeError(
    causa ? `${err.message}: ${causa}` : err.message,
    err.url || "URL desconhecida",
    err.cause
  );
  if (err.retryAfterMs != null) melhorado.retryAfterMs = err.retryAfterMs;
  return melhorado;
}

/**
 * Traduz o erro cru do Node para uma das classes de erro do projeto.
 *
 * O AbortController usado no timeout aborta com o motivo "AbortError", que nao
 * diz nada ao caller — sem esta traducao um timeout virava "Erro: fetch failed"
 * (a mesma mensagem de uma queda de DNS). Distinguimos os dois motivos de abort
 * pelo `cause`: o timer local cancela com ETIMEDOUT; o signal externo (orcamento
 * da busca de APIs internas) cancela com o motivo que o caller passou.
 */
function classificarErro(errBruto, url, timeoutMs) {
  if (errBruto && errBruto.name === "AbortError") {
    const motivo = errBruto.cause;
    if (motivo && motivo.code !== "ETIMEDOUT" && motivo.name !== "AbortError") {
      return new RequisicaoCanceladaError(
        motivo && motivo.message ? motivo.message : "orcamento esgotado"
      );
    }
    return new TimeoutError(url, timeoutMs);
  }
  if (errBruto instanceof TypeError && errBruto.cause && errBruto.status === undefined) {
    return erroComCausa(errBruto);
  }
  return errBruto;
}

/**
 * Lê o corpo em streaming e corta ao passar do teto.
 */
async function readBodyWithLimit(res, maxBytes) {
  const body = res.body;
  if (!body) return Buffer.alloc(0);

  const declarado = Number(res.headers.get("content-length"));
  const estimativa = Number.isFinite(declarado) && declarado > 0 ? declarado : 256 * 1024;
  const reserva = Math.min(maxBytes, estimativa);
  await orcamentoSaida.adquirir(reserva);

  try {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          throw new RespostaMuitoGrandeError(maxBytes, res.url || "URL desconhecida");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // corpo já encerrado
      }
    }
    return Buffer.concat(chunks, total);
  } finally {
    orcamentoSaida.liberar(reserva);
  }
}

/**
 * Decodifica o buffer de acordo com o charset do content-type ou detecta BOM.
 */
async function decodeBuffer(buffer, contentType) {
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  const charset = charsetMatch ? charsetMatch[1].toLowerCase().replace(/["']/g, "") : "";
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder("utf-8").decode(bytes.slice(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder("utf-16be").decode(bytes.slice(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder("utf-16le").decode(bytes.slice(2));
  }
  try {
    if (charset && charset !== "utf-8" && charset !== "utf8") {
      return new TextDecoder(charset).decode(bytes);
    }
  } catch {
    // charset desconhecido, cai no UTF-8
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Faz download de uma URL com timeout, retries e limite de bytes.
 */
export async function fetchText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2, signal: externo, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    // O motivo ETIMEDOUT e o que distingue "estourou o timeout" de "foi
    // cancelado por orcamento externo" no catch (ver classificarErro).
    const timer = setTimeout(() => controller.abort(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), timeoutMs);
    const abortarDeFora = () => controller.abort();
    if (externo) {
      if (externo.aborted) {
        clearTimeout(timer);
        throw new RequisicaoCanceladaError("orçamento esgotado");
      }
      externo.addEventListener("abort", abortarDeFora, { once: true });
    }
    const userAgent = attempt === 0 ? USER_AGENT : ALT_USER_AGENTS[(attempt - 1) % ALT_USER_AGENTS.length];
    try {
      const headers = {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      };
      const { res, finalUrl } = await fetchNoRedirect(url, headers, controller.signal);
      if (!res.ok) {
        const statusFrase = (res.statusText || "").replace(/\b([A-Z]{2,})\b/, (m) =>
          m.charAt(0) + m.slice(1).toLowerCase()
        );
        const err = new HttpError(res.status, statusFrase.trim(), url);
        err.retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        throw err;
      }
      const buffer = await readBodyWithLimit(res, maxBytes);
      const text = await decodeBuffer(buffer, res.headers.get("content-type") || "");
      return {
        text,
        finalUrl,
        contentType: (res.headers.get("content-type") || "").toLowerCase(),
      };
    } catch (errBruto) {
      // Nao reatribuir a variavel do catch: o `finally` roda depois do catch e
      // uma reatribuicao aqui se perde, fazendo o throw final lancar o erro
      // original (ex.: um 500 retriavel) em vez da falha real (ex.: EAI_AGAIN).
      lastError = classificarErro(errBruto, url, timeoutMs);
      const retriable =
        lastError && (lastError.status === 429 || lastError.status === 503 || lastError.status === 500);
      if (!retriable || attempt === retries) throw lastError;
      const respeitaRetryAfter =
        (lastError.status === 429 || lastError.status === 503) && lastError.retryAfterMs != null;
      await sleep(respeitaRetryAfter ? lastError.retryAfterMs : 400 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
      if (externo) externo.removeEventListener("abort", abortarDeFora);
    }
  }
  throw lastError;
}

/**
 * Tenta buscar a página com HTTPS se HTTP falhar.
 */
export async function fetchTextWithFallback(url, options) {
  try {
    return await fetchText(url, options);
  } catch (err) {
    if (url.startsWith("http://")) {
      const httpsUrl = url.replace(/^http:/, "https:");
      try {
        return await fetchText(httpsUrl, options);
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

/**
 * Valida se uma URL é válida e usa protocolo http/https.
 */
export function validateHttpUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new UrlInvalidaError(url);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProtocoloNaoSuportadoError(parsed.protocol, url);
  }
  return parsed;
}

/**
 * GET seguindo redirects à mão, validando o destino de cada salto.
 * Otimização: reutiliza o IP/agent entre hops do mesmo host para evitar revalidação e reconexão.
 */
async function fetchNoRedirect(url, headers, signal) {
  let currentUrl = url;
  let ultimoHost = null;
  let ultimoIp = null;
  let ultimoAgent = undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new RedirectError(`URL inválida em ${currentUrl}`, currentUrl);
    }

    const mesmoHost = ultimoHost === parsed.host;
    const ipValido = mesmoHost ? ultimoIp : await assertPublicHost(currentUrl);

    if (!mesmoHost) {
      ultimoHost = parsed.host;
      ultimoIp = ipValido;
      ultimoAgent = ipValido ? agentValidado(currentUrl, ipValido) : undefined;
    }
    const agent = mesmoHost ? ultimoAgent : ipValido ? agentValidado(currentUrl, ipValido) : undefined;

    const res = await fetch(currentUrl, { method: "GET", headers, redirect: "manual", signal, agent });
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = isRedirect ? res.headers.get("location") : null;
    if (!isRedirect || !location) return { res, finalUrl: currentUrl };

    try {
      await res.arrayBuffer();
    } catch {
      // corpo do redirect irrelevante
    }
    if (hop === MAX_REDIRECTS) {
      throw new RedirectError(`excesso de saltos (mais de ${MAX_REDIRECTS})`, url);
    }
    let next;
    try {
      next = new URL(location, currentUrl);
    } catch {
      throw new RedirectError(`Location inválido em ${currentUrl}`, currentUrl);
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new RedirectError(`protocolo não suportado (${next.protocol})`, currentUrl);
    }
    currentUrl = next.href;
  }
  throw new RedirectError(`excesso de saltos (mais de ${MAX_REDIRECTS})`, url);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry-After pode vir em segundos ou como data HTTP. Teto de 10s.
 */
function parseRetryAfter(valor) {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (/^\d+$/.test(texto)) return Math.min(RETRY_AFTER_MAX_MS, Number(texto) * 1000);
  const data = Date.parse(texto);
  if (Number.isFinite(data)) return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, data - Date.now()));
  return null;
}

/**
 * Limita o maxChars aos valores válidos (200 a HARD_MAX_CHARS).
 */
export function clampMaxChars(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_CHARS;
  return Math.max(200, Math.min(HARD_MAX_CHARS, Math.floor(n)));
}

/**
 * Limita o timeoutMs aos valores válidos (1000 a 60000 ms).
 */
export function clampTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1000, Math.min(60000, Math.floor(n)));
}

/**
 * Trunca um texto ao limite de caracteres.
 */
export function truncate(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text:
      text.slice(0, maxChars) +
      `\n\n[... conteudo truncado em ${maxChars} caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]`,
    truncated: true,
  };
}

/**
 * Formata o resultado final de leitura.
 */
export function formatReadResult({ finalUrl, meta, text, truncated, fullLength, extraLabel }) {
  const lines = [];
  lines.push(`# ${meta.title || "(sem título)"}`);
  lines.push(`URL: ${finalUrl}`);
  if (extraLabel) lines.push(extraLabel);
  if (meta.description) lines.push(`Descricao: ${meta.description}`);
  if (meta.author) lines.push(`Autor: ${meta.author}`);
  if (meta.published) lines.push(`Publicado: ${meta.published}`);
  lines.push(
    `Conteudo: ${fullLength} caracteres` +
      (truncated ? ` (exibidos ${text.length})` : "")
  );
  lines.push("");
  lines.push(text);
  return lines.join("\n");
}

/**
 * Valida se o conteúdo retornado é realmente HTML.
 */
export function ensureHtml(contentType, html, url = "URL desconhecida") {
  if (contentType && !/html|xml|text\//.test(contentType)) {
    throw new ConteudoNaoHtmlError(contentType, url);
  }
  if (!contentType && !/^\s*</.test(html)) {
    throw new ConteudoNaoHtmlError(null, url);
  }
}

/**
 * Verifica se o conteúdo é texto puro ou XML (não HTML).
 */
export function isConteudoBruto(contentType, html) {
  const ct = String(contentType || "").toLowerCase();
  if (!ct || ct.includes("html")) return false;
  if (!/^text\/plain|xml/.test(ct)) return false;
  if (/^\s*<!doctype html|^\s*<html[\s>]/i.test(html)) return false;
  return true;
}

/**
 * Formata um conteúdo cru (texto puro/XML) para retorno.
 */
export function conteudoBrutoResult(html, finalUrl, maxChars) {
  const texto = html.replace(/\r\n?/g, "\n");
  const { text, truncated } = truncate(texto, maxChars);
  return formatReadResult({
    finalUrl,
    meta: extractMeta(html),
    text,
    truncated,
    fullLength: texto.length,
    extraLabel: "Conteúdo de texto puro/XML (sem conversão para markdown)",
  });
}

/**
 * Fetch com cache LRU + TTL. Valida segurança (SSRF + robots) ANTES de baixar.
 * Entrada expirada = busca de novo (stale-while-revalidate desligado).
 */
export async function fetchTextCached(url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, retries } = {}) {
  const hit = pageCache.get(url);
  if (hit) return hit.payload;

  await Promise.all([assertPublicHost(url), checarRobots(url)]);

  const payload = await limiteSaida.executar(() =>
    fetchTextWithFallback(url, { timeoutMs, signal, retries })
  );
  const bytes = payloadBytes(payload);
  if (bytes <= CACHE_MAX_ENTRY_BYTES) {
    pageCache.set(url, payload, bytes);
  }
  return payload;
}

/**
 * Estatísticas do cache.
 */
export function cacheStats() {
  return pageCache.stats();
}
