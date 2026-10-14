#!/usr/bin/env node
/**
 * web-reader-mcp — servidor MCP feito do zero.
 *
 * - Zero dependencias (nenhum npm install necessario).
 * - Sem API key e sem scraping de buscador: a busca e feita pela IA,
 *   que passa as URLs para as ferramentas de leitura.
 * - Protocolo MCP (stdio, JSON-RPC newline-delimited) implementado a mao.
 * - Parser de HTML -> markdown tambem implementado a mao (tokenizer proprio).
 *
 * Ferramentas:
 *   read_page(url)            -> le uma pagina e devolve titulo + conteudo em markdown
 *   extract_links(url)        -> lista os links de uma pagina
 *   read_multiple_pages(urls) -> le varias paginas em sequencia
 *   read_dynamic_page(url)    -> le paginas que dependem de JavaScript (sem Playwright)
 */

// Apenas built-ins do Node (o projeto continua com zero dependencias).
import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const SERVER_NAME = "web-reader";
const SERVER_VERSION = "1.1.0";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_MAX_CHARS = 8000;
const HARD_MAX_CHARS = 50000;
const MAX_PAGES_PER_CALL = 30;
// Teto de download por requisicao. Configuravel, mas o padrao de 10 MB e o que
// garante ler paginas grandes legitimas (Wikipedia, documentacao longa).
const MAX_RESPONSE_BYTES = Math.max(
  64 * 1024,
  Math.floor(Number(process.env.MAX_RESPONSE_BYTES) || 10 * 1024 * 1024)
);
// Teto de memoria simultanea: quantas paginas sao baixadas em paralelo por
// read_multiple_pages e crawl_site. 6 * 10 MB e o pico transitorio previsivel.
const FETCH_CONCURRENCY = Math.max(
  1,
  Math.min(32, Math.floor(Number(process.env.FETCH_CONCURRENCY) || 6))
);
// Orcamento da busca automatica de "APIs internas" que o read_page dispara
// sozinho quando o conteudo vem curto. Sem teto, uma pagina com muitos
// "/api/..." que nao respondem prendia a chamada por minutos.
const API_MAX_CANDIDATES = Math.max(0, Math.floor(Number(process.env.API_MAX_CANDIDATES || 3)));
const API_TOTAL_BUDGET_MS = Math.max(500, Math.floor(Number(process.env.API_TOTAL_BUDGET_MS) || 10000));

// User-agents alternativos para sites que bloqueiam o primeiro
const ALT_USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

const PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
]);

/* ===================================================================== *
 * Parser HTML -> markdown, feito a mao (tokenizer + regras de emissao) *
 * ===================================================================== */

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// Tags cujo CONTEUDO e lixo para leitura (scripts, estilos, menus, anuncios...)
const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "canvas", "iframe",
  "object", "audio", "video", "nav", "header", "footer", "aside", "form",
  "head", "select", "button",
]);

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  iexcl: "\u00a1", cent: "\u00a2", pound: "\u00a3", curren: "\u00a4",
  yen: "\u00a5", brvbar: "\u00a6", sect: "\u00a7", uml: "\u00a8",
  copy: "\u00a9", ordf: "\u00aa", laquo: "\u00ab", not: "\u00ac",
  shy: "", reg: "\u00ae", macr: "\u00af", deg: "\u00b0", plusmn: "\u00b1",
  sup2: "\u00b2", sup3: "\u00b3", acute: "\u00b4", micro: "\u00b5",
  para: "\u00b6", middot: "\u00b7", cedil: "\u00b8", sup1: "\u00b9",
  ordm: "\u00ba", raquo: "\u00bb", frac14: "\u00bc", frac12: "\u00bd",
  frac34: "\u00be", iquest: "\u00bf", times: "\u00d7", divide: "\u00f7",
  ndash: "\u2013", mdash: "\u2014", lsquo: "\u2018", rsquo: "\u2019",
  sbquo: "\u201a", ldquo: "\u201c", rdquo: "\u201d", bdquo: "\u201e",
  dagger: "\u2020", Dagger: "\u2021", bull: "\u2022", hellip: "\u2026",
  permil: "\u2030", prime: "\u2032", Prime: "\u2033", lsaquo: "\u2039",
  rsaquo: "\u203a", oline: "\u203e", frasl: "\u2044", euro: "\u20ac",
  trade: "\u2122", larr: "\u2190", uarr: "\u2191", rarr: "\u2192",
  darr: "\u2193", harr: "\u2194", minus: "\u2212", infin: "\u221e",
  ne: "\u2260", le: "\u2264", ge: "\u2265", hearts: "\u2665",
  diams: "\u2666", clubs: "\u2663", spades: "\u2660",
  // Letras do Latin-1 (ISO-8859-1) — sem elas "&ccedil;&atilde;o" saia literal.
  Agrave: "\u00c0", Aacute: "\u00c1", Acirc: "\u00c2", Atilde: "\u00c3", Auml: "\u00c4",
  Aring: "\u00c5", AElig: "\u00c6", Ccedil: "\u00c7", Egrave: "\u00c8", Eacute: "\u00c9",
  Ecirc: "\u00ca", Euml: "\u00cb", Igrave: "\u00cc", Iacute: "\u00cd", Icirc: "\u00ce",
  Iuml: "\u00cf", ETH: "\u00d0", Ntilde: "\u00d1", Ograve: "\u00d2", Oacute: "\u00d3",
  Ocirc: "\u00d4", Otilde: "\u00d5", Ouml: "\u00d6", Oslash: "\u00d8", Ugrave: "\u00d9",
  Uacute: "\u00da", Ucirc: "\u00db", Uuml: "\u00dc", Yacute: "\u00dd", THORN: "\u00de",
  szlig: "\u00df", agrave: "\u00e0", aacute: "\u00e1", acirc: "\u00e2", atilde: "\u00e3",
  auml: "\u00e4", aring: "\u00e5", aelig: "\u00e6", ccedil: "\u00e7", egrave: "\u00e8",
  eacute: "\u00e9", ecirc: "\u00ea", euml: "\u00eb", igrave: "\u00ec", iacute: "\u00ed",
  icirc: "\u00ee", iuml: "\u00ef", eth: "\u00f0", ntilde: "\u00f1", ograve: "\u00f2",
  oacute: "\u00f3", ocirc: "\u00f4", otilde: "\u00f5", ouml: "\u00f6", oslash: "\u00f8",
  ugrave: "\u00f9", uacute: "\u00fa", ucirc: "\u00fb", uuml: "\u00fc", yacute: "\u00fd",
  thorn: "\u00fe", yuml: "\u00ff",
  // Tipografia extra
  OElig: "\u0152", oelig: "\u0153", Scaron: "\u0160", scaron: "\u0161",
  Yuml: "\u0178", fnof: "\u0192", circ: "\u02c6", tilde: "\u02dc",
  ensp: " ", emsp: " ", thinsp: "\u2009", zwnj: "\u200c", zwj: "\u200d",
  lrm: "\u200e", rlm: "\u200f", oplus: "\u2295", otimes: "\u2297",
};

function decodeEntities(input) {
  if (!input || input.indexOf("&") === -1) return input;
  return input.replace(
    /&(#[Xx][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g,
    (match, body) => {
      if (body[0] === "#") {
        const isHex = body[1] === "x" || body[1] === "X";
        const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
        // Codigo invalido/fora do range: mantem o texto original, nunca some.
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      const replacement = NAMED_ENTITIES[body];
      return replacement === undefined ? match : replacement;
    }
  );
}

// Acha o ">" que fecha a tag, respeitando atributos entre aspas (ex.: title="a > b").
function findTagEnd(html, start) {
  let quote = null;
  for (let j = start + 1; j < html.length; j++) {
    const c = html[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return j;
    }
  }
  return -1;
}

function parseAttrs(source) {
  const attrs = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]*)))?/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (!m[1]) continue;
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

