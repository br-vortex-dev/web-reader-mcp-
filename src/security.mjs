/**
 * security.mjs — os dois portões que toda URL precisa passar.
 *
 * O QUE É
 *   1. assertPublicHost: recusa host privado/loopback/link-local e protege
 *      contra DNS rebinding (o nome resolve para um IP, e é ESSE IP que vai
 *      ser usado na conexão — não uma segunda resolução que poderia devolver
 *      outra coisa).
 *   2. checarRobots: lê o robots.txt do site e diz se o caminho pedido é
 *      permitido para o nosso User-Agent, com cache e fail-open quando o
 *      robots está inacessível.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: uma URL (e, no robots, o user-agent).
 *   Sai:   nada, se passou — a função LANÇA erro tipado se bloqueou. Quem
 *          chama não precisa checar retorno: passar da chamada é a permissão.
 *
 * POR QUE LANÇA EM VEZ DE DEVOLVER FALSE
 *   Porque o caso de erro é o caminho raro e precisa de motivo explícito na
 *   resposta ao cliente MCP. Com `return false`, alguém esquece de checar e
 *   a requisição sai mesmo assim.
 *
 * O Agent com IP fixado vive em net.mjs, junto do transporte que o usa.
 *
 * QUEM USA
 *   Usado por: fetch (que é usado por todos os outros).
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  ALLOW_PRIVATE_HOSTS,
  HOST_CHECK_TTL_MS,
  HOST_CHECK_MAX_ENTRIES,
  ROBOTS_RESPECT,
  ROBOTS_TTL_MS,
  ROBOTS_TIMEOUT_MS,
  ROBOTS_NEGATIVE_TTL_MS,
  ROBOTS_MAX_BYTES,
  ROBOTS_MAX_ORIGINS,
  ROBOTS_MAX_REGRAS,
  ROBOTS_MAX_CONCURRENCY,
  DNS_TIMEOUT_MS,
} from "./config.mjs";
import {
  UrlInvalidaError,
  HostBloqueadoError,
  HostNaoResolvidoError,
  RobotsBloqueadoError,
} from "./errors.mjs";
import { criarLimitador } from "./utils.mjs";
import { httpGetUmSalto, coletarComTeto, desembrulhar, descartarCorpo } from "./net.mjs";

/* ===================================================================== *
 * Proteção SSRF                                                             *
 * ===================================================================== */

/**
 * Verifica se um IPv4 é privado/reservado.
 * Inclui as faixas de documentação/teste (TEST-NET-1/2/3 e benchmark):
 * nenhum servidor real vive nelas — um host que resolve para lá só pode ser
 * teste de SSRF ou configuração quebrada.
 */
function isBlockedIpv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF)
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmark)
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true;
  return false;
}

/**
 * Expande um IPv6 para os 8 hextets numéricos, independente da notação.
 *
 * A checagem antiga casava padrões de TEXTO (`::ffff:h:l`, `2002:h:l`), então
 * a mesma faixa escrita de forma expandida (`0:0:0:0:0:ffff:7f00:1`) passava
 * batido. O URL do WHATWG comprime a forma expandida, mas a resolução de DNS
 * pode devolver qualquer notação — e uma defesa de SSRF não pode depender de
 * quem escreveu o endereço. Devolve null para algo que não é IPv6.
 */
function hextetsDoIpv6(ip) {
  let texto = String(ip).toLowerCase().split("%")[0];
  let v4 = null;
  const dotted = texto.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const p = dotted[1].split(".").map(Number);
    if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    v4 = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]];
    texto = texto.slice(0, dotted.index);
    // Se o prefixo termina em "::" (ex.: 64:ff9b::1.2.3.4), a compressão já
    // inclui os zeros e o "::" NÃO é o separador do IPv4; cortar um ":" aqui
    // deixaria a notação inválida. Só o caso "hextet:" pede o corte.
    if (!texto.endsWith("::")) texto = texto.replace(/:$/, "");
  }
  const partes = texto.split("::");
  if (partes.length > 2) return null;
  const analisar = (s) => (s === "" ? [] : s.split(":"));
  const esq = analisar(partes[0]);
  const dir = partes.length === 2 ? analisar(partes[1]) : [];
  const total = esq.length + dir.length + (v4 ? 2 : 0);
  if (partes.length === 1) {
    if (total !== 8) return null;
  } else if (total >= 8) {
    return null; // "::" tem de representar ao menos um grupo
  }
  const brutos = [...esq, ...new Array(8 - total).fill("0"), ...dir, ...(v4 || []).map(String)];
  if (brutos.length !== 8) return null;
  const nums = brutos.map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  if (nums.some((n) => !Number.isInteger(n))) return null;
  return nums;
}

