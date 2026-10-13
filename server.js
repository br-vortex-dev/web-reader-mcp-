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
 *   read_dynamic_page(url)    -> le paginas que dependem de JavaScript (Playwright, opcional)
 */

const SERVER_NAME = "web-reader";
const SERVER_VERSION = "1.0.0";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_CHARS = 8000;
const HARD_MAX_CHARS = 50000;
const MAX_PAGES_PER_CALL = 30;

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
};

function decodeEntities(input) {
  if (!input || input.indexOf("&") === -1) return input;
  return input.replace(
    /&(#[Xx][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g,
    (match, body) => {
      if (body[0] === "#") {
        const isHex = body[1] === "x" || body[1] === "X";
        const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
        try {
          return String.fromCodePoint(code);
        } catch {
          return "";
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

function cleanMarkdown(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Converte o HTML em markdown enxuto (titulos, listas, links, negrito, codigo, tabelas).
function htmlToMarkdown(html, baseUrl) {
  let out = "";
  let skipDepth = 0;
  let preDepth = 0;
  const openStack = [];
  const aStack = [];

  for (const token of tokenize(html)) {
    const isSkipped = SKIP_TAGS.has(token.tag);

    if (token.type === "text") {
      if (skipDepth > 0) continue;
      const decoded = decodeEntities(token.value);
      out += preDepth > 0 ? decoded : decoded.replace(/\s+/g, " ");
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
          out += "\n\n" + "#".repeat(Number(token.tag[1])) + " ";
          break;
        case "p": case "div": case "section": case "article": case "main":
        case "figure": case "figcaption": case "details": case "summary":
        case "ul": case "ol": case "dl": case "table": case "tbody":
        case "thead": case "tfoot": case "caption":
          out += "\n";
          break;
        case "blockquote":
          out += "\n> ";
          break;
        case "li":
          out += "- ";
          break;
        case "tr":
          out += "\n";
          break;
        case "th": case "td":
          out += " ";
          break;
        case "a": {
          const href = resolveUrl(token.attrs.href, baseUrl);
          aStack.push(href);
          if (href) out += "[";
          break;
        }
        case "strong": case "b":
          out += "**";
          break;
        case "em": case "i":
          out += "*";
          break;
        case "code":
          if (preDepth === 0) out += "`";
          break;
        case "pre":
          preDepth++;
          out += "\n\n```\n";
          break;
        case "br":
          out += "\n";
          break;
        case "hr":
          out += "\n\n---\n\n";
          break;
        case "img": {
          const src = resolveUrl(token.attrs.src, baseUrl);
          const alt = (token.attrs.alt || "").trim();
          if (src) out += `![${alt}](${src})`;
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
      case "ul": case "ol": case "dl": case "table": case "blockquote":
      case "figure": case "figcaption": case "details":
        out += "\n\n";
        break;
      case "li": case "tr": case "tbody": case "thead": case "tfoot":
        out += "\n";
        break;
      case "th": case "td":
        out += " |";
        break;
      case "a": {
        const href = aStack.pop();
        if (href) out += `](${href})`;
        break;
      }
      case "strong": case "b":
        out += "**";
        break;
      case "em": case "i":
        out += "*";
        break;
      case "code":
        if (preDepth === 0) out += "`";
        break;
      case "pre":
        if (preDepth > 0) preDepth--;
        out += "\n\n```\n\n";
        break;
      default:
        break;
    }
  }

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
        current = { href: resolveUrl(token.attrs.href, baseUrl), parts: [] };
      }
    } else if (token.type === "close") {
      if (isSkipped) {
        if (skipDepth > 0) skipDepth--;
        continue;
      }
      if (skipDepth > 0) continue;
      if (token.tag === "a" && current) {
        const href = current.href;
        const text = decodeEntities(current.parts.join("")).replace(/\s+/g, " ").trim();
        current = null;
        if (href && !seen.has(href)) {
          seen.add(href);
          links.push({
            text: text || "(sem texto)",
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText || ""}`.trim() + ` ao acessar ${url}`);
        err.status = res.status;
        throw err;
      }
      return {
        text: await res.text(),
        finalUrl: res.url || url,
        contentType: (res.headers.get("content-type") || "").toLowerCase(),
      };
    } catch (err) {
      lastError = err;
      const retriable = err && (err.status === 429 || err.status === 503 || err.status === 500);
      if (!retriable || attempt === retries) throw err;
      await sleep(400 * 2 ** attempt); // 400ms, 800ms
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

// Cache em memoria (LRU + TTL): evita rebaixar a mesma pagina e reduz
// bloqueios por requisicao repetida. Some no restart (stateless no Render).
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;
const pageCache = new Map();

async function fetchTextCached(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    pageCache.delete(url);
    pageCache.set(url, hit);
    return hit.payload;
  }
  const payload = await fetchText(url, { timeoutMs });
  pageCache.set(url, { at: Date.now(), payload });
  if (pageCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = pageCache.keys().next().value;
    pageCache.delete(oldestKey);
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
  const markdown = htmlToMarkdown(html, finalUrl);
  const { text, truncated } = truncate(markdown, maxChars);
  return formatReadResult({ finalUrl, meta, text, truncated, fullLength: markdown.length });
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
  const CONCURRENCY = 6;
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

async function toolReadDynamicPage(args) {
  const parsed = validateHttpUrl(args.url);
  const timeoutMs = Math.max(2000, Math.min(120000, Number(args.timeoutMs) || 30000));
  const maxChars = clampMaxChars(args.maxChars);

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error(
      "read_dynamic_page precisa do Playwright (opcional). Para ativar:\n\n" +
        '  cd "C:\\Users\\Administrator\\Desktop\\FORA lula\\web-reader-mcp"\n' +
        "  npm install playwright\n" +
        "  npx playwright install chromium\n\n" +
        "Enquanto isso, use read_page e extract_links (nao precisam de JS)."
    );
  }

  const launchAttempts = [
    { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] },
    { headless: true, channel: "msedge" },
    { headless: true, channel: "chrome" },
  ];
  let browser = null;
  let lastError = null;
  for (const options of launchAttempts) {
    try {
      browser = await playwright.chromium.launch(options);
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!browser) {
    throw new Error(
      `Falha ao iniciar navegador headless: ${lastError && lastError.message}. ` +
        "Instale o navegador com: npx playwright install chromium"
    );
  }

  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(parsed.href, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    try {
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10000) });
    } catch {
      // segue com o que ja renderizou
    }
    const renderedHtml = await page.content();
    const meta = extractMeta(renderedHtml);
    const markdown = htmlToMarkdown(renderedHtml, page.url());
    const { text, truncated } = truncate(markdown, maxChars);
    return formatReadResult({
      finalUrl: page.url(),
      meta,
      text,
      truncated,
      fullLength: markdown.length,
      extraLabel: "(pagina renderizada — JavaScript executado)",
    });
  } finally {
    await browser.close().catch(() => {});
  }
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
async function toolCrawlSite(args) {
  const start = validateHttpUrl(args.url);
  const maxPages = Math.max(2, Math.min(30, Number(args.maxPages) || 10));
  const maxChars = clampMaxChars(args.maxChars ?? 2000);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const baseHost = hostOf(start.href);

  const visited = new Set();
  const queue = [start.href];
  const paginas = [];
  const CONCURRENCY = 6;

  while (queue.length > 0 && paginas.length < maxPages) {
    const lote = [];
    while (
      lote.length < CONCURRENCY &&
      queue.length > 0 &&
      paginas.length + lote.length < maxPages
    ) {
      const proxima = queue.shift();
      if (proxima && !visited.has(proxima)) {
        visited.add(proxima);
        lote.push(proxima);
      }
    }
    if (lote.length === 0) break;

    const resultados = await Promise.all(
      lote.map(async (url) => {
        try {
          const parsed = validateHttpUrl(url);
          const { text: html, finalUrl } = await fetchTextCached(parsed.href, { timeoutMs });
          ensureHtml("", html);
          const meta = extractMeta(html);
          const markdown = htmlToMarkdown(html, finalUrl);
          const { text, truncated } = truncate(markdown, maxChars);
          const linksInternos = extractLinks(html, finalUrl).filter(
            (l) => l.internal && l.href !== finalUrl
          );
          return {
            ok: true,
            conteudo: formatReadResult({
              finalUrl,
              meta,
              text,
              truncated,
              fullLength: markdown.length,
            }),
            links: linksInternos.map((l) => l.href),
          };
        } catch (err) {
          return { ok: false, url, erro: err.message };
        }
      })
    );

    for (const r of resultados) {
      if (r.ok) {
        paginas.push(r.conteudo);
        for (const href of r.links) {
          if (!visited.has(href)) queue.push(href);
        }
      } else {
        paginas.push(`# Erro ao ler ${r.url}\n${r.erro}`);
      }
    }
  }

  const ok = paginas.filter((p) => !p.startsWith("# Erro")).length;
  return (
    `Crawl de ${start.href}: ${ok} paginas lidas (limite ${maxPages}, dominio ${baseHost}).\n\n` +
    paginas.join("\n\n========================================\n\n")
  );
}

async function callTool(name, args) {
  switch (name) {
    case "read_page":
      return await toolReadPage(args || {});
    case "extract_links":
      return await toolExtractLinks(args || {});
    case "read_multiple_pages":
      return await toolReadMultiplePages(args || {});
    case "read_dynamic_page":
      return await toolReadDynamicPage(args || {});
    case "discover_urls":
      return await toolDiscoverUrls(args || {});
    case "crawl_site":
      return await toolCrawlSite(args || {});
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
          description: "Lista de URLs (http/https), maximo 10",
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
    name: "read_dynamic_page",
    description:
      "Le paginas cujo conteudo so aparece depois de executar JavaScript (SPAs, feeds, paginas com scroll infinito). " +
      "Usa um navegador headless via Playwright. " +
      "Requer instalacao opcional: npm install playwright && npx playwright install chromium. " +
      "Preferir read_page quando a pagina for HTML estatico.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL da pagina" },
        maxChars: { type: "number", description: "Maximo de caracteres do conteudo (padrao 8000)" },
        timeoutMs: { type: "number", description: "Timeout total em ms (padrao 30000)" },
      },
      required: ["url"],
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

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > 2_000_000) {
          reject(new Error("corpo muito grande"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
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
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(`web-reader-mcp v${SERVER_VERSION} OK`);
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
      if (token !== AUTH_TOKEN) {
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

    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain", Allow: "POST" });
      res.end("Use POST /mcp com o JSON-RPC do MCP.");
      return;
    }

    let parsed;
    try {
      const raw = await readBody(req);
      parsed = JSON.parse(raw);
    } catch {
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