// Divide o HTML em uma lista de tokens: {type:"open"|"close"|"text", tag?, attrs?, value?}
function tokenize(html) {
  const tokens = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      tokens.push({ type: "text", value: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: "text", value: html.slice(i, lt) });
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const nextChar = html[lt + 1];
    // Regra do HTML: "<" so inicia uma tag se vier uma letra ASCII, "/", "!" ou "?".
    // Qualquer outra coisa (ex.: "3 < 5") e texto literal — antes o tokenizer
    // engolia o trecho ate o proximo ">" e o conteudo sumia.
    const startsTag =
      nextChar === "/" ||
      nextChar === "!" ||
      nextChar === "?" ||
      (nextChar !== undefined && /[A-Za-z]/.test(nextChar));
    if (!startsTag) {
      tokens.push({ type: "text", value: "<" });
      i = lt + 1;
      continue;
    }
    if (nextChar === "!" || nextChar === "?") {
      const end = findTagEnd(html, lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const gt = findTagEnd(html, lt);
    if (gt === -1) {
      tokens.push({ type: "text", value: html.slice(lt) });
      break;
    }
    const raw = html.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (!raw) continue;
    const closing = raw[0] === "/";
    const body = closing ? raw.slice(1).trim() : raw;
    const nameMatch = body.match(/^([A-Za-z][A-Za-z0-9:_-]*)/);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLowerCase();
    const selfClosing = !closing && (VOID_TAGS.has(tag) || /\/$/.test(body));
    if (closing) {
      tokens.push({ type: "close", tag });
    } else {
      tokens.push({ type: "open", tag, selfClosing, attrs: parseAttrs(body.slice(nameMatch[0].length)) });
    }
  }
  return tokens;
}

function resolveUrl(href, baseUrl) {
  if (!href) return null;
  const value = String(href).trim();
  if (!value || value.startsWith("#") || /^(javascript|mailto|tel|data|ftp|file):/i.test(value)) return null;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

// Normaliza espacos e quebras do markdown SEM tocar no interior de blocos
// cercados (```): antes o colapso de espacos rodava no documento inteiro e
// destruia a indentacao do codigo (Python, YAML...).
function cleanMarkdown(text) {
  const blocks = [];
  // Normaliza fim de linha antes de mascarar (seguro para o codigo).
  const normalized = String(text).replace(/\r\n?/g, "\n");
  // Mascara cada bloco cercado para o colapso de espacos nao entrar nele.
  const masked = normalized.replace(/```[\s\S]*?```/g, (match) => `\u0000${blocks.push(match) - 1}\u0000`);
  const cleaned = masked
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Restaura os blocos intactos.
  return cleaned.replace(/\u0000(\d+)\u0000/g, (_, index) => blocks[Number(index)]);
}

// Converte o HTML em markdown enxuto (titulos, listas, links, negrito, codigo, tabelas).
function htmlToMarkdown(html, baseUrl) {
  let out = "";
  let skipDepth = 0;
  let preDepth = 0;
  const openStack = [];
  const aStack = [];

  // --- tabela: conteudo acumulado em buffer e emitido no fim, para sair GFM valido ---
  let tableDepth = 0;
  let tableRows = []; // [{ cells: [{ text }] }]
  let tableRow = null;
  let tableCell = null;

  // Com uma celula aberta o texto vai para ela; sem celula, vai para a saida.
  const emit = (chunk) => {
    if (tableCell) tableCell.text += chunk;
    else out += chunk;
  };

  // Monta a tabela markdown: linha de cabecalho (th ou a primeira linha),
  // separador | --- |, escape de "|" e quebras de linha viram espaco.
  const renderTable = (rows) => {
    const validas = rows.filter((row) => row.cells.length > 0);
    if (validas.length === 0) return "";
    const cols = Math.max(...validas.map((row) => row.cells.length));
    const celula = (cell) =>
      String(cell ? cell.text : "")
        .replace(/\s+/g, " ")
        .replace(/\|/g, "\\|")
        .trim();
    const linha = (cells) => {
      const partes = [];
      for (let c = 0; c < cols; c++) partes.push(celula(cells[c]));
      return `| ${partes.join(" | ")} |`;
    };
    const linhas = [
      linha(validas[0].cells),
      `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`,
    ];
    for (let r = 1; r < validas.length; r++) linhas.push(linha(validas[r].cells));
    return "\n\n" + linhas.join("\n") + "\n\n";
  };

  for (const token of tokenize(html)) {
    const isSkipped = SKIP_TAGS.has(token.tag);

    if (token.type === "text") {
      if (skipDepth > 0) continue;
      const decoded = decodeEntities(token.value);
      emit(preDepth > 0 ? decoded : decoded.replace(/\s+/g, " "));
      continue;
    }

    if (token.type === "open") {
      if (isSkipped) {
        skipDepth++;
        continue;
      }
      if (skipDepth > 0) continue;
      if (!token.selfClosing) openStack.push(token.tag);
      switch (token.tag) {
        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
          emit("\n\n" + "#".repeat(Number(token.tag[1])) + " ");
          break;
        case "p": case "div": case "section": case "article": case "main":
        case "figure": case "figcaption": case "details": case "summary":
        case "ul": case "ol": case "dl":
          emit("\n");
          break;
        case "blockquote":
          emit("\n> ");
          break;
        case "li":
          emit("- ");
          break;
        // --- tabela ---
        case "table":
          if (tableDepth === 0) {
            tableRows = [];
            tableRow = null;
            tableCell = null;
          }
          tableDepth++; // tabela aninhada: so acumula, nao perde texto
          break;
        case "caption": case "tbody": case "thead": case "tfoot":
          if (tableDepth === 0) emit("\n");
          break;
        case "tr":
          if (tableDepth > 0) {
            tableRow = { cells: [] };
            tableCell = null;
          } else {
            emit("\n");
          }
          break;
        case "th": case "td":
          if (tableDepth > 0) tableCell = { text: "" };
          else emit(" ");
          break;
        case "a": {
          const href = resolveUrl(token.attrs.href, baseUrl);
          aStack.push(href);
          if (href) emit("[");
          break;
        }
        case "strong": case "b":
          emit("**");
          break;
        case "em": case "i":
          emit("*");
          break;
        case "code":
          if (preDepth === 0) emit("`");
          break;
        case "pre":
          preDepth++;
          emit("\n\n```\n");
          break;
        case "br":
          emit(tableCell ? " " : "\n"); // quebra dentro de celula vira espaco
          break;
        case "hr":
          emit("\n\n---\n\n");
          break;
        case "img": {
          const src = resolveUrl(token.attrs.src, baseUrl);
          const alt = (token.attrs.alt || "").trim();
          if (src) emit(`![${alt}](${src})`);
          break;
        }
        default:
          break;
      }
      continue;
    }

    // token.type === "close"
    if (isSkipped) {
      if (skipDepth > 0) skipDepth--;
      continue;
    }
    if (skipDepth > 0) continue;
    for (let k = openStack.length - 1; k >= 0; k--) {
      if (openStack[k] === token.tag) {
        openStack.length = k;
        break;
      }
    }
    switch (token.tag) {
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
      case "p": case "div": case "section": case "article": case "main":
      case "ul": case "ol": case "dl": case "blockquote":
      case "figure": case "figcaption": case "details":
        emit("\n\n");
        break;
      case "li":
        emit("\n");
        break;
      // --- tabela ---
      case "table":
        if (tableDepth > 0) {
          tableDepth--;
          if (tableDepth === 0) {
            out += renderTable(tableRows);
            tableRows = [];
            tableRow = null;
            tableCell = null;
          }
        }
        break;
      case "caption": case "tbody": case "thead": case "tfoot":
        if (tableDepth === 0) emit("\n");
        break;
      case "tr":
        if (tableDepth > 0) {
          if (tableRow && tableRow.cells.length > 0) tableRows.push(tableRow);
          tableRow = null;
          tableCell = null;
        } else {
          emit("\n");
        }
        break;
      case "th": case "td":
        if (tableDepth > 0) {
          if (tableRow && tableCell) tableRow.cells.push(tableCell);
          tableCell = null;
        } else {
          emit(" |");
        }
        break;
      case "a": {
        const href = aStack.pop();
        if (href) emit(`](${href})`);
        break;
      }
      case "strong": case "b":
        emit("**");
        break;
      case "em": case "i":
        emit("*");
        break;
      case "code":
        if (preDepth === 0) emit("`");
        break;
      case "pre":
        if (preDepth > 0) preDepth--;
        // O codigo quase sempre termina com quebras de linha; tira as que
        // sobram para o bloco nao sair com linhas em branco no fim.
        if (!tableCell) out = out.replace(/\n+$/, "");
        emit("\n```\n\n");
        break;
      default:
        break;
    }
  }

  // Tabela malformada (sem </table>): nao perde o conteudo acumulado.
  if (tableDepth > 0) out += renderTable(tableRows);

  return cleanMarkdown(out);
}

// Titulo, meta descricao e autor direto do HTML cru.
function extractMeta(html) {
  let title = "";
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim();

  const metaContent = (pattern) => {
    const m = html.match(pattern);
    if (!m) return "";
    const c = m[0].match(/content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    if (!c) return "";
    return decodeEntities(c[1] ?? c[2] ?? c[3] ?? "").trim();
  };

  const description =
    metaContent(/<meta[^>]+(?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]*>/i) || "";
  const ogTitle = metaContent(/<meta[^>]+(?:name|property)\s*=\s*["'](?:og:title|twitter:title)["'][^>]*>/i);
  const author = metaContent(/<meta[^>]+name\s*=\s*["']author["'][^>]*>/i);
  const published =
    metaContent(
      /<meta[^>]+(?:name|property)\s*=\s*["'](?:article:published_time|og:published_time|date|pubdate)["'][^>]*>/i
    ) || "";

  return {
    title: title || ogTitle,
    description,
    author,
    published: published.slice(0, 25),
  };
}

// Lista de links {text, href, internal} com URLs absolutas e sem duplicatas.
// `internal` = mesmo dominio da pagina base (www e tratados como iguais).
function hostOf(urlOrHref) {
  try {
    return new URL(urlOrHref).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const baseHost = hostOf(baseUrl);
  let skipDepth = 0;
  let current = null;

  for (const token of tokenize(html)) {
    const isSkipped = SKIP_TAGS.has(token.tag);

    if (token.type === "open") {
      if (isSkipped) {
        skipDepth++;
        continue;
      }
      if (skipDepth > 0) continue;
      if (token.tag === "a") {
        current = { href: resolveUrl(token.attrs.href, baseUrl), parts: [], imgAlt: null };
      }
      if (token.tag === "img" && current && !current.imgAlt) {
        const alt = (token.attrs.alt || "").trim();
        if (alt) current.imgAlt = alt;
      }
    } else if (token.type === "close") {
      if (isSkipped) {
        if (skipDepth > 0) skipDepth--;
        continue;
      }
      if (skipDepth > 0) continue;
      if (token.tag === "a" && current) {
        const href = current.href;
        const text = decodeEntities(current.parts.join("")).replace(/\s+/g, " ").trim() || current.imgAlt || "(sem texto)";
        current = null;
        if (href && !seen.has(href)) {
          seen.add(href);
          links.push({
            text,
            href,
            internal: hostOf(href) === baseHost,
          });
        }
      }
    } else if (token.type === "text" && current && skipDepth === 0) {
      current.parts.push(token.value);
    }
  }
  return links;
}

/* ===================================================================== *
 * HTTP + Ferramentas                                                    *
 * ===================================================================== */

function validateHttpUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error(`URL invalida: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Protocolo nao suportado (${parsed.protocol}). Use http/https.`);
  }
  return parsed;
}

/* ===================================================================== *
 * Guarda SSRF                                                           *
 *                                                                       *
 * Este produto existe para ler a web PUBLICA, entao nao existe allowlist *
 * de dominios: o que bloqueamos e apenas endereco privado/interno, que   *
 * nao faz parte da web. Redirects (http->https, www, encurtadores) sao   *
 * parte da web normal e continuam sendo seguidos, ate 5 saltos, com o    *
 * destino de CADA salto revalidado.                                     *
 * ===================================================================== */

// Desliga o bloqueio. So para desenvolvimento e testes locais (o smoke-test
// e os scripts apontam para 127.0.0.1). Em producao (Render) fica DESLIGADA.
const ALLOW_PRIVATE_HOSTS = process.env.ALLOW_PRIVATE_HOSTS === "1";

if (ALLOW_PRIVATE_HOSTS) {
  console.error(
    `[${SERVER_NAME}] AVISO: ALLOW_PRIVATE_HOSTS=1 — o bloqueio de hosts privados/internos esta DESLIGADO (uso apenas local).`
  );
}

// IPv4 privado/reservado: 0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16
// (link-local, inclui o 169.254.169.254 de metadata), 172.16/12, 192.168/16,
// 224/4 (multicast) e 240/4 (reservado).
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

function hextetsToIpv4(hi, lo) {
  const h = parseInt(hi, 16);
  const l = parseInt(lo, 16);
  if (!Number.isInteger(h) || !Number.isInteger(l)) return null;
  return `${h >> 8}.${h & 0xff}.${l >> 8}.${l & 0xff}`;
}

// Extrai o IPv4 embutido num IPv6: mapeado (::ffff:), NAT64 (64:ff9b::) e
// 6to4 (2002::/16). O requisito e validar o IPv4 de dentro, e nao bloquear
// o IPv6 cegamente.
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

// IPv6 interno: :: e ::1, fe80::/10 (link-local), fc00::/7 (ULA) e ff00::/8
// (multicast). O IPv4 embutido tem prioridade: valida ele, nao o IPv6 inteiro.
function isBlockedIpv6(ip) {
  const lower = ip.toLowerCase().split("%")[0]; // remove zone id (fe80::1%eth0)
  if (lower === "::" || lower === "::1") return true;
  const embedded = embeddedIpv4(lower);
  if (embedded) return isBlockedIpv4(embedded);
  if (/^fe[89ab]/.test(lower)) return true; // fe80::/10
  const first = lower.split(":")[0];
  if (first.length >= 2) {
    const b0 = parseInt(first.padStart(4, "0").slice(0, 2), 16);
    if ((b0 & 0xfe) === 0xfc) return true; // fc00::/7
    if (b0 === 0xff) return true; // ff00::/8
  }
  return false;
}

// Devolve o proprio endereco quando ele deve ser bloqueado, ou null.
function blockedAddress(address) {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address) ? address : null;
  if (family === 6) return isBlockedIpv6(address) ? address : null;
  return address; // formato desconhecido: nao arrisca
}

// Cache curto das validacoes de host, so para nao repetir o lookup de DNS a
// cada requisicao (o cache de paginas valida antes de responder).
const HOST_CHECK_TTL_MS = 60 * 1000;
const HOST_CHECK_MAX_ENTRIES = 500;
const hostCheckCache = new Map();

// Resolve o host e recusa endereco privado/interno. Chamada ANTES de cada
// requisicao de saida, inclusive a cada salto de redirect.
//
// LIMITACAO CONHECIDA (DNS rebinding): entre o lookup daqui e a conexao feita
// pelo fetch sobra uma janela em que o DNS poderia apontar para outro IP.
// Fechar essa janela exigiria fixar o IP de destino na conexao, o que o fetch
// do Node nao permite — e resolver na mao significaria abandonar o fetch ou
// adicionar dependencia. Fica documentado, nao resolvido.
async function assertPublicHost(url) {
  if (ALLOW_PRIVATE_HOSTS) return;

  let hostname;
  try {
    hostname = new URL(String(url)).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    throw new Error(`URL invalida: ${url}`);
  }

  const cached = hostCheckCache.get(hostname);
  if (cached && Date.now() - cached.at < HOST_CHECK_TTL_MS) {
    if (cached.blocked) throw new Error(`Host bloqueado: endereco privado/interno (${cached.blocked})`);
    return;
  }

  let addresses;
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await lookup(hostname, { all: true })).map((entry) => entry.address);
    } catch {
      throw new Error(`Nao foi possivel resolver o host: ${hostname}`);
    }
  }
  if (addresses.length === 0) throw new Error(`Nao foi possivel resolver o host: ${hostname}`);

  for (const address of addresses) {
    const blocked = blockedAddress(address);
    if (blocked) {
      hostCheckCache.set(hostname, { at: Date.now(), blocked });
      if (hostCheckCache.size > HOST_CHECK_MAX_ENTRIES) {
        hostCheckCache.delete(hostCheckCache.keys().next().value);
      }
      // Mensagem curta e sem detalhes da rede interna, so o suficiente para a IA entender.
      throw new Error(`Host bloqueado: endereco privado/interno (${blocked})`);
    }
  }
  hostCheckCache.set(hostname, { at: Date.now(), blocked: null });
  if (hostCheckCache.size > HOST_CHECK_MAX_ENTRIES) {
    hostCheckCache.delete(hostCheckCache.keys().next().value);
  }
}

const MAX_REDIRECTS = 5;

// GET seguindo redirects a mao (redirect: "manual"), validando o destino de
// cada salto. Sem isso, uma URL publica que devolva 302 para 127.0.0.1 faria
// o servidor buscar a rede interna.
async function fetchNoRedirect(url, headers, signal) {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(currentUrl);
    const res = await fetch(currentUrl, { method: "GET", headers, redirect: "manual", signal });
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = isRedirect ? res.headers.get("location") : null;
    if (!isRedirect || !location) return { res, finalUrl: currentUrl };

    // Descarta o corpo do salto para liberar o socket.
    try {
      await res.arrayBuffer();
    } catch {
      // corpo do redirect irrelevante
    }
    if (hop === MAX_REDIRECTS) {
      throw new Error(`Redirects em excesso (mais de ${MAX_REDIRECTS} saltos) ao acessar ${url}`);
    }
    let next;
    try {
      next = new URL(location, currentUrl); // resolve Location relativo
    } catch {
      throw new Error(`Redirect com Location invalido em ${currentUrl}`);
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new Error(`Redirect para protocolo nao suportado (${next.protocol}) em ${currentUrl}`);
    }
    currentUrl = next.href;
  }
  throw new Error(`Redirects em excesso (mais de ${MAX_REDIRECTS} saltos) ao acessar ${url}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry-After pode vir em segundos ("120") ou como data HTTP. Teto de 10s para
// um servidor malicioso nao conseguir nos prender por horas.
const RETRY_AFTER_MAX_MS = 10000;
function parseRetryAfter(valor) {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (/^\d+$/.test(texto)) return Math.min(RETRY_AFTER_MAX_MS, Number(texto) * 1000);
  const data = Date.parse(texto);
  if (Number.isFinite(data)) return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, data - Date.now()));
  return null;
}

// Le o corpo em STREAMING e corta ao passar do teto: antes o arrayBuffer()
// carregava a resposta inteira na memoria para so depois conferir o tamanho,
// entao o teto nao protegia de nada.
async function readBodyWithLimit(res, maxBytes) {
  const body = res.body;
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Resposta muito grande (acima de ${maxBytes} bytes, maximo ${MAX_RESPONSE_BYTES})`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    // Solta a conexao e para de ler o resto do corpo.
    try {
      await reader.cancel();
    } catch {
      // corpo ja encerrado
    }
  }
  return Buffer.concat(chunks, total);
}

async function fetchText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2, signal: externo } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Permite que um orcamento externo (ex.: a busca de APIs internas) cancele
    // a requisicao no meio, sem esperar o timeout cheio.
    const abortarDeFora = () => controller.abort();
    if (externo) {
      if (externo.aborted) {
        clearTimeout(timer);
        throw new Error("Requisicao cancelada (orcamento esgotado).");
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
      // fetchNoRedirect valida o host de cada salto antes de conectar.
      const { res, finalUrl } = await fetchNoRedirect(url, headers, controller.signal);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText || ""}`.trim() + ` ao acessar ${url}`);
        err.status = res.status;
        err.retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        throw err;
      }
      const buffer = await readBodyWithLimit(res, MAX_RESPONSE_BYTES);
      const text = await decodeBuffer(buffer, res.headers.get("content-type") || "");
      return {
        text,
        finalUrl,
        contentType: (res.headers.get("content-type") || "").toLowerCase(),
      };
    } catch (err) {
      lastError = err;
      const retriable = err && (err.status === 429 || err.status === 503 || err.status === 500 || err.status === 403 || err.status === 401);
      if (!retriable || attempt === retries) throw err;
      // 429/503: respeita o Retry-After do servidor (com teto); senao backoff.
      const respeitaRetryAfter = (err.status === 429 || err.status === 503) && err.retryAfterMs != null;
      await sleep(respeitaRetryAfter ? err.retryAfterMs : 400 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
      if (externo) externo.removeEventListener("abort", abortarDeFora);
    }
  }
  throw lastError;
}

// Tenta buscar a página com HTTPS se HTTP falhar.
async function fetchTextWithFallback(url, options) {
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

// Decodifica o buffer de acordo com o charset do content-type ou detecta BOM.
async function decodeBuffer(buffer, contentType) {
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  const charset = charsetMatch ? charsetMatch[1].toLowerCase().replace(/["']/g, "") : "";
  const bytes = new Uint8Array(buffer);
  // Detecta BOM
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder("utf-8").decode(bytes.slice(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder("utf-16be").decode(bytes.slice(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder("utf-16le").decode(bytes.slice(2));
  }
  // Usa charset do content-type, ou UTF-8 como fallback
  try {
    if (charset && charset !== "utf-8" && charset !== "utf8") {
      return new TextDecoder(charset).decode(bytes);
    }
  } catch {
    // charset desconhecido, cai no UTF-8
  }
  return new TextDecoder("utf-8").decode(bytes);
}

// Cache em memoria (LRU + TTL): evita rebaixar a mesma pagina e reduz
// bloqueios por requisicao repetida. Some no restart (stateless no Render).
const CACHE_TTL_MS = Math.max(
  1000,
  Math.floor(Number(process.env.CACHE_TTL_MS) || 10 * 60 * 1000)
);
const CACHE_MAX_ENTRIES = 100;
// Teto em BYTES, alem do teto de contagem: sem ele, 100 entradas de ate
// MAX_RESPONSE_BYTES davam ~1 GB potencial num plano de 512 MB.
const CACHE_MAX_BYTES = Math.max(
  1024,
  Math.floor(Number(process.env.CACHE_MAX_BYTES) || 64 * 1024 * 1024)
);
// Uma entrada sozinha maior que este limite nao entra no cache: nao vale
// expulsar o cache inteiro por causa de uma pagina gigante. E o menor entre
// 1/4 do teto e metade do limite de download — com os valores padrao (64 MB e
// 10 MB) so o segundo termo pega, senao a regra seria inalcancavel.
const CACHE_MAX_ENTRY_BYTES = Math.min(
  Math.floor(CACHE_MAX_BYTES / 4),
  Math.floor(MAX_RESPONSE_BYTES / 2)
);
const pageCache = new Map();
let pageCacheBytes = 0;

const payloadBytes = (payload) =>
  Buffer.byteLength(payload.text || "", "utf8") + Buffer.byteLength(payload.finalUrl || "", "utf8");

// Toda remocao passa por aqui, senao a contagem em bytes deriva.
function cacheDelete(key) {
  const entry = pageCache.get(key);
  if (!entry) return;
  pageCacheBytes -= entry.bytes;
  pageCache.delete(key);
  if (pageCacheBytes < 0) pageCacheBytes = 0;
}

function cacheSet(key, entry) {
  cacheDelete(key); // sobrescrever a mesma chave nao pode contar duas vezes
  pageCache.set(key, entry);
  pageCacheBytes += entry.bytes;
  // Despeja os menos recentemente usados ate caber nos DOIS tetos.
  while (pageCache.size > 1 && (pageCache.size > CACHE_MAX_ENTRIES || pageCacheBytes > CACHE_MAX_BYTES)) {
    const maisAntiga = pageCache.keys().next().value;
    if (maisAntiga === key) break;
    cacheDelete(maisAntiga);
  }
}

// Entradas expiradas seguram bytes ate serem tocadas: varre de tempos em tempos.
const cacheCleanup = setInterval(() => {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [key, entry] of pageCache) {
    if (entry.at < cutoff) cacheDelete(key);
  }
}, CACHE_TTL_MS);
cacheCleanup.unref();

function cacheStats() {
  return {
    entries: pageCache.size,
    bytes: pageCacheBytes,
    maxBytes: CACHE_MAX_BYTES,
    maxEntries: CACHE_MAX_ENTRIES,
    ttlMs: CACHE_TTL_MS,
  };
}

async function fetchTextCached(url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, retries } = {}) {
  // Valida ANTES de olhar o cache: uma URL bloqueada nunca pode ser servida
  // (nem popular) o cache. Vale para todos os caminhos: read_page, crawl,
  // sitemap, extract_links e extractEmbeddedData.
  await assertPublicHost(url);
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    // LRU touch: reordena sem mexer no total de bytes.
    pageCache.delete(url);
    pageCache.set(url, hit);
    return hit.payload;
  }
  if (hit) cacheDelete(url); // expirada: libera os bytes na hora
  const payload = await fetchTextWithFallback(url, { timeoutMs, signal, retries });
  const bytes = payloadBytes(payload);
  // Grande demais para o cache: devolve normal, so nao guarda.
  if (bytes <= CACHE_MAX_ENTRY_BYTES) {
    cacheSet(url, { at: Date.now(), payload, bytes });
  }
  return payload;
}

function clampMaxChars(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_CHARS;
  return Math.max(200, Math.min(HARD_MAX_CHARS, Math.floor(n)));
}

function clampTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1000, Math.min(60000, Math.floor(n)));
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text:
      text.slice(0, maxChars) +
      `\n\n[... conteudo truncado em ${maxChars} caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]`,
    truncated: true,
  };
}

function formatReadResult({ finalUrl, meta, text, truncated, fullLength, extraLabel }) {
  const lines = [];
  lines.push(`# ${meta.title || "(sem titulo)"}`);
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

function ensureHtml(contentType, html) {
  if (contentType && !/html|xml|text\//.test(contentType)) {
    throw new Error(`O conteudo retornado nao e HTML (content-type: ${contentType})`);
  }
  if (!contentType && !/^\s*</.test(html)) {
    throw new Error("A resposta nao parece ser HTML.");
  }
}

async function toolReadPage(args) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const { text: html, finalUrl, contentType } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml(contentType, html);
  const meta = extractMeta(html);
  let markdown = htmlToMarkdown(html, finalUrl);
  // Se o conteúdo extraído for muito curto, tenta extrair dados embutidos
  if (markdown.replace(/\s+/g, " ").trim().length < 300 && isDynamicPage(html, markdown)) {
    const dynamicMarkdown = await extractEmbeddedData(html, finalUrl, timeoutMs);
    if (dynamicMarkdown && dynamicMarkdown.length > markdown.length) {
      markdown = dynamicMarkdown;
    }
  }
  const { text, truncated } = truncate(markdown, maxChars);
  return formatReadResult({ finalUrl, meta, text, truncated, fullLength: markdown.length });
}

// Extrai dados embutidos de páginas dinâmicas e converte em markdown.
async function extractEmbeddedData(html, baseUrl, timeoutMs) {
  const sources = [];
  // __NEXT_DATA__ (Next.js)
  const nextData = extractJsonById(html, "__NEXT_DATA__");
  if (nextData) sources.push({ nome: "__NEXT_DATA__", dados: nextData });
  // __NUXT__ (Nuxt.js) — sem eval, só primitivos
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*([\s\S]*?);?\s*<\/script>/i);
  if (nuxtMatch) {
    const nuxtData = extractPrimitives(nuxtMatch[1]);
    if (Object.keys(nuxtData).length > 0) {
      sources.push({ nome: "__NUXT__", dados: nuxtData });
    }
  }
  // window.__INITIAL_STATE__ ou similar
  const windowState = extractWindowState(html);
  if (windowState) sources.push({ nome: "__INITIAL_STATE__", dados: windowState });
  // JSON-LD
  const jsonLd = extractJsonLd(html);
  if (jsonLd.length > 0) sources.push({ nome: "JSON-LD", dados: jsonLd });
  // APIs internas
  const apiResults = await tryInternalApi(html, baseUrl, timeoutMs);
  for (const api of apiResults) {
    sources.push({ nome: `API: ${api.url}`, dados: api.data });
  }
  if (sources.length === 0) return null;
  const parts = [];
  for (const source of sources) {
    const md = jsonToMarkdown(source.dados);
    if (md) parts.push(`## ${source.nome}\n${md}`);
  }
  return parts.join("\n\n");
}

