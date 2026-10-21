/**
 * Transporte de saída com IP fixado (node:http/https) + apoio de leitura.
 *
 * Por que não o fetch global: o fetch do Node IGNORA a opção `agent` — o DNS
 * do host seria resolvido DE NOVO na hora de conectar, e a proteção contra
 * DNS rebinding viraria enfeite (prova: dev/_probe-agent.mjs). Aqui a conexão
 * sai por node:http/https com um Agent cujo lookup devolve SEMPRE o IP já
 * validado por assertPublicHost: o nome nunca é resolvido uma segunda vez.
 *
 * O resto do módulo é o que o fetch fazia sozinho e agora fica explícito:
 * descompressão (gzip/deflate/br), leitura com teto em bytes e descarte de
 * corpos que não interessam (redirects e respostas de erro).
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: uma URL já validada por assertPublicHost.
 *   Sai:   a resposta crua (status, headers, corpo) ou os bytes já
 *          descomprimidos — sem julgar conteúdo.
 *
 * QUEM USA
 *   Usado por: fetch (o único que baixa) e security.
 *   Importa de: config, errors.
 */

import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { Transform } from "node:stream";
import { isIP } from "node:net";
import { AGENT_CACHE_MAX } from "./config.mjs";
import { UrlInvalidaError, RedeError, RespostaMuitoGrandeError, WebReaderError } from "./errors.mjs";

/* ===================================================================== *
 * Agents (keep-alive, IP fixado)                                          *
 * ===================================================================== */

// Cache de agents HTTP/HTTPS por IP validado.
const agentCache = new Map();

// Agents sem pinagem (ALLOW_PRIVATE_HOSTS=1): um por protocolo.
const agentesGenericos = new Map();

/**
 * Um agent está ocioso quando não tem socket aberto nem pedido na fila.
 * É o critério de evicção: só um agent ocioso pode ser destruído sem perda.
 */
function agentOcioso(agent) {
  const soma = (mapa) =>
    Object.values(mapa || {}).reduce((n, lista) => n + (lista ? lista.length : 0), 0);
  return soma(agent.sockets) === 0 && soma(agent.requests) === 0;
}

/**
 * Cria ou reutiliza um Agent HTTP/HTTPS para um IP validado.
 * O Agent sobrescreve o lookup padrão para retornar sempre o IP validado.
 */
export function agentValidado(url, ipValido) {
  const family = isIP(ipValido);
  const isHttps = url.startsWith("https:");
  const cacheKey = `${isHttps ? "https" : "http"}:${ipValido}`;
  let agent = agentCache.get(cacheKey);
  if (agent) return agent;
  const opts = {
    lookup(hostname, options, callback) {
      if (options.all) {
        callback(null, [{ address: ipValido, family }]);
      } else {
        callback(null, ipValido, family);
      }
    },
    maxSockets: 32,
    maxFreeSockets: 16,
    keepAlive: true,
    keepAliveMsecs: 30000,
  };
  agent = isHttps ? new https.Agent(opts) : new http.Agent(opts);
  if (agentCache.size >= AGENT_CACHE_MAX) {
    // Evicção: destruir um agent com requisição em voo derrubaria o
    // download no meio do caminho (os sockets são destruídos junto). Então:
    // prefere-se um agent OCIOSO (sem socket ativo nem pedido pendente); se
    // todos estiverem ocupados, o mais antigo sai do cache SEM destroy — as
    // conexões dele morrem sozinhas no timeout de keep-alive, e quem está em
    // voo completa a leitura normalmente.
    let alvo = null;
    for (const [chave, candidato] of agentCache) {
      if (agentOcioso(candidato)) {
        alvo = chave;
        break;
      }
    }
    if (alvo === null) alvo = agentCache.keys().next().value;
    const old = agentCache.get(alvo);
    agentCache.delete(alvo);
    if (old && agentOcioso(old)) {
      try { old.destroy(); } catch { /* já destruído */ }
    }
  }
  agentCache.set(cacheKey, agent);
  return agent;
}

/** Agent genérico (sem pinagem) — usado só com ALLOW_PRIVATE_HOSTS=1. */
function agenteGenerico(url) {
  const protocolo = url.startsWith("https:") ? "https" : "http";
  let agent = agentesGenericos.get(protocolo);
  if (!agent) {
    const opts = { maxSockets: 32, maxFreeSockets: 16, keepAlive: true, keepAliveMsecs: 30000 };
    agent = protocolo === "https" ? new https.Agent(opts) : new http.Agent(opts);
    agentesGenericos.set(protocolo, agent);
  }
  return agent;
}

