/**
 * fetch.mjs — a porta de saída da internet. Tudo que é baixado passa por aqui.
 *
 * O QUE É
 *   O único lugar do projeto que faz requisição HTTP. Concentrar isso aqui é
 *   intencional: SSRF, redirect, retry, timeout, teto de bytes, cache e
 *   junção de buscas repetidas são regras de segurança e de desempenho — se
 *   cada módulo baixasse do seu jeito, cada um precisaria acertar as seis.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: uma URL (e opções: timeout, teto de bytes, se aceita cache).
 *   Sai:   o texto ou os bytes já validados, descomprimidos e decodificados —
 *          ou um erro tipado de errors.mjs explicando por que não deu.
 *
 * AS SEIS REGRAS QUE VIVEM AQUI
 *   1. SSRF:     só host público; IP privado/loopback/link-local é recusado.
 *   2. DNS:      o IP validado é o IP usado na conexão (ver net.mjs).
 *   3. Redirect: seguido à mão, com cada salto revalidado pela regra 1.
 *   4. Retry:    só o que vale a pena repetir, com espera crescente.
 *   5. Cache:    LRU com TTL e teto de bytes; revalida em vez de proibir.
 *   6. Coalescer: duas chamadas simultâneas da mesma URL = um download só.
 *
 * QUEM USA
 *   Usado por: feeds, http-transport, pdf, snapshot, tools, video.
 *   Importa de: config, errors, html-parser, net, security, utils.
 */