// ===================================================================== *
// Leitura de paginas dinamicas (sem Playwright)                         *
// =====================================================================

// Detecta se uma pagina provavelmente precisa de JavaScript para renderizar.
function isDynamicPage(html, markdown) {
  const visibleText = markdown.replace(/\s+/g, " ").trim();
  const hasFrameworkScript =
    /__NEXT_DATA__|__NUXT__|__INITIAL_STATE__|window\.__data|data-reactroot|data-reactid|ng-app|vue-app/i.test(html);
  const hasEmptyRoot = /<div[^>]+id=["']root["'][^>]*>\s*<\/div>|<div[^>]+id=["']app["'][^>]*>\s*<\/div>/.test(html);
  const shortContent = visibleText.length < 500;
  return hasFrameworkScript || hasEmptyRoot || shortContent;
}

// Extrai JSON de uma tag <script> pelo id ou tipo.
function extractJsonById(html, id) {
  const re = new RegExp(`<script[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i");
  const m = html.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

// Extrai JSON-LD (application/ld+json) — muito usado em sites de noticias e produtos.
function extractJsonLd(html) {
  const results = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      results.push(data);
    } catch {
      // ignora JSON invalido
    }
  }
  return results;
}

// Extrai dados de scripts com window.__INITIAL_STATE__ ou similar.
function extractWindowState(html) {
  const patterns = [
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/i,
    /window\.__data\s*=\s*({[\s\S]*?});?\s*<\/script>/i,
    /window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      try {
        return JSON.parse(m[1].trim());
      } catch {
        // tenta o proximo padrao
      }
    }
  }
  return null;
}

// Extrai primitivos de um bloco JS (sem eval). Usado para __NUXT__ e similares.
function extractPrimitives(jsCode) {
  const result = {};
  const re = /(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|null|true|false|-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(jsCode)) !== null) {
    const key = m[1];
    let value = m[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      value = value.slice(1, -1).replace(/\\(.)/g, "$1");
    } else if (value === "null") value = null;
    else if (value === "true") value = true;
    else if (value === "false") value = false;
    else value = Number(value);
    result[key] = value;
  }
  return result;
}

// Converte um objeto JSON extraido em markdown legível.
// Proteção contra recursão circular e profundidade excessiva.
function jsonToMarkdown(data, depth = 0, seen = new Set()) {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data;
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  if (depth > 10) return "(profundidade máxima atingida)";
  if (typeof data === "object") {
    if (seen.has(data)) return "(referência circular)";
    seen.add(data);
    try {
      if (Array.isArray(data)) {
        return data.map((item) => `- ${jsonToMarkdown(item, depth + 1, seen)}`).join("\n");
      }
      const lines = [];
      for (const [key, value] of Object.entries(data)) {
        if (value === null || value === undefined) continue;
        const formatted = jsonToMarkdown(value, depth + 1, seen);
        if (!formatted) continue;
        if (typeof value === "object" && !Array.isArray(value)) {
          lines.push(`${"  ".repeat(depth)}- **${key}**:`);
          lines.push(formatted);
        } else {
          lines.push(`${"  ".repeat(depth)}- **${key}**: ${formatted}`);
        }
      }
      return lines.join("\n");
    } finally {
      seen.delete(data);
    }
  }
  return "";
}

// Pontua o candidato para escolher os mais provaveis de serem dados de verdade.
// Endpoint de dados costuma ter "json"/"graphql"/"api" no caminho; asset
// estatico (imagem, css, fonte) nunca e.
function scoreApiCandidate(url) {
  const u = new URL(url);
  const caminho = u.pathname.toLowerCase();
  if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?|ttf|eot|mp4|webm|pdf|zip)$/.test(caminho)) return -5;
  let score = 0;
  if (caminho.includes("graphql")) score += 4;
  if (caminho.includes("json")) score += 3;
  if (caminho.startsWith("/api/")) score += 3;
  if (caminho.startsWith("/wp-json/")) score += 3;
  if (caminho.startsWith("/data/")) score += 2;
  if (u.search) score += 1; // endpoint de dados costuma ter query
  return score;
}

// Tenta achar APIs internas comuns em sites dinamicos.
// - so o MESMO host da pagina (alem da guarda SSRF, que roda dentro do fetch)
// - dedupe pela URL ja resolvida
// - no maximo API_MAX_CANDIDATES, com API_TOTAL_BUDGET_MS de orcamento TOTAL
// Se o orcamento estourar, devolve o que ja conseguiu e segue sem erro.
async function tryInternalApi(html, baseUrl, timeoutMs) {
  if (API_MAX_CANDIDATES === 0) return [];
  const baseHost = hostOf(baseUrl);
  const apiPatterns = [
    /["'](\/api\/[^"']+)["']/g,
    /["'](\/graphql[^"']*)["']/g,
    /["'](\/data\/[^"']+)["']/g,
    /["'](\/wp-json\/[^"']+)["']/g,
  ];

  const vistos = new Set();
  const candidatos = [];
  for (const re of apiPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const bruto = m[1];
      if (bruto.length >= 100) continue;
      let url;
      try {
        url = new URL(bruto, baseUrl).href; // resolve relativo e absoluto
      } catch {
        continue;
      }
      if (vistos.has(url)) continue; // dedupe
      vistos.add(url);
      if (hostOf(url) !== baseHost) continue; // nao sai do dominio da pagina
      candidatos.push({ url, score: scoreApiCandidate(url) });
    }
  }
  if (candidatos.length === 0) return [];

  // Mais provaveis primeiro; empate mantem a ordem de aparicao no HTML.
  candidatos.sort((a, b) => b.score - a.score);
  const alvos = candidatos.slice(0, API_MAX_CANDIDATES);

  const controller = new AbortController();
  const orcamento = setTimeout(() => controller.abort(), API_TOTAL_BUDGET_MS);
  const prazo = Date.now() + API_TOTAL_BUDGET_MS;
  const results = [];
  try {
    for (const alvo of alvos) {
      if (controller.signal.aborted || Date.now() >= prazo) break; // orcamento esgotado
      try {
        const restante = Math.max(1000, Math.min(timeoutMs, prazo - Date.now()));
        // retries: 0 porque o orcamento manda mais que a insistencia aqui.
        const { text, contentType } = await fetchTextCached(alvo.url, {
          timeoutMs: restante,
          signal: controller.signal,
          retries: 0,
        });
        if (contentType && /json/.test(contentType)) {
          results.push({ url: alvo.url, data: text.slice(0, 5000) });
        }
      } catch {
        // candidato que falha ou e cortado pelo orcamento: segue com o que tem
      }
    }
  } finally {
    clearTimeout(orcamento);
  }
  return results;
}

async function toolReadDynamicPage(args) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const { text: html, finalUrl, contentType } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml(contentType, html);
  const meta = extractMeta(html);
  const markdown = htmlToMarkdown(html, finalUrl);

  // Se nao parece dinamica, retorna o conteudo estatico normal.
  if (!isDynamicPage(html, markdown)) {
    const { text, truncated } = truncate(markdown, maxChars);
    return formatReadResult({
      finalUrl,
      meta,
      text,
      truncated,
      fullLength: markdown.length,
      extraLabel: "Pagina estatica (nao precisa de JavaScript)",
    });
  }

  // Pagina dinamica: tenta extrair dados embutidos (reutiliza a mesma lógica
  // que o read_page ja usa quando o conteudo vem curto).
  const dynamicMarkdown = await extractEmbeddedData(html, finalUrl, timeoutMs);

  // Se achou dados, usa eles; senao, cai no conteudo estatico com aviso.
  // O cabecalho (titulo, URL, rotulo, contagem) e montado UMA vez pelo
  // formatReadResult — antes o fullText ja trazia tudo e saia duplicado.
  if (dynamicMarkdown) {
    const { text, truncated } = truncate(dynamicMarkdown, maxChars);
    return formatReadResult({
      finalUrl,
      meta,
      text,
      truncated,
      fullLength: dynamicMarkdown.length,
      extraLabel: "Pagina dinamica — dados extraidos do HTML embutido",
    });
  }

  // Se nao achou nada, retorna o conteudo estatico com aviso.
  const { text, truncated } = truncate(markdown, maxChars);
  return formatReadResult({
    finalUrl,
    meta,
    text,
    truncated,
    fullLength: markdown.length,
    extraLabel: "Pagina dinamica detectada, mas nao foi possivel extrair dados embutidos. Conteudo estatico abaixo.",
  });
}

async function toolExtractLinks(args) {
  const parsed = validateHttpUrl(args.url);
  const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const { text: html, finalUrl } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml("", html);
  const all = extractLinks(html, finalUrl);
  const shown = all.slice(0, limit);
  const lines = [`Links em ${finalUrl}: ${all.length} encontrados, exibindo ${shown.length}.`, ""];
  shown.forEach((link, index) => {
    lines.push(`${index + 1}. ${link.text}`);
    lines.push(`   ${link.href}${link.internal ? " (interno)" : " (externo)"}`);
  });
  return lines.join("\n");
}

async function readOnePage(url, maxChars, timeoutMs) {
  const parsed = validateHttpUrl(url);
  const { text: html, finalUrl } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml("", html);
  const meta = extractMeta(html);
  const markdown = htmlToMarkdown(html, finalUrl);
  const { text, truncated } = truncate(markdown, maxChars);
  return formatReadResult({ finalUrl, meta, text, truncated, fullLength: markdown.length });
}

async function toolReadMultiplePages(args) {
  const urls = Array.isArray(args.urls) ? args.urls.map((u) => String(u)) : [];
  if (urls.length === 0) throw new Error("Informe uma lista de URLs no parametro 'urls'.");
  if (urls.length > MAX_PAGES_PER_CALL) {
    throw new Error(
      `Maximo de ${MAX_PAGES_PER_CALL} URLs por chamada (recebi ${urls.length}). ` +
        "Divida em varias chamadas."
    );
  }
  const maxChars = clampMaxChars(args.maxChars ?? 4000);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);

  // Leitura em lotes paralelos (rapido, sem floodar os sites). A ordem de
  // saida segue a ordem das URLs de entrada, para a IA mapear facilmente.
  const CONCURRENCY = FETCH_CONCURRENCY;
  const results = new Array(urls.length);
  for (let start = 0; start < urls.length; start += CONCURRENCY) {
    const lote = urls.slice(start, start + CONCURRENCY);
    const settled = await Promise.all(
      lote.map(async (url) => {
        try {
          return { ok: true, text: await readOnePage(url, maxChars, timeoutMs) };
        } catch (err) {
          return { ok: false, text: `# Erro ao ler ${url}\n${err.message}` };
        }
      })
    );
    settled.forEach((resultado, i) => {
      results[start + i] = resultado;
    });
  }

  const ok = results.filter((r) => r.ok).length;
  return (
    `Leitura concluida: ${ok}/${urls.length} paginas OK (lidas em lotes de ${CONCURRENCY}).\n\n` +
    results.map((r) => r.text).join("\n\n========================================\n\n")
  );
}

