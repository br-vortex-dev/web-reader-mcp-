/**
 * Ferramentas do MCP: read_page, extract_links, read_multiple_pages,
 * read_dynamic_page, discover_urls, crawl_site.
 */

import {
  DEFAULT_MAX_CHARS,
  HARD_MAX_CHARS,
  MAX_PAGES_PER_CALL,
  API_MAX_CANDIDATES,
  API_TOTAL_BUDGET_MS,
  MULTI_MAX_TOTAL_CHARS,
  FETCH_CONCURRENCY,
} from "./config.mjs";
import {
  fetchTextCached,
  validateHttpUrl,
  clampMaxChars,
  clampTimeoutMs,
  truncate,
  formatReadResult,
  ensureHtml,
  isConteudoBruto,
  conteudoBrutoResult,
} from "./fetch.mjs";
import { htmlToMarkdown, extractMeta, extractLinks, hostOf } from "./html-parser.mjs";
import {
  ParametroInvalidoError,
  LimiteExcedidoError,
  FerramentaDesconhecidaError,
  CrawlError,
} from "./errors.mjs";

/**
 * Extrai JSON de uma tag <script> pelo id.
 */
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

/**
 * Extrai JSON-LD (application/ld+json).
 */
function extractJsonLd(html) {
  const results = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      results.push(data);
    } catch {
      // ignora JSON inválido
    }
  }
  return results;
}

/**
 * Extrai dados de scripts com window.__INITIAL_STATE__ ou similar.
 */
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
        // tenta o próximo padrão
      }
    }
  }
  return null;
}

/**
 * Extrai primitivos de um bloco JS (sem eval).
 */
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

/**
 * Converte um objeto JSON extraído em markdown legível.
 */
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

/**
 * Pontua um candidato a API interna.
 */
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
  if (u.search) score += 1;
  return score;
}

/**
 * Tenta achar APIs internas comuns em sites dinâmicos.
 */
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
        url = new URL(bruto, baseUrl).href;
      } catch {
        continue;
      }
      if (vistos.has(url)) continue;
      vistos.add(url);
      if (hostOf(url) !== baseHost) continue;
      candidatos.push({ url, score: scoreApiCandidate(url) });
    }
  }
  if (candidatos.length === 0) return [];

  candidatos.sort((a, b) => b.score - a.score);
  const alvos = candidatos.slice(0, API_MAX_CANDIDATES);

  const controller = new AbortController();
  const orcamento = setTimeout(() => controller.abort(), API_TOTAL_BUDGET_MS);
  const prazo = Date.now() + API_TOTAL_BUDGET_MS;
  try {
    const promises = alvos.map(async (alvo) => {
      try {
        const restante = Math.max(1000, Math.min(timeoutMs, prazo - Date.now()));
        const { text, contentType } = await fetchTextCached(alvo.url, {
          timeoutMs: restante,
          signal: controller.signal,
          retries: 0,
        });
        if (contentType && /json/.test(contentType)) {
          return { url: alvo.url, data: text.slice(0, 5000) };
        }
      } catch {
        // candidato que falha ou é cortado pelo orçamento
      }
      return null;
    });
    const results = await Promise.allSettled(promises);
    return results
      .filter((r) => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value);
  } finally {
    clearTimeout(orcamento);
  }
}

/**
 * Extrai dados embutidos de páginas dinâmicas.
 */
async function extractEmbeddedData(html, baseUrl, timeoutMs) {
  const sources = [];
  const nextData = extractJsonById(html, "__NEXT_DATA__");
  if (nextData) sources.push({ nome: "__NEXT_DATA__", dados: nextData });
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*([\s\S]*?);?\s*<\/script>/i);
  if (nuxtMatch) {
    const nuxtData = extractPrimitives(nuxtMatch[1]);
    if (Object.keys(nuxtData).length > 0) {
      sources.push({ nome: "__NUXT__", dados: nuxtData });
    }
  }
  const windowState = extractWindowState(html);
  if (windowState) sources.push({ nome: "__INITIAL_STATE__", dados: windowState });
  const jsonLd = extractJsonLd(html);
  if (jsonLd.length > 0) sources.push({ nome: "JSON-LD", dados: jsonLd });
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

/**
 * Detecta se uma página provavelmente precisa de JavaScript.
 */