/* ===================================================================== *
 * Requisição de um salto (sem seguir redirect)                            *
 * ===================================================================== */

/**
 * GET de UM salto pelo transporte pinado. Não segue redirect: quem chama
 * decide o próximo passo (e valida o destino antes de seguir).
 *
 * Devolve { statusCode, statusMessage, headers, stream } — `stream` é o
 * corpo do node (ainda comprimido, se for o caso).
 */
export function httpGetUmSalto(url, { headers = {}, ipValido = null, signal } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new UrlInvalidaError(url));
      return;
    }
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    let req;
    try {
      req = lib.get(
        {
          protocol: parsed.protocol,
          // IPv6 literal vem entre colchetes na URL ("[::1]"); o socket
          // espera o endereço cru — os colchetes voltam no header Host.
          hostname: parsed.hostname.replace(/^\[|\]$/g, ""),
          port: parsed.port || (isHttps ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          headers,
          agent: ipValido ? agentValidado(url, ipValido) : agenteGenerico(url),
          signal,
        },
        (stream) => {
          resolve({
            statusCode: stream.statusCode || 0,
            statusMessage: stream.statusMessage || "",
            headers: stream.headers,
            stream,
          });
        }
      );
    } catch (err) {
      reject(err);
      return;
    }
    req.on("error", reject);
  });
}

/* ===================================================================== *
 * Leitura do corpo                                                        *
 * ===================================================================== */

const CODIGOS_ZLIB = new Set(["Z_DATA_ERROR", "Z_STREAM_ERROR", "Z_BUF_ERROR", "Z_NEED_DICT"]);

/**
 * Descompressor de "deflate" que aceita também o fluxo CRU.
 *
 * O RFC 9110 diz que `Content-Encoding: deflate` é o formato zlib, com o
 * cabeçalho de 2 bytes na frente. Só que existe servidor — e não é raro —
 * mandando o fluxo deflate CRU, sem cabeçalho nenhum. O `createInflate`
 * recusa esse corpo com Z_DATA_ERROR, e a página inteira virava
 * `RedeError: falha ao descomprimir a resposta`. O fetch do navegador faz
 * fallback para o modo cru justamente por causa disso.
 *
 * Aqui a escolha é feita ANTES de descomprimir, olhando os dois primeiros
 * bytes: um cabeçalho zlib válido tem método 8 (deflate), janela até 32 KB
 * e o checksum de 16 bits (CMF*256+FLG) divisível por 31. Se não bater, é
 * fluxo cru e vai para o `createInflateRaw`. Nada é tentado às cegas e
 * nenhum byte é lido duas vezes.
 */
class DescompressorDeflate extends Transform {
  constructor() {
    super();
    this._pendente = Buffer.alloc(0);
    this._alvo = null;
  }

  /** Abre o inflate certo para o que já chegou (2 bytes bastam). */
  _escolher() {
    const cmf = this._pendente.length > 0 ? this._pendente[0] : 0;
    const flg = this._pendente.length > 1 ? this._pendente[1] : 0;
    const cabecalhoZlib = (cmf & 0x0f) === 8 && cmf >> 4 <= 7 && (((cmf << 8) | flg) % 31) === 0;
    this._alvo = cabecalhoZlib ? zlib.createInflate() : zlib.createInflateRaw();
    this._alvo.on("data", (pedaco) => this.push(pedaco));
    this._alvo.on("error", (err) => this.destroy(err));
  }

  _transform(pedaco, _enc, cb) {
    if (!this._alvo) {
      this._pendente = Buffer.concat([this._pendente, pedaco]);
      // Com menos de 2 bytes não há como decidir o formato: segura e espera.
      if (this._pendente.length < 2) return cb();
      this._escolher();
      const inicial = this._pendente;
      this._pendente = Buffer.alloc(0);
      if (this._alvo.write(inicial)) return cb();
      return this._alvo.once("drain", () => cb());
    }
    if (this._alvo.write(pedaco)) return cb();
    this._alvo.once("drain", () => cb());
  }

  _flush(cb) {
    // Corpo com 0 ou 1 byte: decide com o que houver (vai falhar no inflate,
    // virando RedeError — que é o certo para um fluxo deflate truncado).
    if (!this._alvo) {
      this._escolher();
      const inicial = this._pendente;
      this._pendente = Buffer.alloc(0);
      this._alvo.write(inicial);
    }
    this._alvo.once("end", () => cb());
    this._alvo.end();
  }

  _destroy(err, cb) {
    if (this._alvo && !this._alvo.destroyed) {
      try {
        this._alvo.destroy();
      } catch {
        // já destruído
      }
    }
    cb(err);
  }
}