// Descobre as URLs de um site: tenta sitemap.xml (e variantes), segue
// sitemap indexes e, se nao achar, devolve os links internos da home.
async function toolDiscoverUrls(args) {
  const parsed = validateHttpUrl(args.url);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const origin = `${parsed.protocol}//${parsed.host}`;
  const candidatos = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/wp-sitemap.xml`,
  ];

  let sitemapUrls = [];
  for (const candidato of candidatos) {
    try {
      const { text, contentType } = await fetchTextCached(candidato, { timeoutMs });
      if (/xml/.test(contentType) || text.includes("<loc>")) {
        const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].trim());
        if (locs.length > 0) {
          sitemapUrls.push(...locs);
          break;
        }
      }
    } catch {
      // tenta o proximo candidato
    }
  }

  // sitemap index: se todas as locs apontarem para outros .xml, segue (max 5 filhos)
  const filhos = sitemapUrls.filter((u) => /\.xml($|\?)/i.test(u));
  if (filhos.length > 0 && filhos.length === sitemapUrls.length) {
    const expandidas = [];
    for (const filho of filhos.slice(0, 5)) {
      try {
        const { text } = await fetchTextCached(filho, { timeoutMs });
        const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].trim());
        expandidas.push(...locs);
      } catch {
        // ignora sitemap filho com falha
      }
    }
    if (expandidas.length > 0) sitemapUrls = expandidas;
  }

  const limite = Math.max(1, Math.min(300, Number(args.limit) || 100));

  if (sitemapUrls.length > 0) {
    const mostradas = sitemapUrls.slice(0, limite);
    const internas = mostradas.filter((u) => hostOf(u) === hostOf(parsed.href));
    return [
      `Encontradas ${sitemapUrls.length} URLs no sitemap de ${origin} (exibindo ${mostradas.length}, ${internas.length} do dominio):`,
      "",
      ...mostradas.map((u, i) => `${i + 1}. ${u}`),
      "",
      "Use read_multiple_pages para ler as que interessar.",
    ].join("\n");
  }

  // fallback: links internos da home
  const { text: html, finalUrl } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml("", html);
  const internos = extractLinks(html, finalUrl).filter((l) => l.internal);
  const mostrados = internos.slice(0, limite);
  if (mostrados.length === 0) {
    return `Nenhum sitemap encontrado em ${origin} e a pagina inicial nao tem links internos. Use extract_links ou passe a URL diretamente.`;
  }
  return [
    `Sitemap nao encontrado em ${origin}. ${internos.length} links internos na pagina inicial (exibindo ${mostrados.length}):`,
    "",
    ...mostrados.map((l, i) => `${i + 1}. ${l.text}\n   ${l.href}`),
    "",
    "Use read_multiple_pages para ler as que interessar.",
  ].join("\n");
}

// Crawl BFS limitado: comeca na URL, le, extrai links internos e segue
// pelos nao visitados, ate maxPages. Devolve o conteudo de todas as paginas.
// URLs de navegação que não valem a pena ler em um crawl
const NAVIGATION_PATTERNS = [
  /\/login/i, /\/signin/i, /\/register/i, /\/signup/i,
  /\/privacy/i, /\/terms/i, /\/about/i, /\/contact/i,
  /\/help/i, /\/faq/i, /\/support/i, /\/search/i,
  /\/tag\//i, /\/category\//i, /\/author\//i,
  /\/wp-admin/i, /\/wp-login/i, /\/wp-content/i,
  /\/feed/i, /\/rss/i, /\/atom/i,
  /\/sitemap/i, /\/robots/i,
  /\/cart/i, /\/checkout/i, /\/account/i,
  /\/profile/i, /\/settings/i, /\/admin/i,
  /\/wp-json/i, /\/api\//i,
  /\/page\/\d+/i, /\/p\/\d+/i,
  /\/archive/i, /\/archives/i,
  /\/comment/i, /\/comments/i,
  /\/print/i, /\/share/i, /\/bookmark/i,
  /\/javascript/i, /\/mailto/i,
  /\/#.*$/, // anchors
];

function isNavigationUrl(url) {
  return NAVIGATION_PATTERNS.some((pattern) => pattern.test(url));
}

// Classifica a falha de uma leitura para o resumo do crawl. Sem isso a IA ve
// so "0 paginas lidas" e nao sabe se o site estava vazio ou se foi bloqueado.
function classifyFetchError(err) {
  const msg = String((err && err.message) || "");
  const code = String((err && err.cause && err.cause.code) || "");
  const texto = `${msg} ${code}`;
  if (/Host bloqueado/.test(msg)) return "bloqueadas por endereco privado/interno";
  if (/Redirects em excesso/.test(msg)) return "com redirects em excesso";
  if (/Resposta muito grande/.test(msg)) return "com resposta grande demais";
  if (/aborted|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|TimeoutError|timeout/i.test(texto)) return "com timeout";
  if (/ENOTFOUND|EAI_AGAIN|nao resolvido/i.test(texto)) return "com host nao resolvido (DNS)";
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET/i.test(texto)) {
    return "com conexao recusada/interrompida";
  }
  const http = msg.match(/HTTP (\d{3})/);
  if (http) return `com HTTP ${http[1]}`;
  if (/nao e HTML|nao parece ser HTML/.test(msg)) return "com conteudo nao-HTML";
  return "com outros erros";
}

// Le UMA pagina do crawl. Lanca erro quando a pagina falha: quem chama decide
// se isola (no meio do crawl) ou propaga (na URL inicial).
async function crawlOnePage(url, maxChars, timeoutMs) {
  const parsed = validateHttpUrl(url);
  const { text: html, finalUrl } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml("", html);
  const meta = extractMeta(html);
  const markdown = htmlToMarkdown(html, finalUrl);
  const { text, truncated } = truncate(markdown, maxChars);
  const linksInternos = extractLinks(html, finalUrl).filter(
    (l) => l.internal && l.href !== finalUrl && !isNavigationUrl(l.href)
  );
  return {
    conteudo: formatReadResult({
      finalUrl,
      meta,
      text,
      truncated,
      fullLength: markdown.length,
    }),
    links: linksInternos.map((l) => l.href),
  };
}

async function toolCrawlSite(args) {
  const start = validateHttpUrl(args.url);
  const maxPages = Math.max(2, Math.min(30, Number(args.maxPages) || 10));
  const maxChars = clampMaxChars(args.maxChars ?? 2000);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const baseHost = hostOf(start.href);

  const visited = new Set([start.href]);
  const queue = [];
  const conteudos = []; // texto de cada pagina lida (ou o aviso de erro)
  const falhas = []; // { url, motivo, mensagem }
  let lidas = 0;

  // Pre-flight da URL inicial: se ela nao puder ser lida (bloqueio, DNS,
  // timeout, HTTP), o crawl nem comeca — e isso e ERRO, nao resultado vazio.
  try {
    const primeira = await crawlOnePage(start.href, maxChars, timeoutMs);
    conteudos.push(primeira.conteudo);
    lidas++;
    for (const href of primeira.links) {
      if (!visited.has(href)) {
        visited.add(href);
        queue.push(href);
      }
    }
  } catch (err) {
    throw new Error(`Nao foi possivel iniciar o crawl em ${start.href}: ${err.message}`);
  }

  const CONCURRENCY = FETCH_CONCURRENCY;
  while (queue.length > 0 && conteudos.length < maxPages) {
    const lote = [];
    while (
      lote.length < CONCURRENCY &&
      queue.length > 0 &&
      conteudos.length + lote.length < maxPages
    ) {
      lote.push(queue.shift());
    }
    if (lote.length === 0) break;

    // Uma pagina que falha nao derruba o crawl: o erro fica isolado.
    const resultados = await Promise.all(
      lote.map(async (url) => {
        try {
          return { ok: true, url, ...(await crawlOnePage(url, maxChars, timeoutMs)) };
        } catch (err) {
          return { ok: false, url, erro: err };
        }
      })
    );

    for (const r of resultados) {
      if (r.ok) {
        conteudos.push(r.conteudo);
        lidas++;
        for (const href of r.links) {
          if (!visited.has(href)) {
            visited.add(href);
            queue.push(href);
          }
        }
      } else {
        falhas.push({ url: r.url, motivo: classifyFetchError(r.erro), mensagem: r.erro.message });
        conteudos.push(`# Erro ao ler ${r.url}\n${r.erro.message}`);
      }
    }
  }

  // Resumo agrupado por motivo: a IA precisa saber que o resultado e parcial.
  let cabecalho =
    `Crawl de ${start.href}: ${lidas} pagina(s) lida(s) (limite ${maxPages}, dominio ${baseHost}).`;
  if (falhas.length > 0) {
    const agrupado = new Map();
    for (const f of falhas) agrupado.set(f.motivo, (agrupado.get(f.motivo) || 0) + 1);
    const motivos = [...agrupado.entries()].map(([motivo, n]) => `${n} ${motivo}`).join(", ");
    cabecalho +=
      `\nRESULTADO PARCIAL: ${falhas.length} pagina(s) falharam — ${motivos}.` +
      `\nAs paginas marcadas com "# Erro ao ler" abaixo nao foram lidas.`;
  }
  return cabecalho + "\n\n" + conteudos.join("\n\n========================================\n\n");
}

