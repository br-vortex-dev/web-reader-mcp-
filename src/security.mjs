/**
 * Segurança: proteção SSRF, robots.txt, DNS rebinding e agent validado.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import http from "node:http";
import {
  ALLOW_PRIVATE_HOSTS,
  HOST_CHECK_TTL_MS,
  HOST_CHECK_MAX_ENTRIES,
  AGENT_CACHE_MAX,
  ROBOTS_RESPECT,
  ROBOTS_TTL_MS,
  ROBOTS_TIMEOUT_MS,
  ROBOTS_NEGATIVE_TTL_MS,
  ROBOTS_MAX_BYTES,
  ROBOTS_MAX_ORIGINS,
} from "./config.mjs";
import {
  UrlInvalidaError,
  HostBloqueadoError,
  HostNaoResolvidoError,
  RobotsBloqueadoError,
} from "./errors.mjs";

/* ===================================================================== *
 * Proteção SSRF                                                             *
 * ===================================================================== */

/**
 * Verifica se um IPv4 é privado/reservado.
 */
function isBlockedIpv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * Converte dois hextets (16 bits cada) para IPv4 legível.
 */
function hextetsToIpv4(hi, lo) {
  const h = parseInt(hi, 16);
  const l = parseInt(lo, 16);
  if (!Number.isInteger(h) || !Number.isInteger(l)) return null;
  return `${h >> 8}.${h & 0xff}.${l >> 8}.${l & 0xff}`;
}

/**
 * Exibe um IPv6 com IPv4 embutido na forma legível: ::ffff:127.0.0.1 em vez de ::ffff:7f00:1.
 */
function ipv6ParaExibicao(ip) {
  const m = ip.toLowerCase().match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) {
    const v4 = hextetsToIpv4(m[1], m[2]);
    if (v4) return `::ffff:${v4}`;
  }
  return ip;
}

/**
 * Extrai o IPv4 embutido num IPv6: mapeado (::ffff:), NAT64 (64:ff9b::) e 6to4 (2002::/16).
 */
function embeddedIpv4(ip) {
  const lower = ip.toLowerCase();
  const dotted = lower.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  let m = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) return hextetsToIpv4(m[1], m[2]);
  m = lower.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) return hextetsToIpv4(m[1], m[2]);
  m = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})/);
  if (m) return hextetsToIpv4(m[1], m[2]);
  return null;
}

/**
 * Verifica se um IPv6 é interno (:: e ::1, fe80::/10, fc00::/7, ff00::/8).
 */
function isBlockedIpv6(ip) {
  const lower = ip.toLowerCase().split("%")[0];
  if (lower === "::" || lower === "::1") return true;
  const embedded = embeddedIpv4(lower);
  if (embedded) return isBlockedIpv4(embedded);
  if (/^fe[89ab]/.test(lower)) return true;
  const first = lower.split(":")[0];
  if (first.length >= 2) {
    const b0 = parseInt(first.padStart(4, "0").slice(0, 2), 16);
    if ((b0 & 0xfe) === 0xfc) return true;
    if (b0 === 0xff) return true;
  }
  return false;
}

/**
 * Devolve o próprio endereço quando ele deve ser bloqueado, ou null.
 */
function blockedAddress(address) {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address) ? address : null;
  if (family === 6) return isBlockedIpv6(address) ? address : null;
  return address;
}

// Cache curto das validações de host.
const hostCheckCache = new Map();

/**
 * Resolve o host e recusa endereço privado/interno.
 * Proteção contra DNS rebinding: o fetch nunca resolve DNS de novo.
 */
export async function assertPublicHost(url) {
  if (ALLOW_PRIVATE_HOSTS) return null;

  let hostname;
  try {
    hostname = new URL(String(url)).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    throw new UrlInvalidaError(url);
  }

  const cached = hostCheckCache.get(hostname);
  if (cached && Date.now() - cached.at < HOST_CHECK_TTL_MS) {
    if (cached.blocked) throw new HostBloqueadoError(hostname, ipv6ParaExibicao(cached.blocked));
    return cached.ip || null;
  }

  let addresses;
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await lookup(hostname, { all: true })).map((entry) => entry.address);
    } catch {
      throw new HostNaoResolvidoError(hostname);
    }
  }
  if (addresses.length === 0) throw new HostNaoResolvidoError(hostname);

  for (const address of addresses) {
    const blocked = blockedAddress(address);
    if (blocked) {
      hostCheckCache.set(hostname, { at: Date.now(), blocked });
      if (hostCheckCache.size > HOST_CHECK_MAX_ENTRIES) {
        hostCheckCache.delete(hostCheckCache.keys().next().value);
      }
      throw new HostBloqueadoError(hostname, ipv6ParaExibicao(blocked));
    }
  }
  hostCheckCache.set(hostname, { at: Date.now(), blocked: null, ip: addresses[0] });
  if (hostCheckCache.size > HOST_CHECK_MAX_ENTRIES) {
    hostCheckCache.delete(hostCheckCache.keys().next().value);
  }
  return addresses[0];
}

// Cache de agents HTTP/HTTPS por IP (keep-alive).
const agentCache = new Map();

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
    const maisAntigo = agentCache.keys().next().value;
    const old = agentCache.get(maisAntigo);
    agentCache.delete(maisAntigo);
    try { old.destroy(); } catch { /* já destruído */ }
  }
  agentCache.set(cacheKey, agent);
  return agent;
}

/* ===================================================================== *
 * robots.txt                                                                *
 * ===================================================================== */

// origem -> { at, grupos|null }. grupos=null significa fail-open.
const robotsCache = new Map();
const robotsEmVoo = new Map();
const robotsRegexCache = new Map();