function isDynamicPage(html, markdown) {
  const visibleText = markdown.replace(/\s+/g, " ").trim();
  const hasFrameworkScript =
    /__NEXT_DATA__|__NUXT__|__INITIAL_STATE__|window\.__data|data-reactroot|data-reactid|ng-app|vue-app/i.test(html);
  const hasEmptyRoot = /<div[^>]+id=["']root["'][^>]*>\s*<\/div>|<div[^>]+id=["']app["'][^>]*>\s*<\/div>/.test(html);
  const shortContent = visibleText.length < 500;
  return hasFrameworkScript || hasEmptyRoot || shortContent;
}

/**
 * Verifica se uma URL é de navegação (login, privacidade, termos, etc.).
 */
const NAVIGATION_SEGMENTS = new Set([
  "login", "signin", "signup", "register", "logout",
  "privacy", "terms", "about", "contact", "help", "faq", "support",
  "search", "cart", "checkout", "account", "profile", "settings", "admin",
  "wp-admin", "wp-login", "wp-content", "wp-json",
  "feed", "rss", "atom", "sitemap", "robots",
  "archive", "archives", "print", "share", "bookmark",
  "javascript", "mailto", "tag", "category", "author", "api",
  "comment", "comments",
]);

function isNavigationUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const segmentos = parsed.pathname.split("/").filter(Boolean);
  for (let i = 0; i < segmentos.length; i++) {
    const s = segmentos[i].toLowerCase();
    if ((s === "page" || s === "p") && /^\d+$/.test(segmentos[i + 1] || "")) return true;
  }
  if (segmentos.some((s) => NAVIGATION_SEGMENTS.has(decodeURIComponent(s).toLowerCase()))) return true;
  return url.includes("#");
}

/**
 * Classifica a falha de uma leitura para o resumo do crawl.
 */
function classifyFetchError(err) {
  const msg = String((err && err.message) || "");
  const code = String((err && err.cause && err.cause.code) || "");
  const texto = `${msg} ${code}`;
  if (/Host bloqueado/.test(msg)) return "bloqueadas por endereço privado/interno";
  if (/Redirect inválido: excesso de saltos/.test(msg)) return "com redirects em excesso";
  if (/Resposta muito grande/.test(msg)) return "com resposta grande demais";
  if (/aborted|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|TimeoutError|timeout/i.test(texto)) return "com timeout";
  if (/ENOTFOUND|EAI_AGAIN|não foi possível resolver o host/i.test(texto)) return "com host não resolvido (DNS)";
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET/i.test(texto)) {
    return "com conexão recusada/interrompida";
  }
  const http = msg.match(/HTTP (\d{3})/);
  if (http) return `com HTTP ${http[1]}`;
  if (/não é HTML|não parece ser HTML/.test(msg)) return "com conteúdo não-HTML";
  return "com outros erros";
}

/* ===================================================================== *
 * Ferramentas exportadas                                                   *
 * ===================================================================== */

/**
 * Lê uma página web e devolve o conteúdo extraído em markdown.
 */
export async function toolReadPage(args) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const { text: html, finalUrl, contentType } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml(contentType, html, finalUrl);
  if (isConteudoBruto(contentType, html)) {
    return conteudoBrutoResult(html, finalUrl, maxChars);
  }
  const meta = extractMeta(html);
  let markdown = htmlToMarkdown(html, finalUrl);
  if (markdown.replace(/\s+/g, " ").trim().length < 300 && isDynamicPage(html, markdown)) {
    const dynamicMarkdown = await extractEmbeddedData(html, finalUrl, timeoutMs);
    if (dynamicMarkdown && dynamicMarkdown.length > markdown.length) {
      markdown = dynamicMarkdown;
    }
  }
  const { text, truncated } = truncate(markdown, maxChars);
  const extraLabel =
    markdown.trim().length === 0
      ? "Aviso: 0 caracteres de conteudo estatico — a pagina provavelmente e renderizada por JavaScript. Tente read_dynamic_page."
      : undefined;
  return formatReadResult({ finalUrl, meta, text, truncated, fullLength: markdown.length, extraLabel });
}

/**
 * Acessa uma página e lista seus links.
 */