async function callTool(name, args) {
  switch (name) {
    case "read_page":
      return await toolReadPage(args || {});
    case "extract_links":
      return await toolExtractLinks(args || {});
    case "read_multiple_pages":
      return await toolReadMultiplePages(args || {});

    case "discover_urls":
      return await toolDiscoverUrls(args || {});
    case "crawl_site":
      return await toolCrawlSite(args || {});
    case "read_dynamic_page":
      return await toolReadDynamicPage(args || {});
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

/* ===================================================================== *
 * Servidor MCP — JSON-RPC, sem SDK.                                     *
 * Dois transportes: stdio (local) e HTTP Streamable (Render).           *
 * ===================================================================== */

const TOOLS = [
  {
    name: "read_page",
    description:
      "Le uma pagina web (GET) e devolve o conteudo extraido em markdown: titulo, meta descricao e texto principal. " +
      "Use para ler artigos, documentacoes, blogs, paginas de produto, etc.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa (http/https) da pagina a ler" },
        maxChars: {
          type: "number",
          description: "Maximo de caracteres do conteudo retornado (padrao 8000, max 50000)",
        },
        timeoutMs: { type: "number", description: "Timeout da requisicao em ms (padrao 20000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "extract_links",
    description:
      "Acessa uma pagina e lista seus links (texto + URL absoluta), sem duplicatas. " +
      "Use para descobrir para onde uma pagina aponta e escolher a proxima pagina a ler.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL da pagina" },
        limit: { type: "number", description: "Quantidade maxima de links a listar (padrao 50, max 200)" },
        timeoutMs: { type: "number", description: "Timeout da requisicao em ms (padrao 20000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_multiple_pages",
    description:
      "Le varias paginas por chamada (max 30 URLs, em lotes paralelos) e devolve o conteudo de cada uma, " +
      "com o status de sucesso/falha por URL.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Lista de URLs (http/https), maximo 30",
        },
        maxChars: {
          type: "number",
          description: "Maximo de caracteres por pagina (padrao 4000)",
        },
        timeoutMs: { type: "number", description: "Timeout por requisicao em ms (padrao 20000)" },
      },
      required: ["urls"],
    },
  },

  {
    name: "discover_urls",
    description:
      "Descobre as URLs de um site: le o sitemap.xml (e variantes, incluindo sitemap indexes) " +
      "e lista as paginas encontradas. Se nao houver sitemap, devolve os links internos da home. " +
      "Use para saber o que da para ler num site antes de chamar read_multiple_pages.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL do site (ex.: https://exemplo.com)" },
        limit: { type: "number", description: "Quantidade maxima de URLs a listar (padrao 100, max 300)" },
        timeoutMs: { type: "number", description: "Timeout por requisicao em ms (padrao 20000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "crawl_site",
    description:
      "Le um site sozinho: comeca na URL, extrai os links internos e vai seguindo pelos nao visitados " +
      "(BFS, lotes paralelos), devolvendo o conteudo de cada pagina. " +
      "Ideal para varrer um blog, documentacao ou secao de noticias sem a IA ter que pedir URL por URL. " +
      "Maximo de 30 paginas por chamada.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL inicial (pagina ou home do site)" },
        maxPages: { type: "number", description: "Maximo de paginas a ler (padrao 10, max 30)" },
        maxChars: { type: "number", description: "Maximo de caracteres por pagina (padrao 2000)" },
        timeoutMs: { type: "number", description: "Timeout por requisicao em ms (padrao 20000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_dynamic_page",
    description:
      "Le paginas que dependem de JavaScript para renderizar (React, Vue, Angular, Next.js, etc.) " +
      "sem precisar de Playwright. Detecta se a pagina e dinamica e extrai dados embutidos no HTML " +
      "(__NEXT_DATA__, __NUXT__, __INITIAL_STATE__, JSON-LD, APIs internas). " +
      "Use quando read_page retornar conteudo vazio ou muito curto em sites modernos.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa (http/https) da pagina a ler" },
        maxChars: {
          type: "number",
          description: "Maximo de caracteres do conteudo retornado (padrao 8000, max 50000)",
        },
        timeoutMs: { type: "number", description: "Timeout da requisicao em ms (padrao 20000)" },
      },
      required: ["url"],
    },
  },
];