import {
  DEFAULT_TIMEOUT_MS,
  USER_AGENT,
  ALT_USER_AGENTS,
  MAX_REDIRECTS,
  RETRY_AFTER_MAX_MS,
  MAX_RESPONSE_BYTES,
  MAX_RESPONSE_BYTES_DOCUMENTO,
  CACHE_TTL_MS,
  CACHE_MAX_ENTRIES,
  CACHE_MAX_BYTES,
  CACHE_MAX_ENTRY_BYTES,
  CACHE_SWR,
  CACHE_STALE_WINDOW_MS,
  CACHE_NEGATIVO_TTL_MS,
  CACHE_NEGATIVO_MAX_ENTRIES,
  OUTBOUND_MAX_CONCURRENCY,
  OUTBOUND_MAX_QUEUE,
  OUTBOUND_MEMORY_BUDGET,
  HOST_MAX_CONCURRENCY,
  HOST_MAX_QUEUE,
  MAX_WAIT_MS,
  MAX_INFLIGHT_REQUESTS,
  MAX_WAITING_REQUESTS,
  DEFAULT_MAX_CHARS,
  HARD_MAX_CHARS,
} from "./config.mjs";
import {
  criarLimitador,
  criarLimitadorDeBytes,
  criarLimitadorPorChave,
  CacheLRU,
  criarCoalescedorDeBuscas,
  chaveCanonica,
} from "./utils.mjs";
import { assertPublicHost, checarRobots } from "./security.mjs";
import { httpGetUmSalto, coletarComTeto, desembrulhar, descartarCorpo } from "./net.mjs";
import { extractMeta, hostOf } from "./html-parser.mjs";
import {
  UrlInvalidaError,
  ProtocoloNaoSuportadoError,
  RedirectError,
  HttpError,
  ConteudoNaoHtmlError,
  RedeError,
  TimeoutError,
  RequisicaoCanceladaError,
  RespostaMuitoGrandeError,
  WebReaderError,
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
// Justiça entre hosts: cada site tem o seu próprio teto de downloads
// simultâneos, por cima do teto global. Sem isso, um host lento (ou um lote
// inteiro de URLs do mesmo site) monopoliza as vagas de saída.
export const limitesPorHost = criarLimitadorPorChave({
  limite: HOST_MAX_CONCURRENCY,
  filaMax: HOST_MAX_QUEUE,
  esperaMaxMs: MAX_WAIT_MS,
  nome: "downloads",
});
export const orcamentoSaida = criarLimitadorDeBytes({
  orcamentoBytes: OUTBOUND_MEMORY_BUDGET,
  filaMax: OUTBOUND_MAX_QUEUE,
  esperaMaxMs: MAX_WAIT_MS,
  nome: "memória-de-download",
});

// Cache em memória (LRU + TTL). Com CACHE_SWR=1, entrada vencida dentro da
// janela de graça é servida na hora e revalidada em segundo plano.
export const pageCache = new CacheLRU({
  ttlMs: CACHE_TTL_MS,
  maxEntries: CACHE_MAX_ENTRIES,
  maxBytes: CACHE_MAX_BYTES,
  staleWhileRevalidate: CACHE_SWR,
  staleWindowMs: CACHE_STALE_WINDOW_MS > 0 ? CACHE_STALE_WINDOW_MS : undefined,
});

// Junção de buscas em voo: N pedidos simultâneos da MESMA URL viram 1 download.
export const coalescedorDeBuscas = criarCoalescedorDeBuscas();

/* --------------------------------------------------------------------- *
 * Cache NEGATIVO (falha permanente)                                       *
 * --------------------------------------------------------------------- *
 * Uma URL que responde 404 é 404 amanhã também, quase sempre. Sem esta
 * memória, cada pedido da mesma URL pagava conexão + TLS + headers para
 * receber o mesmo "não existe" — o pior tipo de trabalho: gastar rede para
 * confirmar uma negativa que já se sabia.
 *
 * O que entra é só status PERMANENTE (4xx que não seja 429). 5xx e 429 são
 * transitórios: guardá-los transformaria um tropeço do servidor em erro fixo.
 * O TTL é curto (2 min) porque um 404 pode virar 200 a qualquer momento.
 *
 * Guarda o erro já pronto e o devolve num clone: quem recebe pode inspecionar
 * `status` sem que um chamador contamine o outro.
 * --------------------------------------------------------------------- */
const cacheNegativo = new Map();
export const cacheNegativoStats = { hits: 0, gravados: 0 };

/** Status que valem ser lembrados (permanentes). */
function statusNegativoCacheavel(status) {
  return status >= 400 && status < 500 && status !== 429 && status !== 408;
}

/** Devolve o HttpError guardado para a URL, ou null. */
function lerNegativo(cacheKey) {
  if (CACHE_NEGATIVO_MAX_ENTRIES === 0) return null;
  const entrada = cacheNegativo.get(cacheKey);
  if (!entrada) return null;
  if (Date.now() - entrada.at > CACHE_NEGATIVO_TTL_MS) {
    cacheNegativo.delete(cacheKey);
    return null;
  }
  // Reordena para o LRU: a negativa mais consultada é a última a sair.
  cacheNegativo.delete(cacheKey);
  cacheNegativo.set(cacheKey, entrada);
  cacheNegativoStats.hits++;
  return new HttpError(entrada.status, entrada.statusText, entrada.url);
}

/** Guarda uma falha permanente (se o status permitir). */
function guardarNegativo(cacheKey, err) {
  if (CACHE_NEGATIVO_MAX_ENTRIES === 0) return;
  if (!(err instanceof HttpError) || !statusNegativoCacheavel(err.status)) return;
  cacheNegativo.delete(cacheKey);
  cacheNegativo.set(cacheKey, {
    at: Date.now(),
    status: err.status,
    statusText: err.statusText,
    url: err.url,
  });
  cacheNegativoStats.gravados++;
  while (cacheNegativo.size > CACHE_NEGATIVO_MAX_ENTRIES) {
    cacheNegativo.delete(cacheNegativo.keys().next().value);
  }
}

// Revalidações em segundo plano (SWR): contadores para o /health.
export const revalidacoes = { tentadas: 0, falhas: 0 };

// Validadores HTTP (ETag/Last-Modified) por URL, para revalidação condicional.
// Guardamos também o payload para restaurá-lo quando o servidor responde 304
// (não modificado) — nesse caso não há corpo para baixar e a entrada vencida
// volta a valer. O mapa é limitado: sem teto, cada URL nova ficaria guardada
// para sempre (mesmo depois de sair do cache).
const VALIDADORES_MAX = 512;
export const validadoresHttp = new Map();
// Contadores de revalidação condicional (aparecem no /health).
export const revalidacaoCondicional = { tentadas: 0, naoModificadas: 0 };

/** Guarda (ou limpa) os validadores de uma URL, mantendo o mapa dentro do teto. */
function guardarValidadores(url, etag, lastModified, payload) {
  if (!etag && !lastModified) {
    validadoresHttp.delete(url);
    return;
  }
  if (validadoresHttp.has(url)) validadoresHttp.delete(url);
  validadoresHttp.set(url, { etag, lastModified, payload });
  while (validadoresHttp.size > VALIDADORES_MAX) {
    validadoresHttp.delete(validadoresHttp.keys().next().value);
  }
}

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
 * Timeout x cancelamento: o timer local aborta com o motivo de código
 * ETIMEDOUT; qualquer outro abort é cancelamento (orçamento externo, cliente
 * que desistiu) e vira RequisicaoCanceladaError. O motivo real pode vir no
 * `cause` (o AbortError do Node embrulha o signal.reason) ou ser o próprio
 * erro (quando existe reason, o Node emite o reason direto).
 */
function classificarErro(errBruto, url, timeoutMs) {
  const codigo = errBruto && errBruto.code;
  const nome = errBruto && errBruto.name;
  if (nome === "AbortError" || codigo === "ABORT_ERR" || codigo === "ETIMEDOUT" || codigo === "ABORT_EXTERNO") {
    const motivo = errBruto.cause || errBruto;
    if (motivo && motivo.code === "ETIMEDOUT") return new TimeoutError(url, timeoutMs);
    return new RequisicaoCanceladaError(motivo && motivo.message ? motivo.message : "orçamento esgotado");
  }
  // Erros do projeto já saem prontos (RespostaMuitoGrande, ServidorOcupado...).
  if (errBruto instanceof WebReaderError) return errBruto;
  // Erros de rede do node:http/https: vêm com `code` (ECONNREFUSED,
  // ENOTFOUND, SELF_SIGNED_CERT_IN_CHAIN...). O RedeError preserva código e
  // mensagem — é o que o relatório de campo pediu (BUG-4: nada de "fetch
  // failed" pelado). `errors` agregado (getaddrinfo) também é citado.
  if (errBruto instanceof Error && (errBruto.code || errBruto.errors)) {
    const detalhe = errBruto.code ? ` (${errBruto.code})` : "";
    const agregado = Array.isArray(errBruto.errors)
      ? `: ${errBruto.errors.map((e) => e.code || e.message).filter(Boolean).join("; ")}`
      : "";
    return new RedeError(`${errBruto.message}${detalhe}${agregado}`, url, errBruto);
  }
  if (errBruto instanceof TypeError && errBruto.cause && errBruto.status === undefined) {
    return erroComCausa(errBruto);
  }
  return errBruto;
}

/**
 * Lê o corpo do download com os dois tetos em cima:
 *
 * - teto de bytes por resposta (maxBytes): acima disso a leitura para;
 * - orçamento de memória (orcamentoSaida), reservado ANTES de bufferizar.
 *   A reserva inicial usa o content-length quando ele é confiável e, como
 *   ele pode MENTIR (declarar pouco e mandar muito), cada pedaço novo que
 *   passar da reserva pede a diferença antes de entrar no buffer — o teto
 *   de memória acompanha os bytes REAIS, não a promessa do servidor.
 *
 * O que sobrou da reserva volta no finally, sempre.
 */
async function lerCorpoComOrcamento(stream, headers, maxBytes, url, signal, permitirCorte = false) {
  const declarado = Number(headers["content-length"]);
  const estimativa = Number.isFinite(declarado) && declarado > 0 ? declarado : 256 * 1024;
  let reservado = Math.min(maxBytes, estimativa);
  await orcamentoSaida.adquirir(reservado);
  try {
    return await coletarComTeto(stream, {
      maxBytes,
      url,
      signal,
      permitirCorte,
      aoChunk: async (bytesTotais) => {
        const falta = bytesTotais - reservado;
        if (falta > 0) {
          // Pode esperar (e falhar com "Servidor ocupado" quando o orçamento
          // global estourou): melhor erro claro do que memória sem limite.
          await orcamentoSaida.adquirir(falta);
          reservado = bytesTotais;
        }
      },
    });
  } finally {
    orcamentoSaida.liberar(reservado);
  }
}

// Decodificadores reaproveitados: criar um TextDecoder por resposta custa
// caro (a tabela de charset é montada na construção) e a esmagadora maioria
// das páginas é UTF-8. Os incomuns continuam sendo criados sob demanda e
// ficam guardados por charset.
const decoderUtf8 = new TextDecoder("utf-8");
const decodersPorCharset = new Map();

/** Devolve o TextDecoder do charset (cache por nome), ou null se desconhecido. */
function decoderPara(charset) {
  if (charset === "utf-8" || charset === "utf8") return decoderUtf8;
  let dec = decodersPorCharset.get(charset);
  if (dec) return dec;
  try {
    dec = new TextDecoder(charset);
  } catch {
    return null;
  }
  // Teto pequeno: um site não usa dezenas de charsets, e sem teto um atacante
  // que varia o `charset` encheria o mapa.
  if (decodersPorCharset.size >= 64) decodersPorCharset.clear();
  decodersPorCharset.set(charset, dec);
  return dec;
}

/**
 * Decodifica o buffer de acordo com o charset do content-type ou detecta BOM.
 */
async function decodeBuffer(buffer, contentType) {
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  const charset = charsetMatch ? charsetMatch[1].toLowerCase().replace(/["']/g, "") : "";
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return decoderUtf8.decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return (decoderPara("utf-16be") || decoderUtf8).decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return (decoderPara("utf-16le") || decoderUtf8).decode(bytes.subarray(2));
  }
  if (charset) {
    const dec = decoderPara(charset);
    if (dec) return dec.decode(bytes);
  }
  return decoderUtf8.decode(bytes);
}

/**
 * Faz download de uma URL com timeout, retries e limite de bytes.
 *
 * Com `condicional` ({ etag, lastModified, payload }), manda If-None-Match /
 * If-Modified-Since: se o servidor responder 304 (não modificado), NÃO há
 * corpo a baixar — devolve o payload guardado, marcado com `naoModificado`,
 * e quem chamou reaquece o cache. É download inteiro economizado quando o
 * site coopera.
 *
 * Com `decodificar: true`, devolve `text` (decodificado pelo charset). Sem
 * ela, devolve `buffer` cru — é o que o leitor de PDF precisa, porque PDF é
 * binário e passar por decodificação de texto corromperia os bytes.
 */
/* --------------------------------------------------------------------- *
 * Peças de uma requisição                                                 *
 * --------------------------------------------------------------------- */

/**
 * Monta os cabeçalhos de UMA tentativa.
 *
 * O User-Agent muda a cada tentativa de propósito: alguns sites recusam um
 * agente específico, e alternar aumenta a chance de a segunda tentativa
 * passar. A revalidação condicional (If-None-Match / If-Modified-Since) só
 * entra na primeira: retry é por falha de rede, não faz sentido repetir.
 */
function montarCabecalhos({ userAgent, headersExtra, condicional, primeiraTentativa }) {
  const headers = {
    "User-Agent": userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    // Revalidação em vez de proibição de cache. "no-cache" + "Pragma:
    // no-cache" obrigavam CDN e proxy a irem SEMPRE até a origem, e num site
    // atrás de Cloudflare/Fastly isso custa a maior parte do TTFB.
    // "max-age=0, must-revalidate" continua sem servir conteúdo velho (o
    // cache de borda revalida antes de responder), e a revalidação
    // condicional por ETag/Last-Modified faz o servidor devolver 304 sem
    // corpo quando nada mudou.
    "Cache-Control": "max-age=0, must-revalidate",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  // Cabeçalhos extras do chamador (ex.: Authorization). A chave viaja AQUI,
  // nunca na URL — assim não entra na chave de cache nem em mensagem de erro.
  // O que o chamador mandar vence o padrão.
  if (headersExtra) Object.assign(headers, headersExtra);
  if (primeiraTentativa && condicional) {
    if (condicional.etag) headers["If-None-Match"] = condicional.etag;
    if (condicional.lastModified) headers["If-Modified-Since"] = condicional.lastModified;
  }
  return headers;
}

/**
 * Monta o objeto que descreve o que chegou — comum aos dois modos de retorno
 * (bytes crus ou texto decodificado).
 */
function descreverPayload({ finalUrl, resposta, buffer }) {
  return {
    finalUrl,
    contentType: String(resposta.headers["content-type"] || "").toLowerCase(),
    etag: resposta.headers["etag"] || null,
    lastModified: resposta.headers["last-modified"] || null,
    // Marca de corte: o documento veio INCOMPLETO porque o teto apertado
    // parou o download. Quem recebe isto precisa avisar e NÃO guardar.
    cortado: buffer.cortado === true,
    // Bytes que de fato vieram (e o que o servidor declarou, quando ele
    // declara). É o que diz se o corte tirou texto: com content-length a
    // decisão é exata; sem ele, `bytes` é o tamanho do teto.
    bytes: buffer.length,
    bytesDeclarados: Number(resposta.headers["content-length"]) || null,
  };
}

/**
 * Traduz o status HTTP de erro em texto legível: "NOT_FOUND" -> "Not found".
 */
function fraseDeStatus(statusMessage) {
  return (statusMessage || "").replace(/\b([A-Z]{2,})\b/, (m) => m.charAt(0) + m.slice(1).toLowerCase()).trim();
}

export async function fetchBytes(url, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2, signal: externo, maxBytes = MAX_RESPONSE_BYTES, condicional = null, decodificar = false, headers: headersExtra = null, permitirCorte = false } = {}) {
  let lastError = null;
  // Tetos do retry: número inteiro entre 0 e 5. Antes, um valor negativo (ou
  // NaN) podia pular o laço inteiro e o throw final lançar `null`.
  const maxTentativas = Math.max(0, Math.min(5, Math.floor(Number(retries)) || 0));
  for (let attempt = 0; attempt <= maxTentativas; attempt++) {
    const controller = new AbortController();
    // O motivo ETIMEDOUT e o que distingue "estourou o timeout" de "foi
    // cancelado por orcamento externo" no catch (ver classificarErro).
    const timer = setTimeout(() => controller.abort(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), timeoutMs);
    // O motivo do cancelamento externo é repassado ao AbortController local:
    // sem isso o abort não diria de onde veio e a classificação chamaria um
    // cancelamento de "timeout".
    const abortarDeFora = () => {
      controller.abort(
        externo.reason && externo.reason.name !== "AbortError"
          ? externo.reason
          : Object.assign(new Error("orçamento esgotado"), { code: "ABORT_EXTERNO" })
      );
    };
    if (externo) {
      if (externo.aborted) {
        clearTimeout(timer);
        throw new RequisicaoCanceladaError("orçamento esgotado");
      }
      externo.addEventListener("abort", abortarDeFora, { once: true });
    }
    const userAgent = attempt === 0 ? USER_AGENT : ALT_USER_AGENTS[(attempt - 1) % ALT_USER_AGENTS.length];
    try {
      const headers = montarCabecalhos({
        userAgent,
        headersExtra,
        condicional,
        primeiraTentativa: attempt === 0,
      });
      const { resposta, finalUrl } = await buscarComRedirects(url, headers, controller.signal);
      if (resposta.statusCode === 304 && condicional && condicional.payload) {
        descartarCorpo(resposta.stream);
        revalidacaoCondicional.naoModificadas++;
        return { ...condicional.payload, naoModificado: true };
      }
      if (resposta.statusCode < 200 || resposta.statusCode >= 300) {
        const err = new HttpError(resposta.statusCode, fraseDeStatus(resposta.statusMessage), url);
        err.retryAfterMs = parseRetryAfter(resposta.headers["retry-after"]);
        descartarCorpo(resposta.stream);
        throw err;
      }
      const buffer = await lerCorpoComOrcamento(
        desembrulhar(resposta.stream, resposta.headers),
        resposta.headers,
        maxBytes,
        finalUrl,
        controller.signal,
        permitirCorte
      );
      const base = descreverPayload({ finalUrl, resposta, buffer });
      if (!decodificar) {
        return { ...base, buffer };
      }
      return { ...base, text: await decodeBuffer(buffer, base.contentType) };
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
 * Invólucro de compatibilidade: baixa a URL e devolve o TEXTO decodificado.
 * É o caminho usado por tudo que lê HTML/XML/JSON; o leitor de PDF usa
 * `fetchBytes` direto para receber os bytes crus.
 */
export function fetchText(url, options) {
  return fetchBytes(url, { ...(options || {}), decodificar: true });
}

/**
 * Tamanho REAL já observado por URL: quanto precisou ser baixado para ter o
 * documento inteiro (ou, no caso do corte, o tamanho do teto que cortou — que
 * é um piso do tamanho de verdade).
 *
 * Serve para não pagar o download em duas etapas duas vezes: sem esta memória,
 * toda leitura de uma página maior que o teto baixaria o pedaço, descobriria o
 * corte e baixaria o resto — dois downloads em vez de um.
 */
const tamanhosConhecidos = new Map();
const TAMANHO_CONHECIDO_TTL_MS = 10 * 60 * 1000;
const TAMANHO_CONHECIDO_MAX = 512;

/**
 * Chave da memória de tamanho: host + caminho, sem query. Parâmetros de
 * rastreio não mudam o tamanho do documento, e é comum o cliente repetir a
 * leitura com a URL "suja" — com a chave completa, a memória nunca acertaria.
 */
function chaveDeTamanho(cacheKey) {
  try {
    const u = new URL(cacheKey);
    return `${u.host}${u.pathname}`;
  } catch {
    return cacheKey;
  }
}

function registrarTamanho(chave, bytes) {
  if (!chave || !Number.isFinite(bytes) || bytes <= 0) return;
  if (tamanhosConhecidos.size >= TAMANHO_CONHECIDO_MAX && !tamanhosConhecidos.has(chave)) {
    tamanhosConhecidos.delete(tamanhosConhecidos.keys().next().value);
  }
  tamanhosConhecidos.set(chave, { at: Date.now(), bytes });
}

function tamanhoConhecido(chave) {
  const r = tamanhosConhecidos.get(chave);
  if (!r) return 0;
  if (Date.now() - r.at > TAMANHO_CONHECIDO_TTL_MS) {
    tamanhosConhecidos.delete(chave);
    return 0;
  }
  return r.bytes;
}

/**
 * URLs em que o corte JÁ se mostrou inútil: a leitura do pedaço não cobriu o
 * `maxChars`, então o chamador teve de refazer o download inteiro. Guardar isso
 * poupa a segunda conexão nas próximas leituras.
 *
 * O caso real medido: a home do washingtonpost tem 4 MB de markdown, mas o
 * topo do HTML é quase todo marcação — cortar em 480 KB entrega pouco texto,
 * refaz largo, e cada leitura pagava DOIS downloads (46% mais lenta que sem o
 * recurso). Com a memória, a estreia ainda paga dois; as seguintes pagam um.
 */
const semCorteUtil = new Map();
const SEM_CORTE_TTL_MS = 10 * 60 * 1000;

/** Marca que, para esta URL, cortar o download não vale a pena. */
export function marcarCorteInutil(url) {
  const chave = chaveDeTamanho(chaveCanonica(url));
  if (semCorteUtil.size >= TAMANHO_CONHECIDO_MAX && !semCorteUtil.has(chave)) {
    semCorteUtil.delete(semCorteUtil.keys().next().value);
  }
  semCorteUtil.set(chave, Date.now());
}

function corteInutil(chave) {
  const at = semCorteUtil.get(chave);
  if (!at) return false;
  if (Date.now() - at > SEM_CORTE_TTL_MS) {
    semCorteUtil.delete(chave);
    return false;
  }
  return true;
}

export async function fetchTextComTeto(url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, retries, maxBytes, largoBytes = MAX_RESPONSE_BYTES, forcarLargo = false } = {}) {  const cacheKey = chaveCanonica(url);
  const guardado = pageCache.get(cacheKey);
  if (guardado) {
    if (guardado.stale) revalidarEmSegundoPlano(cacheKey, url, { timeoutMs, retries });
    return guardado.payload;
  }
  let apertado = Math.min(maxBytes || largoBytes, largoBytes);
  // `forcarLargo` é o chamador dizendo "o documento inteiro importa desta vez":
  // acontece quando o corte custou texto que o cliente ia receber. Na prática,
  // é a PRIMEIRA leitura de uma página cujo topo não cobre o pedido.
  if (forcarLargo) apertado = largoBytes;
  // Cortar já se mostrou inútil nesta URL (o pedaço não cobria o pedido):
  // vai direto ao largo em vez de pagar dois downloads de novo.
  if (!forcarLargo && corteInutil(chaveDeTamanho(cacheKey))) apertado = largoBytes;
  // A memória de tamanho manda direto ao teto largo quando a página já se
  // mostrou MAIOR que o teto apertado numa leitura anterior — mas só quando o
  // que falta é pequeno a ponto de não valer a economia.
  //
  // Medido em dev/_mede-teto.mjs (página de 3,8 MB, teto de 1,1 MB): largar o
  // corte de vez levava a repetição de 310 ms para 1.029 ms. Ou seja, insistir
  // no corte COMPENSA nesse caso — o download economizado é grande — e a
  // memória só deve entrar quando o resto é pequeno perto do que já se baixou.
  const conhecido = forcarLargo ? 0 : tamanhoConhecido(chaveDeTamanho(cacheKey));
  const restoPequeno = conhecido > 0 && conhecido - apertado <= apertado;
  if (restoPequeno) apertado = largoBytes;

  const teoCorte = apertado < largoBytes;
  return coalescedorDeBuscas.executar(cacheKey, async () => {
    // Quem esperou na junção pode encontrar a entrada que outro acabou de gravar.
    const quente = pageCache.get(cacheKey);
    if (quente && !quente.stale) return quente.payload;
    return await buscarEAquecer(url, {
      timeoutMs,
      signal,
      retries,
      chave: cacheKey,
      maxBytes: apertado,
      // Corte só vale quando existe um teto MAIOR para refazer. Se o apertado
      // já é o máximo do servidor, cortar em silêncio entregaria um documento
      // incompleto sem saída — aí o erro é o comportamento correto (e é o que
      // a suíte trava em tests/parada-antecipada.test.mjs).
      permissoDeCorte: teoCorte,
    });
  });
}

/**
 * Tenta buscar a página com HTTPS se HTTP falhar.
 */
export async function fetchTextWithFallback(url, options) {
  try {
    return await fetchBytes(url, options);
  } catch (err) {
    if (url.startsWith("http://")) {
      const httpsUrl = url.replace(/^http:/, "https:");
      try {
        return await fetchBytes(httpsUrl, options);
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
 *
 * O transporte é o node:http/https com o Agent do IP validado (ver net.mjs):
 * o DNS do host NUNCA é resolvido de novo — é o que fecha o DNS rebinding.
 * Otimização: reutiliza o IP entre saltos do mesmo host para não revalidar.
 */
async function buscarComRedirects(url, headers, signal) {
  let currentUrl = url;
  let ultimoHost = null;
  let ultimoIp = null;

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
    }

    const { statusCode, statusMessage, headers: respHeaders, stream } = await httpGetUmSalto(currentUrl, {
      headers,
      ipValido,
      signal,
    });
    const isRedirect = statusCode >= 300 && statusCode < 400;
    const location = isRedirect ? respHeaders.location : null;
    if (!isRedirect || !location) {
      return { resposta: { statusCode, statusMessage, headers: respHeaders, stream }, finalUrl: currentUrl };
    }

    // Corpo de redirect é lixo: DESCARTA em vez de drenar. Drenar um corpo
    // infinito prendia o salto (e a vaga de admissão) para sempre.
    descartarCorpo(stream);
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
 * Busca de verdade: valida segurança (SSRF + robots), baixa e grava no cache.
 * É o corpo que roda sob a junção em voo (um por URL em andamento). Com
 * `revalidacao`, pula a rechecagem de cache — a versão vencida está lá de
 * propósito; o objetivo é atualizá-la.
 */
/**
 * Guarda no cache o resultado de um download, decidindo ANTES se pode guardar.
 *
 * Duas regras que existem por motivo concreto:
 *
 *   1. Documento CORTADO nunca entra — nem o corpo, nem os validadores.
 *      Guardar HTML truncado envenenaria toda leitura futura da mesma URL
 *      (uma leitura com maxChars maior receberia o pedaço) e os validadores
 *      fariam o servidor responder 304 para um conteúdo que aqui está
 *      incompleto. O cache é por URL, não por tamanho pedido: só entra o que
 *      está inteiro.
 *   2. Entrada maior que o teto de bytes por entrada não entra, para uma
 *      página gigante não expulsar todas as outras do cache.
 *
 * `extrair` é a transformação opcional que roda ANTES do cache: o leitor de
 * PDF baixa bytes e converte em texto aqui, para que a entrada guardada (e a
 * junção em voo) já tenham o RESULTADO — e uma releitura não reparseie o PDF.
 */
function guardarNoCache({ cacheKey, payload, extrair }) {
  // A flag `naoModificado` é sinal interno de transporte: não vai para o cache.
  const { naoModificado, ...semFlag } = payload;

  if (extrair) {
    const { text, extraido } = extrair(semFlag);
    const comTexto = { ...semFlag, text, extraido };
    if (payloadBytes(comTexto) <= CACHE_MAX_ENTRY_BYTES) {
      pageCache.set(cacheKey, comTexto, payloadBytes(comTexto));
    }
    guardarValidadores(cacheKey, semFlag.etag, semFlag.lastModified, comTexto);
    return comTexto;
  }

  if (semFlag.cortado) return semFlag;

  const bytes = payloadBytes(semFlag);
  if (bytes <= CACHE_MAX_ENTRY_BYTES) pageCache.set(cacheKey, semFlag, bytes);
  guardarValidadores(cacheKey, semFlag.etag, semFlag.lastModified, semFlag);
  return semFlag;
}

/**
 * Lembra o tamanho real do documento para a próxima leitura da MESMA página
 * decidir de primeira — sem esta memória, toda leitura de página maior que o
 * teto pagaria dois downloads (o pedaço e o resto).
 *
 * A chave ignora a query de rastreio (`?utm_*`, `?v=`, `?releitura=`): duas
 * visitas à mesma página com parâmetro diferente são a mesma página, e é
 * justamente nelas que o cliente repete a leitura.
 *
 * Só registra quando o número é CONFIÁVEL:
 *  - o servidor declarou o tamanho (content-length é o tamanho real), ou
 *  - o download NÃO foi cortado (então `bytes` é o documento inteiro).
 * Um download cortado sem content-length tem `bytes` = tamanho do teto, que
 * não diz nada sobre a página — gravar isso envenenava a memória e desligava
 * o corte na leitura seguinte (medido: o valor do teto virava "tamanho da
 * página" e `restoPequeno` passava a ser verdadeiro por engano).
 */
function lembrarTamanho(cacheKey, payload) {
  const confiavel = payload.bytesDeclarados || (!payload.cortado ? payload.bytes : 0);
  if (confiavel) registrarTamanho(chaveDeTamanho(cacheKey), confiavel);
}

async function buscarEAquecer(url, { timeoutMs, signal, retries, revalidacao = false, chave = null, extrair = null, maxBytes = MAX_RESPONSE_BYTES, permissoDeCorte = false } = {}) {
  const cacheKey = chave || chaveCanonica(url);
  if (!revalidacao) {
    // Quem esperou na junção pode encontrar a entrada que outro pedido acabou
    // de gravar — nesse caso não baixa de novo.
    const hitQuente = pageCache.get(cacheKey);
    if (hitQuente && !hitQuente.stale) return hitQuente.payload;

    // Falha permanente já vista nesta URL: devolve o MESMO erro sem tocar a
    // rede. Fica DEPOIS da checagem de conteúdo (um 404 não pode encobrir uma
    // página que já está em cache) e ANTES de qualquer trabalho de segurança,
    // que é justamente o que se quer economizar.
    const negativa = lerNegativo(cacheKey);
    if (negativa) throw negativa;
  }

  // O SSRF do host é validado ANTES de qualquer outra saída (o fetch do robots
  // escapava do bloqueio quando os dois iam juntos sem essa ordem — prova em
  // dev/_probe-robots-ssrf.mjs: o servidor interno recebia GET /robots.txt).
  await assertPublicHost(url);

  // O robots.txt checa o MESMO host já validado acima, então não precisa
  // terminar antes do download: os dois são independentes e o robots custa
  // uma ida inteira à rede (120-380ms medidos em dev/_perfil.mjs). Dispara os
  // dois juntos e cobra a decisão no fim — se negar, o corpo baixado é
  // descartado e nada entra no cache, exatamente como antes.
  const robotsEmCurso = checarRobots(url);
  // Se o download falhar primeiro, ninguém vai esperar o robots: a rejeição
  // dele não pode virar "unhandled rejection" e derrubar o processo.
  robotsEmCurso.catch(() => {});

  // Ordem importa: o teto POR HOST vem por fora e o global por dentro. Assim,
  // quem espera na fila do próprio host NÃO segura vaga global — no pior caso,
  // um único site com centenas de pedidos em fila não entope a concorrência
  // dos outros. (Invertido, os pedidos em fila do host consumiriam vagas
  // globais enquanto esperam e a justiça entre sites iria por água abaixo.)
  //
  // Revalidação condicional: se há validador guardado desta URL, manda
  // If-None-Match/If-Modified-Since. Um 304 reaquece a entrada com o payload
  // que já estava aqui — sem baixar o corpo de novo. Vale tanto para a
  // revalidação em segundo plano (SWR) quanto para o vencimento comum do TTL.
  const condicional = validadoresHttp.get(cacheKey) || null;
  if (condicional) {
    revalidacaoCondicional.tentadas++;
  }
  let payload;
  try {
    payload = await limitesPorHost.executar(hostOf(url), () =>
      limiteSaida.executar(() =>
        fetchTextWithFallback(url, { timeoutMs, signal, retries, condicional, decodificar: !extrair, maxBytes, permitirCorte: permissoDeCorte })
      )
    );
  } catch (err) {
    // Falha permanente (404, 410, 403...): lembra para não repagar a conexão
    // na próxima chamada da mesma URL. O erro sobe igual — o que muda é só
    // que, da segunda vez em diante, ele sai da memória sem ir à rede.
    guardarNegativo(cacheKey, err);
    throw err;
  }

  // O robots rodou em paralelo com o download; aqui a decisão dele é cobrada.
  // Negado => RobotBloqueadoError sobe e o corpo baixado é descartado sem
  // entrar no cache (mesmo efeito de antes, só sem somar as duas latências).
  await robotsEmCurso;

  // Tamanho real do documento fica lembrado para a próxima leitura da MESMA
  // página decidir de primeira.
  lembrarTamanho(cacheKey, payload);

  // Gravação no cache (com a transformação opcional do PDF, quando houver).
  return guardarNoCache({ cacheKey, payload, extrair });
}

/**
 * Stale-while-revalidate: atualiza uma entrada vencida em segundo plano, sem
 * bloquear quem já foi servido com a versão em cache. Passa pela junção em
 * voo — uma rajada no vencimento vira UMA revalidação. A contagem é feita
 * DENTRO do callback: `tentadas` conta revalidações que de fato iniciaram,
 * não pedidos que a pediram (a rajada toda colapsa em uma). Erros são
 * engolidos: falhou, a entrada vencida segue valendo até sair da janela.
 */
function revalidarEmSegundoPlano(chave, url, { timeoutMs, retries } = {}) {
  coalescedorDeBuscas
    .executar(chave, () => {
      revalidacoes.tentadas++;
      return buscarEAquecer(url, { timeoutMs, retries, revalidacao: true, chave }).catch((err) => {
        revalidacoes.falhas++;
        throw err;
      });
    })
    .catch(() => {
      // registrada em falhas; quem está sendo servido já recebeu a versão vencida
    });
}

/**
 * Fetch com cache LRU + TTL, junção de buscas em voo e (com CACHE_SWR=1)
 * revalidação em segundo plano. Valida segurança (SSRF + robots) ANTES de
 * baixar. Entrada vencida: sem SWR, busca de novo; com SWR, serve a vencida
 * na hora e atualiza atrás.
 *
 * A junção é o que segura a rajada: N pedidos simultâneos da MESMA URL viram
 * 1 download e todos recebem a mesma resposta — sem ela, cada pedido disparava
 * o próprio fetch até o cache esquentar, multiplicando trabalho na hora
 * crítica. O timeout/sinal é o de quem INICIA a busca; quem carona recebe o
 * resultado dela.
 */
export async function fetchTextCached(url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, retries } = {}) {
  // A chave do cache/da junção é a URL CANÔNICA: duas variações da mesma
  // página (com/sem utm_*, parâmetros em ordem diferente) compartilham uma
  // entrada — um download só. A URL original segue no payload (finalUrl).
  const chave = chaveCanonica(url);
  const hit = pageCache.get(chave);
  if (hit) {
    if (hit.stale) revalidarEmSegundoPlano(chave, url, { timeoutMs, retries });
    return hit.payload;
  }
  return coalescedorDeBuscas.executar(chave, () => buscarEAquecer(url, { timeoutMs, signal, retries, chave }));
}

/**
 * Fetch para as ferramentas que precisam do DOCUMENTO INTEIRO:
 * extract_links, find_on_page e diff_page.
 *
 * Diferença para `fetchTextCached`: aqui o teto é MAX_RESPONSE_BYTES_DOCUMENTO
 * (24 MB) em vez do teto duro de 5 MB, e acima dele o download é CORTADO e
 * sinalizado (`cortado: true`) em vez de virar erro. Antes, uma página de 8 MB
 * fazia essas três ferramentas falharem por completo enquanto o read_page lia a
 * mesma URL normalmente — devolver o parcial com aviso é o comportamento certo
 * para quem pediu "liste os links" ou "ache este termo".
 *
 * O corte NÃO entra no cache (ver `guardarNoCache`): HTML truncado envenenaria
 * toda leitura futura da mesma URL. Ou seja, a segunda chamada paga o download
 * de novo — é o preço de não guardar documento incompleto.
 */
export async function fetchTextDocumentoCached(url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, retries } = {}) {
  const chave = chaveCanonica(url);
  const hit = pageCache.get(chave);
  if (hit) {
    if (hit.stale) revalidarEmSegundoPlano(chave, url, { timeoutMs, retries });
    return hit.payload;
  }
  return coalescedorDeBuscas.executar(chave, async () => {
    const quente = pageCache.get(chave);
    if (quente && !quente.stale) return quente.payload;
    return await buscarEAquecer(url, {
      timeoutMs,
      signal,
      retries,
      chave,
      maxBytes: MAX_RESPONSE_BYTES_DOCUMENTO,
      // O documento inteiro importa aqui: cortar é aceitável só como último
      // recurso, para não perder a chamada toda.
      permissoDeCorte: true,
    });
  });
}

/**
 * Baixa um PDF e devolve os bytes CRUS, com o mesmo cache/junção/segurança da
 * leitura de HTML. O conteúdo é binário: `text` fica vazio e `buffer` é o PDF.
 * O cache guarda o resultado já extraído quando `extrair` é passado (o leitor
 * de PDF passa a função de extração) — assim uma releitura não reparseia.
 */
export async function fetchPdfCached(url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, retries, extrair } = {}) {
  const chave = chaveCanonica(url);
  const hit = pageCache.get(chave);
  if (hit) {
    if (hit.stale) revalidarEmSegundoPlano(chave, url, { timeoutMs, retries });
    return hit.payload;
  }
  return coalescedorDeBuscas.executar(chave, () =>
    buscarEAquecer(url, { timeoutMs, signal, retries, chave, extrair })
  );
}

/**
 * Estatísticas do cache.
 */
export function cacheStats() {
  return pageCache.stats();
}