export async function toolExtractLinks(args) {
  const parsed = validateHttpUrl(args.url);
  const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const { text: html, finalUrl } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml("", html, finalUrl);
  const all = extractLinks(html, finalUrl);
  const shown = all.slice(0, limit);
  const lines = [`Links em ${finalUrl}: ${all.length} encontrados, exibindo ${shown.length}.`, ""];
  shown.forEach((link, index) => {
    lines.push(`${index + 1}. ${link.text}`);
    lines.push(`   ${link.href}${link.internal ? " (interno)" : " (externo)"}`);
  });
  return lines.join("\n");
}

/**
 * Lê várias páginas por chamada (máx 30 URLs, em lotes paralelos).
 */
export async function toolReadMultiplePages(args) {
  const urls = Array.isArray(args.urls) ? args.urls.map((u) => String(u)) : [];
  if (urls.length === 0) throw new ParametroInvalidoError("urls", "informe uma lista de URLs");
  if (urls.length > MAX_PAGES_PER_CALL) {
    throw new LimiteExcedidoError("URLs", MAX_PAGES_PER_CALL, urls.length);
  }
  const maxChars = clampMaxChars(args.maxChars ?? 4000);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);

  const unicas = [];
  const indice = new Map();
  for (const u of urls) {
    if (!indice.has(u)) {
      indice.set(u, unicas.length);
      unicas.push(u);
    }
  }
  const duplicadas = urls.length - unicas.length;

  const CONCURRENCY = FETCH_CONCURRENCY;
  const lidos = new Array(unicas.length);
  for (let start = 0; start < unicas.length; start += CONCURRENCY) {
    const lote = unicas.slice(start, start + CONCURRENCY);
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
      lidos[start + i] = resultado;
    });
  }

  const secoes = [];
  let total = 0;
  let omitidas = 0;
  urls.forEach((u, pos) => {
    const primeiraVez = pos === urls.indexOf(u);
    if (!primeiraVez) {
      secoes.push(`(URL repetida — mesma leitura da seção ${urls.indexOf(u) + 1} acima)`);
      return;
    }
    const r = lidos[indice.get(u)];
    if (total >= MULTI_MAX_TOTAL_CHARS) {
      omitidas++;
      secoes.push(`(omitida: teto de saída de ${MULTI_MAX_TOTAL_CHARS} caracteres já foi alcançado)`);
      return;
    }
    const restante = MULTI_MAX_TOTAL_CHARS - total;
    const texto = r.text.length > restante ? truncate(r.text, restante).text : r.text;
    total += texto.length;
    secoes.push(texto);
  });

  const ok = urls.filter((u, pos) => pos === urls.indexOf(u) && lidos[indice.get(u)].ok).length;
  const resumo = [
    `Leitura concluida: ${ok}/${unicas.length} paginas OK (lidas em lotes de ${CONCURRENCY}).`,
    duplicadas > 0 ? ` ${duplicadas} URL(s) repetida(s) lida(s) uma vez so.` : "",
    omitidas > 0 ? ` ${omitidas} secao(oes) omitida(s) por teto de saida total.` : "",
    "",
  ].join("");
  return (
    resumo +
    "\n" +
    secoes.join("\n\n========================================\n\n")
  );
}

/**
 * Lê UMA página do crawl.
 */
async function readOnePage(url, maxChars, timeoutMs) {
  const parsed = validateHttpUrl(url);
  const { text: html, finalUrl, contentType } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml(contentType, html, finalUrl);
  if (isConteudoBruto(contentType, html)) {
    return conteudoBrutoResult(html, finalUrl, maxChars);
  }
  const meta = extractMeta(html);
  const markdown = htmlToMarkdown(html, finalUrl);
  const { text, truncated } = truncate(markdown, maxChars);
  return formatReadResult({ finalUrl, meta, text, truncated, fullLength: markdown.length });
}

/**
 * Lê páginas que dependem de JavaScript (React, Vue, Angular, Next.js, etc.).
 */