// Transporte agnostico: `send(jsonrpcMessage)` joga a resposta onde for
// (stdout no modo stdio, corpo HTTP no modo Render).
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
            "Para pesquisar: use extract_links para descobrir URLs em paginas conhecidas, " +
            "depois use read_page para ler o conteudo. Nao existe ferramenta de busca — " +
            "as URLs vem de voce.",
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
        // Notificacoes (initialized, cancelled...) nao tem id: so ignora.
        if (isRequest) fail(-32601, `Metodo nao suportado: ${method}`);
        return;
    }
  } catch (err) {
    if (isRequest) {
      fail(-32603, `Erro interno: ${err && err.message ? err.message : String(err)}`);
    }
  }
}

/* ---------------- transporte stdio (uso local no WorkBuddy) ------------- */

function startStdio() {
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

/* ------------- transporte HTTP remoto (Streamable HTTP p/ o Render) ------- */

async function startHttp() {
  const http = await import("node:http");
  const port = Number(process.env.PORT) || 3000;

  // Se MCP_AUTH_TOKEN estiver definido (recomendado em producao), toda
  // chamada em /mcp precisa do header: Authorization: Bearer <token>
  const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";

  if (!AUTH_TOKEN) {
    console.error(
      `[${SERVER_NAME}] AVISO: MCP_AUTH_TOKEN nao definido — o endpoint /mcp esta ABERTO para qualquer um.`
    );
  }

  // Compara o token em TEMPO CONSTANTE. Passa os dois por sha256 antes: assim
  // os buffers tem sempre 32 bytes, nao existe excecao por tamanho diferente e
  // o tempo nao revela nem o tamanho nem quantos bytes bateram.
  const sha256 = (valor) => createHash("sha256").update(String(valor), "utf8").digest();
  const tokenConfere = (recebido) => timingSafeEqual(sha256(recebido), sha256(AUTH_TOKEN));

  // Rate limiting simples: max 60 requisicoes por minuto por cliente
  const RATE_LIMIT_WINDOW_MS = 60 * 1000;
  const RATE_LIMIT_MAX = 60;
  const RATE_LIMIT_MAX_ENTRIES = 10000;
  const rateLimitMap = new Map();

  // Quantas entradas do x-forwarded-for confiar, contando da DIREITA.
  // 0 (padrao) = ignora o header e usa o IP do socket. No Render o app fica
  // atras de um proxy, entao em producao o valor e 1 (ver render.yaml).
  const TRUST_PROXY_HOPS = Math.max(0, Math.floor(Number(process.env.TRUST_PROXY_HOPS) || 0));

  // O x-forwarded-for e forjavel pelo cliente: as entradas da ESQUERDA sao
  // escritas por ele, as da DIREITA sao anexadas pela infraestrutura confiavel.
  // Por isso contamos da direita, e so aceitamos se o valor for um IP valido —
  // qualquer outra coisa cai para o IP do socket.
  const clientIpOf = (req) => {
    if (TRUST_PROXY_HOPS > 0) {
      const parts = String(req.headers["x-forwarded-for"] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const candidate = parts[parts.length - TRUST_PROXY_HOPS];
      if (candidate) {
        if (isIP(candidate)) return candidate;
        const semPorta = candidate.replace(/:\d+$/, ""); // alguns proxies mandam "ip:porta"
        if (isIP(semPorta)) return semPorta;
      }
    }
    return req.socket.remoteAddress || "unknown";
  };

  // O mapa nao pode crescer para sempre: de tempos em tempos remove as entradas
  // expiradas (unref para o timer nao segurar o processo de pé).
  const rateLimitCleanup = setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    for (const [key, times] of rateLimitMap) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length === 0) rateLimitMap.delete(key);
      else rateLimitMap.set(key, kept);
    }
  }, RATE_LIMIT_WINDOW_MS);
  rateLimitCleanup.unref();

  // Limite do corpo do POST. Configuravel; 1 MB e folgado para qualquer
  // mensagem JSON-RPC do MCP.
  const MAX_BODY_BYTES = Math.max(1024, Math.floor(Number(process.env.MAX_BODY_BYTES) || 1024 * 1024));

  // Le o corpo ate o limite. Ao exceder, interrompe a leitura e rejeita com
  // status 413 (quem chama responde e descarta a conexao).
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
          const err = new Error(`Corpo muito grande (maximo ${MAX_BODY_BYTES} bytes).`);
          err.status = 413;
          req.pause(); // para de acumular; a conexao e descartada depois da resposta
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
    const path = new URL(req.url || "/", "http://localhost").pathname;

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
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        `web-reader-mcp v${SERVER_VERSION} OK | cache: ${cache.entries} entradas, ` +
          `${cache.bytes} bytes / ${cache.maxBytes} bytes ` +
          `(max ${cache.maxEntries} entradas, ttl ${Math.round(cache.ttlMs / 60000)} min)`
      );
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
            error: { code: -32001, message: "Nao autorizado: envie Authorization: Bearer <token>" },
          })
        );
        return;
      }
    }

    // Rate limiting por cliente
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
    // Teto de chaves: descarta as mais antigas (o Map preserva a ordem de
    // insercao) para chaves unicas nao esgotarem a memoria.
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

    let parsed;
    try {
      const raw = await readBody(req);
      parsed = JSON.parse(raw);
    } catch (err) {
      // Se a resposta ja foi enviada/socket morreu, nao tenta escrever de novo.
      if (res.writableEnded || res.destroyed) return;
      if (err && err.status === 413) {
        // Nao le mais o corpo: a leitura ja foi interrompida em readBody e o
        // request ficou pausado. Nao chamamos req.destroy() aqui de proposito:
        // destroy() manda RST e o cliente pode perder o 413 que acabamos de
        // enviar (era uma corrida real, aparecia sob carga). Com
        // 'connection: close' o proprio Node fecha a conexao de forma limpa
        // (FIN) depois da resposta.
        res.writeHead(413, { "content-type": "application/json", connection: "close" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: `Corpo muito grande (maximo ${MAX_BODY_BYTES} bytes).` },
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
      // so notificacoes
      res.writeHead(202, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end();
      return;
    }

    res.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify(responses.length === 1 && !Array.isArray(parsed) ? responses[0] : responses));
  });

  server.listen(port, () => {
    console.error(`[${SERVER_NAME}] v${SERVER_VERSION} no ar - modo HTTP (Render) na porta ${port}`);
  });
  server.on("error", (err) => {
    console.error(`[${SERVER_NAME}] erro no servidor HTTP:`, err);
    process.exit(1);
  });

  // O Render manda SIGTERM a cada deploy. Encerra limpo: para de aceitar
  // conexoes novas, deixa as requisicoes em andamento terminarem e sai.
  let encerrando = false;
  const encerrar = (sinal) => {
    if (encerrando) return;
    encerrando = true;
    console.error(`[${SERVER_NAME}] ${sinal} recebido — encerrando (aguardando ate 5s)...`);
    const prazo = setTimeout(() => {
      clearInterval(limpando);
      console.error(`[${SERVER_NAME}] prazo de encerramento esgotado, saindo.`);
      process.exit(0);
    }, 5000);
    prazo.unref();

    // O keep-alive dos clientes mantem conexoes abertas depois da resposta, e o
    // close() so completa quando todas fecharem. Fecha as ociosas agora e
    // reaplica enquanto houver alguma: as que estavam em uso viram ociosas
    // quando a requisicao em andamento termina.
    let limpando = null;
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

/* ------------------------------ selecao de modo ------------------------- */
// Render define PORT -> modo HTTP. Local -> stdio. `--http` forca HTTP, `--stdio` forca stdio.

const FORCE_HTTP = process.argv.includes("--http");
const FORCE_STDIO = process.argv.includes("--stdio");
const HTTP_MODE = FORCE_HTTP || (!FORCE_STDIO && !!process.env.PORT);

process.on("uncaughtException", (err) => {
  console.error(`[${SERVER_NAME}] excecao nao tratada:`, err);
});
process.on("unhandledRejection", (err) => {
  console.error(`[${SERVER_NAME}] rejeicao nao tratada:`, err);
});

if (HTTP_MODE) {
  await startHttp();
} else {
  startStdio();
}