/**
 * Processa o texto do robots.txt e extrai os grupos de regras.
 */
function robotsGruposDoTexto(texto) {
  const grupos = [];
  let grupo = null;
  let ultimoCampo = "";
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.replace(/#.*/, "").trim();
    if (!linha) continue;
    const i = linha.indexOf(":");
    if (i < 0) continue;
    const campo = linha.slice(0, i).trim().toLowerCase();
    const valor = linha.slice(i + 1).trim();
    if (campo === "user-agent") {
      if (!grupo || ultimoCampo !== "user-agent") {
        grupo = { agentes: [], regras: [] };
        grupos.push(grupo);
      }
      grupo.agentes.push(valor.toLowerCase());
    } else if (campo === "allow" || campo === "disallow") {
      if (grupo && valor) grupo.regras.push({ tipo: campo, valor });
    }
    ultimoCampo = campo;
  }
  return grupos;
}

/**
 * Extrai as regras aplicáveis ao user-agent "*".
 */
function robotsRegrasAplicaveis(grupos) {
  const grupo = grupos.find((g) => g.agentes.includes("*"));
  return grupo ? grupo.regras : null;
}

/**
 * Converte um padrão do robots.txt para regex, com cache.
 */
function robotsPadraoParaRegex(padrao) {
  const cache = robotsRegexCache.get(padrao);
  if (cache) return cache;
  const terminaCifrao = padrao.endsWith("$");
  const corpo = terminaCifrao ? padrao.slice(0, -1) : padrao;
  let corpoRe = "";
  for (const ch of corpo) {
    if (ch === "*") corpoRe += "[\\s\\S]*";
    else corpoRe += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  const re = new RegExp("^" + corpoRe + (terminaCifrao ? "$" : ""));
  if (robotsRegexCache.size > 2000) robotsRegexCache.clear();
  robotsRegexCache.set(padrao, re);
  return re;
}

/**
 * Devolve { permite, regra }. Empate de tamanho: Allow ganha.
 */
function robotsPermite(regras, caminho) {
  if (!regras || regras.length === 0) return { permite: true };
  let vencedora = null;
  for (const regra of regras) {
    if (!robotsPadraoParaRegex(regra.valor).test(caminho)) continue;
    if (
      !vencedora ||
      regra.valor.length > vencedora.valor.length ||
      (regra.valor.length === vencedora.valor.length && regra.tipo === "allow")
    ) {
      vencedora = regra;
    }
  }
  if (!vencedora) return { permite: true };
  return { permite: vencedora.tipo === "allow", regra: vencedora.valor };
}

/**
 * Lê o corpo do robots.txt em streaming, cortando ao passar de ROBOTS_MAX_BYTES.
 * O `res.text()` carregaria o corpo inteiro antes de qualquer conferência; um
 * robots.txt gigante (ou uma resposta que nao e robots.txt) entao custaria
 * memoria a toa. Acima do teto devolve null, que o caller trata como fail-open.
 */
async function lerRobotsComTeto(res) {
  const corpo = res.body;
  if (!corpo) return null;
  const reader = corpo.getReader();
  const pedacos = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ROBOTS_MAX_BYTES) return null;
      pedacos.push(Buffer.from(value));
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // corpo ja encerrado
    }
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(pedacos, total));
}

/**
 * Busca e processa o robots.txt de uma origem. Fail-open.
 * Usa fetch global diretamente para evitar dependência circular com fetch.mjs.
 */
async function robotsDaOrigem(origem) {
  const agora = Date.now();
  const hit = robotsCache.get(origem);
  if (hit && agora - hit.at < (hit.grupos ? ROBOTS_TTL_MS : ROBOTS_NEGATIVE_TTL_MS)) return hit;
  const emVoo = robotsEmVoo.get(origem);
  if (emVoo) return emVoo;

  const busca = (async () => {
    let entrada = { at: Date.now(), grupos: null };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
      const res = await fetch(`${origem}/robots.txt`, {
        signal: controller.signal,
        headers: { "User-Agent": "web-reader-mcp" },
      });
      clearTimeout(timer);
      if (res.ok) {
        const text = await lerRobotsComTeto(res);
        // null = passou do teto: sem regra para cumprir, fica o fail-open.
        if (text !== null) entrada = { at: Date.now(), grupos: robotsGruposDoTexto(text) };
      }
    } catch {
      // inacessível/4xx/5xx/grande demais: fica o fail-open
    }
    robotsEmVoo.delete(origem);
    robotsCache.set(origem, entrada);
    while (robotsCache.size > ROBOTS_MAX_ORIGINS) {
      const maisAntiga = robotsCache.keys().next().value;
      robotsCache.delete(maisAntiga);
    }
    return entrada;
  })();
  robotsEmVoo.set(origem, busca);
  return busca;
}

/**
 * Verifica se uma URL pode ser acessada segundo o robots.txt da origem.
 */
export async function checarRobots(url) {
  if (!ROBOTS_RESPECT) return;
  let alvo;
  try {
    alvo = new URL(url);
  } catch {
    return;
  }
  if (alvo.protocol !== "http:" && alvo.protocol !== "https:") return;
  const entrada = await robotsDaOrigem(`${alvo.protocol}//${alvo.host}`);
  if (!entrada || !entrada.grupos) return;
  const decisao = robotsPermite(
    robotsRegrasAplicaveis(entrada.grupos),
    alvo.pathname + alvo.search
  );
  if (!decisao.permite) {
    throw new RobotsBloqueadoError(alvo.host, alvo.pathname, decisao.regra);
  }
}