export async function toolReadDynamicPage(args) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const { text: html, finalUrl, contentType } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml(contentType, html, finalUrl);
  if (isConteudoBruto(contentType, html)) {
    return conteudoBrutoResult(html, finalUrl, maxChars);
  }
  const meta = extractMeta(html);

  const hasFrameworkMarker =
    /__NEXT_DATA__|__NUXT__|__INITIAL_STATE__|window\.__data|data-reactroot|data-reactid|ng-app|vue-app/i.test(html);
  const hasEmptyRoot = /<div[^>]+id=["']root["'][^>]*>\s*<\/div>|<div[^>]+id=["']app["'][^>]*>\s*<\/div>/.test(html);
  const pareceDinamica = hasFrameworkMarker || hasEmptyRoot;

  if (!pareceDinamica) {
    const markdown = htmlToMarkdown(html, finalUrl);
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

  const markdown = htmlToMarkdown(html, finalUrl);
  const estaticoCompleto = markdown.replace(/\s+/g, " ").trim().length >= 300;

  if (estaticoCompleto) {
    const { text, truncated } = truncate(markdown, maxChars);
    return formatReadResult({
      finalUrl,
      meta,
      text,
      truncated,
      fullLength: markdown.length,
      extraLabel: "Conteudo estatico do HTML usado (dados embutidos nao substituiram — markdown completo)",
    });
  }

  const dynamicMarkdown = await extractEmbeddedData(html, finalUrl, timeoutMs);

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

  const { text, truncated } = truncate(markdown, maxChars);
  return formatReadResult({
    finalUrl,
    meta,
    text,
    truncated,
    fullLength: markdown.length,
    extraLabel: "Página dinâmica detectada, mas não foi possível extrair dados embutidos. Conteúdo estático abaixo.",
  });
}

/**
 * Descobre as URLs de um site (sitemap.xml ou links internos).
 */
export async function toolDiscoverUrls(args) {
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
      // tenta o próximo candidato
    }
  }

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
      `Encontradas ${sitemapUrls.length} URLs no sitemap de ${origin} (exibindo ${mostradas.length}, ${internas.length} do domínio):`,
      "",
      ...mostradas.map((u, i) => `${i + 1}. ${u}`),
      "",
      "Use read_multiple_pages para ler as que interessar.",
    ].join("\n");
  }

  const { text: html, finalUrl } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml("", html, finalUrl);
  const internos = extractLinks(html, finalUrl).filter((l) => l.internal);
  const mostrados = internos.slice(0, limite);
  if (mostrados.length === 0) {
    return `Nenhum sitemap encontrado em ${origin} e a página inicial não tem links internos. Use extract_links ou passe a URL diretamente.`;
  }
  return [
    `Sitemap não encontrado em ${origin}. ${internos.length} links internos na página inicial (exibindo ${mostrados.length}):`,
    "",
    ...mostrados.map((l, i) => `${i + 1}. ${l.text}\n   ${l.href}`),
    "",
    "Use read_multiple_pages para ler as que interessar.",
  ].join("\n");
}

/**
 * Lê UMA página do crawl.
 */
async function crawlOnePage(url, maxChars, timeoutMs) {
  const parsed = validateHttpUrl(url);
  const { text: html, finalUrl, contentType } = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml(contentType, html, finalUrl);
  if (isConteudoBruto(contentType, html)) {
    const links = extractLinks(html, finalUrl).filter(
      (l) => l.internal && l.href !== finalUrl && !isNavigationUrl(l.href)
    );
    return {
      conteudo: conteudoBrutoResult(html, finalUrl, maxChars),
      links: links.map((l) => l.href),
    };
  }
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

/**
 * Lê um site sozinho: BFS com extração de links.
 */
export async function toolCrawlSite(args) {
  const start = validateHttpUrl(args.url);
  const maxPages = Math.max(2, Math.min(30, Number(args.maxPages) || 10));
  const maxChars = clampMaxChars(args.maxChars ?? 2000);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const baseHost = hostOf(start.href);

  const visited = new Set([start.href]);
  const queue = [];
  const conteudos = [];
  const falhas = [];
  let lidas = 0;

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
    throw new CrawlError(start.href, err.message);
  }

  const CONCURRENCY = FETCH_CONCURRENCY;
  while (queue.length > 0 && lidas < maxPages) {
    const lote = [];
    while (
      lote.length < CONCURRENCY &&
      queue.length > 0 &&
      lidas + lote.length < maxPages
    ) {
      lote.push(queue.shift());
    }
    if (lote.length === 0) break;

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

/**
 * Despacha a chamada da ferramenta pelo nome.
 */
export async function callTool(name, args) {
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
      throw new FerramentaDesconhecidaError(name);
  }
}