/**
 * Embrulha o stream no descompressor do content-encoding (headers à parte,
 * porque quem chama já pode ter desacoplado o corpo da resposta).
 * Encoding desconhecido sai como veio (mesmo comportamento do fetch).
 */
export function desembrulhar(stream, headers) {
  const enc = String((headers && headers["content-encoding"]) || "").trim().toLowerCase();
  if (!enc || enc === "identity") return stream;
  let filtro = null;
  if (enc === "gzip" || enc === "x-gzip") filtro = zlib.createGunzip();
  else if (enc === "br") filtro = zlib.createBrotliDecompress();
  else if (enc === "deflate" || enc === "x-deflate") filtro = new DescompressorDeflate();
  else return stream;
  // O erro é lido no for-await do coletor; o listener evita "unhandled error"
  // na janela entre o pipe e a leitura começar.
  filtro.on("error", () => {});
  // Leitura interrompida no meio (abort, teto de bytes, erro): o filtro fecha
  // sem ter terminado — solta o stream de baixo em vez de deixar pendurado.
  filtro.on("close", () => {
    if (!filtro.readableEnded && !stream.destroyed) stream.destroy();
  });
  stream.on("error", (err) => filtro.destroy(err));
  stream.pipe(filtro);
  return filtro;
}

/**
 * Converte o erro cru de uma leitura para o vocabulário do projeto:
 * abort (timeout/orçamento) vira AbortError com o motivo em `cause` — quem
 * classifica é o classificarErro do fetch —, erro do zlib vira RedeError
 * legível, e o resto passa como veio.
 */
function normalizarErroDeLeitura(err, signal, url) {
  if (err instanceof WebReaderError) return err;
  if (signal && signal.aborted) {
    const abortado = new Error("abortado");
    abortado.name = "AbortError";
    abortado.cause = signal.reason;
    return abortado;
  }
  if (err && CODIGOS_ZLIB.has(err.code)) {
    return new RedeError(`falha ao descomprimir a resposta (${err.code})`, url, err);
  }
  return err;
}

/**
 * Consome um stream com teto de bytes. `aoChunk(bytesLidos)` (opcional) é
 * chamado ANTES de aceitar cada pedaço — é o gancho do orçamento de memória,
 * que assim acompanha os bytes REAIS, sem confiar no content-length.
 */
export async function coletarComTeto(fonte, { maxBytes, url = "URL desconhecida", signal, aoChunk, permitirCorte = false } = {}) {
  const chunks = [];
  let total = 0;
  let cortado = false;
  try {
    for await (const pedaco of fonte) {
      const pedacoBuf = Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(pedaco);
      if (total + pedacoBuf.length > maxBytes) {
        // Teto estourado. Sem `permitirCorte`, é erro (comportamento de sempre:
        // quem precisa do documento INTEIRO — links, sitemap, busca no texto —
        // não pode receber um pedaço e achar que leu tudo).
        if (!permitirCorte) {
          throw new RespostaMuitoGrandeError(maxBytes, url);
        }
        // Com `permitirCorte`, guarda o que coube, sinaliza e para de ler. O
        // resto do corpo é descartado sem drenar (um corpo infinito não pode
        // segurar a vaga de admissão).
        const falta = maxBytes - total;
        if (falta > 0) {
          const parcial = pedacoBuf.subarray(0, falta);
          if (aoChunk) await aoChunk(total + parcial.length);
          chunks.push(parcial);
          total += parcial.length;
        }
        cortado = true;
        descartarCorpo(fonte);
        break;
      }
      if (aoChunk) await aoChunk(total + pedacoBuf.length);
      chunks.push(pedacoBuf);
      total += pedacoBuf.length;
    }
  } catch (err) {
    try {
      fonte.destroy();
    } catch {
      // stream já destruído
    }
    throw normalizarErroDeLeitura(err, signal, url);
  }
  const buffer = Buffer.concat(chunks, total);
  // Propriedade não-enumerável: o retorno continua sendo um Buffer (nada que
  // já consumia coletarComTeto muda), e quem quiser sabe que houve corte.
  if (cortado) Object.defineProperty(buffer, "cortado", { value: true, enumerable: false });
  return buffer;
}

/**
 * Descarta um corpo que não interessa (redirect, resposta de erro).
 * Destruir em vez de drenar: um corpo de redirect é lixo — drenar por inteiro
 * abria porta para um corpo infinito pendurar o salto (e a vaga de admissão).
 * O listener no-op cobre o erro do socket derrubado no meio (já não importa).
 */
export function descartarCorpo(stream) {
  try {
    stream.on("error", () => {});
    stream.destroy();
  } catch {
    // já fechado
  }
}