/** Dois hextets (16 bits cada) para IPv4 legível. */
function ipv4DosHextets(hi, lo) {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * Extrai o IPv4 embutido num IPv6: mapeado (::ffff:), compatível (::a.b.c.d),
 * traduzido (::ffff:0:a.b.c.d), NAT64 (64:ff9b::) e 6to4 (2002::/16).
 */
function embeddedIpv4DosHextets(h) {
  if (h.slice(0, 5).every((n) => n === 0) && h[5] === 0xffff) return ipv4DosHextets(h[6], h[7]);
  if (h.slice(0, 6).every((n) => n === 0) && (h[6] !== 0 || h[7] !== 0)) return ipv4DosHextets(h[6], h[7]);
  // IPv4 traduzido, ::ffff:0:a.b.c.d: os quatro primeiros hextets são zero e o
  // QUINTO é ffff. A checagem antiga olhava o quarto — a faixa inteira
  // (::ffff:0:0/96) passava como IPv6 público e um host que resolvesse para
  // ::ffff:0:7f00:1 alcançava 127.0.0.1.
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0xffff && h[5] === 0) {
    return ipv4DosHextets(h[6], h[7]);
  }
  if (h[0] === 0x0064 && h[1] === 0xff9b && h.slice(2, 6).every((n) => n === 0)) {
    return ipv4DosHextets(h[6], h[7]);
  }
  if (h[0] === 0x2002) return ipv4DosHextets(h[1], h[2]);
  return null;
}

/**
 * Verifica se um IPv6 é interno (:: e ::1, fe80::/10, fec0::/10, fc00::/7,
 * ff00::/8), incluindo os IPv4 embutidos (mapeado, compatível, NAT64, 6to4 e
 * o Teredo). Endereço ilegível bloqueia: na dúvida, não sai.
 */
function isBlockedIpv6(ip) {
  const h = hextetsDoIpv6(ip);
  if (!h) return true;
  // :: e ::1 (e qualquer ::x com x <= 1, que é reservado)
  if (h.slice(0, 7).every((n) => n === 0) && h[7] <= 1) return true;
  const embedded = embeddedIpv4DosHextets(h);
  if (embedded) return isBlockedIpv4(embedded);
  // Faixas especiais que nunca são destino de leitura legítima: NAT64 local
  // (64:ff9b:1::/48) e os prefixos de documentação (2001:db8::/32).
  if (h[0] === 0x0064 && h[1] === 0xff9b && h[2] === 0x0001) return true;
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;
  // Teredo (2001::/32): o pacote termina num relay que fala IPv4 — se o
  // servidor embutido (h2/h3) ou o cliente ofuscado (h6/h7) for privado, o
  // destino efetivo pode ser interno.
  if (h[0] === 0x2001 && h[1] === 0x0000) {
    const servidor = ipv4DosHextets(h[2], h[3]);
    const cliente = ipv4DosHextets(h[6] ^ 0xffff, h[7] ^ 0xffff);
    if (isBlockedIpv4(servidor) || isBlockedIpv4(cliente)) return true;
  }
  if ((h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0) return true; // link-local / site-local
  if ((h[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
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

// Junção de resoluções de DNS em voo: N pedidos do MESMO host esperam o mesmo
// getaddrinfo em vez de enfileirar N lookups na thread pool (4 threads). Sem
// isso, uma rajada em hosts distintos satura o pool e o DNS vira gargalo.
const dnsEmVoo = new Map();

/**
 * Resolve um host com teto de tempo e junção em voo.
 *
 * O `lookup` do Node não é cancelável: um resolver que não responde deixaria a
 * promessa pendurada para sempre — e a vaga de admissão junto. Aqui quem
 * espera desiste no teto e o handler é liberado, mesmo que o getaddrinfo
 * original fique pendurado (ele não segura mais nada).
 */
function lookupComTeto(hostname) {
  const emVoo = dnsEmVoo.get(hostname);
  if (emVoo) return emVoo;

  const busca = (async () => {
    let timer;
    try {
      return await Promise.race([
        lookup(hostname, { all: true }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new HostNaoResolvidoError(hostname)),
            DNS_TIMEOUT_MS
          );
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      dnsEmVoo.delete(hostname);
    }
  })();
  // Rejeição compartilhada não pode virar "unhandled rejection" (neste projeto
  // isso derruba o processo de propósito) quando os caronas já desistiram.
  busca.catch(() => {});
  dnsEmVoo.set(hostname, busca);
  return busca;
}

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
    if (cached.blocked) throw new HostBloqueadoError(hostname);
    return cached.ip || null;
  }

  let addresses;
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await lookupComTeto(hostname)).map((entry) => entry.address);
    } catch (err) {
      if (err instanceof HostNaoResolvidoError) throw err;
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
      throw new HostBloqueadoError(hostname);
    }
  }
  hostCheckCache.set(hostname, { at: Date.now(), blocked: null, ip: addresses[0] });
  if (hostCheckCache.size > HOST_CHECK_MAX_ENTRIES) {
    hostCheckCache.delete(hostCheckCache.keys().next().value);
  }
  return addresses[0];
}

// O Agent HTTP/HTTPS com o IP fixado (que ficava aqui) mora em net.mjs,
// junto do transporte que de fato o usa — o fetch global não o usava.

/* ===================================================================== *
 * robots.txt                                                                *
 * ===================================================================== */

// origem -> { at, grupos|null }. grupos=null significa fail-open.
const robotsCache = new Map();
const robotsEmVoo = new Map();
const robotsRegexCache = new Map();

// Teto de concorrência das buscas de robots.txt (uma por origem): uma rajada
// em muitas origens novas não dispara N buscas simultâneas.
const robotsLimiter = criarLimitador({
  limite: ROBOTS_MAX_CONCURRENCY,
  filaMax: 500,
  esperaMaxMs: 3000,
  nome: "robots",
});

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
 * Regras aplicáveis ao nosso user-agent: o grupo específico quando existe,
 * senão TODOS os grupos "*" (o arquivo pode repetir o bloco; ficar só com o
 * primeiro fazia o segundo ser ignorado em silêncio).
 */
function robotsRegrasAplicaveis(grupos) {
  const especifico = grupos.filter((g) =>
    g.agentes.some((a) => a !== "" && a !== "*" && "web-reader-mcp".startsWith(a))
  );
  const alvos = especifico.length > 0 ? especifico : grupos.filter((g) => g.agentes.includes("*"));
  if (alvos.length === 0) return null;
  const regras = [];
  for (const g of alvos) {
    for (const r of g.regras) {
      if (regras.length >= ROBOTS_MAX_REGRAS) return regras;
      regras.push(r);
    }
  }
  return regras;
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
  // Despeja a mais antiga em vez de esvaziar tudo: limpar o cache inteiro
  // obrigava a recompilar todas as regras ainda em uso a cada estouro.
  if (robotsRegexCache.size >= 2000) {
    robotsRegexCache.delete(robotsRegexCache.keys().next().value);
  }
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
 * Lê o corpo do robots.txt em streaming, com teto de bytes e o sinal do teto
 * de tempo. Acima do teto (ou leitura cortada) devolve null, que o caller
 * trata como fail-open — o `res.text()` carregaria o corpo inteiro antes de
 * qualquer conferência.
 */
async function lerRobotsComTeto(stream, signal) {
  try {
    const buffer = await coletarComTeto(stream, { maxBytes: ROBOTS_MAX_BYTES, url: "robots.txt", signal });
    return new TextDecoder("utf-8").decode(buffer);
  } catch {
    return null;
  }
}

/**
 * Busca e processa o robots.txt de uma origem. Fail-open.
 *
 * Segurança: o host é validado ANTES de conectar (assertPublicHost) e a busca
 * sai pelo transporte pinado (net.mjs) com o IP já validado — o robots.txt
 * nunca toca um endereço interno (antes, o fetch global em paralelo escapava
 * do bloqueio: ver dev/_probe-robots-ssrf.mjs). Redirect não é seguido: 3xx
 * vale como inacessível (fail-open), o que também fecha SSRF via Location.
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
      await robotsLimiter.executar(async () => {
        const urlRobots = `${origem}/robots.txt`;
        let ipValido;
        try {
          ipValido = await assertPublicHost(urlRobots);
        } catch {
          return; // host interno/bloqueado: sem regra a cumprir, nada a buscar
        }
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })),
          ROBOTS_TIMEOUT_MS
        );
        try {
          const { statusCode, headers, stream } = await httpGetUmSalto(urlRobots, {
            headers: { "User-Agent": "web-reader-mcp" },
            ipValido,
            signal: controller.signal,
          });
          if (statusCode >= 200 && statusCode < 300) {
            const texto = await lerRobotsComTeto(desembrulhar(stream, headers), controller.signal);
            // null = passou do teto ou leitura cortada: sem regra, fail-open.
            if (texto !== null) entrada = { at: Date.now(), grupos: robotsGruposDoTexto(texto) };
          } else {
            // 3xx/4xx/5xx: inacessível. Descarta o corpo sem esperar por ele.
            descartarCorpo(stream);
          }
        } finally {
          // O teto cobre TAMBEM a leitura do corpo. Cancelar antes deixava
          // uma resposta que manda os cabeçalhos e estaciona o corpo pendurada
          // para sempre — e a vaga de admissão ia junto (visto em produção:
          // 128 vagas presas por >100 min depois de uma rajada).
          clearTimeout(timer);
        }
      });
    } catch {
      // inacessível/4xx/5xx/grande demais/tempo esgotado: fica o fail-open
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
