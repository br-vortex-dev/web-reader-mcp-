/**
 * Ferramentas do MCP: read_page, extract_links, read_multiple_pages,
 * read_dynamic_page, discover_urls, crawl_site, read_video.
 */

import {
  MAX_PAGES_PER_CALL,
  API_MAX_CANDIDATES,
  API_TOTAL_BUDGET_MS,
  MULTI_MAX_TOTAL_CHARS,
  FETCH_CONCURRENCY,
  DEFAULT_MAX_CHARS,
  HARD_MAX_CHARS,
  MEMO_CONVERSAO,
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
import { toolReadVideo } from "./video.mjs";
import { toolReadPdf } from "./pdf.mjs";
import { toolReadFeed, toolReadJson } from "./feeds.mjs";
import {
  ParametroInvalidoError,
  LimiteExcedidoError,
  FerramentaDesconhecidaError,
  CrawlError,
} from "./errors.mjs";

/* ===================================================================== *
 * Memoização da conversão (por conteúdo baixado)                          *
 * ===================================================================== */

/**
 * Converter HTML é a parte CARA da leitura (tokenize + htmlToMarkdown ≈ 3 ms
 * por página pequena, mais em páginas grandes). O payload do cache é estável
 * entre acertos — o MESMO objeto é devolvido — então memoizamos meta, markdown
 * e links num WeakMap chaveado por ele: o primeiro toque converte, os
 * seguintes só consultam. Conteúdo novo (TTL vencido, revalidação do SWR) =
 * objeto novo = conversão nova — a invalidação é a identidade do objeto.
 * WeakMap ainda garante que nada fica preso: sem referência, some com o payload.
 *
 * `conversoesMemo` é exposto no /health: `realizadas` são conversões de fato
 * executadas; `caronas` são consultas que acharam o resultado pronto.
 */
const memoConversao = new WeakMap();
export const conversoesMemo = { realizadas: 0, caronas: 0 };

function memoDoPayload(payload) {
  if (!MEMO_CONVERSAO) return null;
  let entrada = memoConversao.get(payload);
  if (!entrada) {
    entrada = {};
    memoConversao.set(payload, entrada);
  }
  return entrada;
}

function metaMemo(payload) {
  const memo = memoDoPayload(payload);
  if (!memo) {
    conversoesMemo.realizadas++;
    return extractMeta(payload.text);
  }
  if (!("meta" in memo)) {
    memo.meta = extractMeta(payload.text);
    conversoesMemo.realizadas++;
  } else {
    conversoesMemo.caronas++;
  }
  return memo.meta;
}

/**
 * Opções da conversão para exibição. `minCharsEntregaveis = HARD_MAX_CHARS`
 * liga a PARADA ANTECIPADA do parser: nenhuma leitura entrega mais que o teto
 * (clampMaxChars limita a HARD_MAX_CHARS), então páginas gigantes param de ser
 * convertidas assim que os caracteres entregáveis estão garantidos. O prefixo
 * exibido continua byte a byte idêntico ao da conversão completa — o que deixa
 * de ser feito é o parse do rabo que nunca sairia daqui (chega a 97% do custo
 * em páginas de 1 MB). A memoização compartilha UMA conversão entre todos os
 * usos do payload, então as opções são fixas aqui e valem para todos.
 */
const OPCOES_MARKDOWN_EXIBIVEL = { minCharsEntregaveis: HARD_MAX_CHARS };

// A parada antecipada pode interromper a conversão de páginas gigantes no teto
// de saída. O texto entregue continua idêntico (prefixo byte a byte), mas o
// número `Conteudo: N caracteres` não pode subnotificar a página: quando a
// conversão foi interrompida, ele sai como `N+` (havia mais além do teto).
const conversaoInterrompidaDe = new WeakMap();

function markdownInterrompida(payload) {
  return conversaoInterrompidaDe.get(payload) === true;
}

/** Valor do campo `Conteudo:` — com `+` quando a conversão foi interrompida. */
function fullLengthDe(payload, markdown) {
  return markdownInterrompida(payload) ? `${markdown.length}+` : markdown.length;
}

function markdownMemo(payload) {
  const memo = memoDoPayload(payload);
  if (!memo) {
    conversoesMemo.realizadas++;
    const diagnostico = { interrompida: false };
    const markdown = htmlToMarkdown(payload.text, payload.finalUrl, {
      ...OPCOES_MARKDOWN_EXIBIVEL,
      diagnostico,
    });
    conversaoInterrompidaDe.set(payload, Boolean(diagnostico.interrompida));
    return markdown;
  }
  if (!("markdown" in memo)) {
    const diagnostico = { interrompida: false };
    memo.markdown = htmlToMarkdown(payload.text, payload.finalUrl, {
      ...OPCOES_MARKDOWN_EXIBIVEL,
      diagnostico,
    });
    conversaoInterrompidaDe.set(payload, Boolean(diagnostico.interrompida));
    conversoesMemo.realizadas++;
  } else {
    conversoesMemo.caronas++;
  }
  return memo.markdown;
}

function linksMemo(payload) {
  const memo = memoDoPayload(payload);
  if (!memo) {
    conversoesMemo.realizadas++;
    return extractLinks(payload.text, payload.finalUrl);
  }
  if (!("links" in memo)) {
    memo.links = extractLinks(payload.text, payload.finalUrl);
    conversoesMemo.realizadas++;
  } else {
    conversoesMemo.caronas++;
  }
  return memo.links;
}

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

// Marcas de framework e casca vazia: a pagina monta o conteudo em JavaScript.
const MARCA_FRAMEWORK =
  /__NEXT_DATA__|__NUXT__|__INITIAL_STATE__|window\.__data|data-reactroot|data-reactid|ng-app|vue-app/i;
const RAIZ_VAZIA =
  /<div[^>]+id=["']root["'][^>]*>\s*<\/div>|<div[^>]+id=["']app["'][^>]*>\s*<\/div>/;

/**
 * O HTML carrega sinais de que o conteudo vem de JavaScript?
 * Comum a read_page e read_dynamic_page: as duas ferramentas tem de concordar
 * sobre o que e "pagina dinamica", senao uma manda extrair e a outra nao.
 */
function htmlIndicaDinamico(html) {
  return MARCA_FRAMEWORK.test(html) || RAIZ_VAZIA.test(html);
}

/**
 * Detecta se uma página provavelmente precisa de JavaScript.
 */
function isDynamicPage(html, markdown) {
  const visibleText = markdown.replace(/\s+/g, " ").trim();
  return htmlIndicaDinamico(html) || visibleText.length < 500;
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
  // decodeURIComponent LANÇA com percent-encoding malformado ("100%",
  // "%zz" — URLs que existem na web real). Sem a guarda, UMA URL assim
  // derrubava a extração inteira (extract_links, crawl e discover_urls).
  if (segmentos.some((s) => NAVIGATION_SEGMENTS.has(decodificarSegmento(s)))) return true;
  return url.includes("#");
}

/** Decodifica um segmento de URL sem lançar: % malformado fica como veio. */
function decodificarSegmento(segmento) {
  const minúsculo = segmento.toLowerCase();
  try {
    return decodeURIComponent(minúsculo);
  } catch {
    return minúsculo;
  }
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
  if (/Timeout após|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|TimeoutError|timeout/i.test(texto)) return "com timeout";
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
  const payload = await fetchTextCached(parsed.href, { timeoutMs });
  const { text: html, finalUrl, contentType } = payload;
  ensureHtml(contentType, html, finalUrl);
  if (isConteudoBruto(contentType, html)) {
    return conteudoBrutoResult(html, finalUrl, maxChars);
  }
  const meta = metaMemo(payload);
  let markdown = markdownMemo(payload);
  let interrompida = markdownInterrompida(payload);
  if (markdown.replace(/\s+/g, " ").trim().length < 300 && isDynamicPage(html, markdown)) {
    const dynamicMarkdown = await extractEmbeddedData(html, finalUrl, timeoutMs);
    if (dynamicMarkdown && dynamicMarkdown.length > markdown.length) {
      markdown = dynamicMarkdown;
      interrompida = false;
    }
  }
  const { text, truncated } = truncate(markdown, maxChars);
  const extraLabel =
    markdown.trim().length === 0
      ? "Aviso: 0 caracteres de conteudo estatico — a pagina provavelmente e renderizada por JavaScript. Tente read_dynamic_page."
      : undefined;
  return formatReadResult({ finalUrl, meta, text, truncated, fullLength: interrompida ? `${markdown.length}+` : markdown.length, extraLabel });
}

/**
 * Busca um termo no conteúdo de uma página e devolve só os trechos que casam,
 * com contexto — em vez de entregar a página inteira para a IA garimpar.
 *
 * Sem isso, achar um preço/tabela/parágrafo numa leitura de 25.000 caracteres
 * custava entregar os 25.000; aqui devolve as linhas que importam.
 *
 * `query` aceita texto literal (emoji, acento, pontuação — nada de regex por
 * surpresa) ou expressão regular quando `regex: true`. A busca é
 * case-insensitive por padrão (ligue `matchCase` para diferenciar).
 */
export async function toolFindOnPage(args) {
  const parsed = validateHttpUrl(args.url);
  const query = String(args.query ?? "");
  if (!query) throw new ParametroInvalidoError("query", "informe o termo a buscar");
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const maxHits = Math.max(1, Math.min(100, Number(args.maxHits) || 20));
  const contexto = Math.max(0, Math.min(5, Number(args.contexto) || 1));

  const payload = await fetchTextCached(parsed.href, { timeoutMs });
  const { text: html, finalUrl, contentType } = payload;
  ensureHtml(contentType, html, finalUrl);

  const conteudo = isConteudoBruto(contentType, html)
    ? html.replace(/\r\n?/g, "\n")
    : markdownMemo(payload);

  let matcher;
  if (args.regex) {
    try {
      matcher = new RegExp(query, args.matchCase ? "g" : "gi");
    } catch (err) {
      throw new ParametroInvalidoError("query", `regex inválida: ${err.message}`);
    }
  } else {
    const escapado = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    matcher = new RegExp(escapado, args.matchCase ? "g" : "gi");
  }

  // Trabalha por LINHAS: a linha é a unidade que a IA lê e cita. Cada
  // ocorrência marca a linha dela; o contexto são as linhas em volta.
  const linhas = conteudo.split("\n");
  const casadas = new Set();
  let total = 0;
  for (let i = 0; i < linhas.length; i++) {
    matcher.lastIndex = 0;
    if (matcher.test(linhas[i])) {
      total += 1;
      casadas.add(i);
    }
  }

  if (total === 0) {
    return (
      `Nenhuma ocorrencia de "${query}" em ${finalUrl}.\n` +
      `A pagina tem ${linhas.length} linha(s) e ${conteudo.length} caracteres. ` +
      `Confira o termo ou leia a pagina com read_page.`
    );
  }

  // Constrói os blocos com contexto, sem repetir linha e com teto de blocos.
  const indices = [...casadas].sort((a, b) => a - b);
  const blocos = [];
  let usadas = 0;
  const jaMostrada = new Set();
  for (const idx of indices) {
    if (blocos.length >= maxHits) break;
    const ini = Math.max(0, idx - contexto);
    const fim = Math.min(linhas.length - 1, idx + contexto);
    const trecho = [];
    for (let j = ini; j <= fim; j++) {
      if (jaMostrada.has(j)) continue;
      jaMostrada.add(j);
      const marcador = j === idx ? ">" : " ";
      trecho.push(`${marcador} ${String(j + 1).padStart(4)}| ${linhas[j]}`);
    }
    blocos.push(trecho.join("\n"));
    usadas += 1;
  }

  const mostradas = Math.min(total, maxHits);
  const cabecalho =
    `# Busca em: ${finalUrl}\n` +
    `Termo: "${query}"${args.regex ? " (regex)" : ""}\n` +
    `Ocorrencias: ${total} em ${linhas.length} linha(s)` +
    (total > mostradas ? ` — exibindo ${mostradas}` : "");
  return cabecalho + "\n\n" + blocos.join("\n\n") + (total > usadas ? `\n\n[... ${total - usadas} ocorrencia(s) alem do limite; aumente maxHits ...]` : "");
}

/**
 * Acessa uma página e lista seus links.
 */
export async function toolExtractLinks(args) {
  const parsed = validateHttpUrl(args.url);
  const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const payload = await fetchTextCached(parsed.href, { timeoutMs });
  const { finalUrl } = payload;
  ensureHtml("", payload.text, finalUrl);
  const all = linksMemo(payload);
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
  const maxChars = clampMaxChars(args.maxChars ?? DEFAULT_MAX_CHARS);
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
          return { ok: true, text: (await lerPaginaCompleta(url, maxChars, timeoutMs)).conteudo };
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
  const primeiraPosicao = new Map();
  urls.forEach((u, pos) => {
    if (!primeiraPosicao.has(u)) primeiraPosicao.set(u, pos);
  });
  urls.forEach((u, pos) => {
    const primeiraVez = pos === primeiraPosicao.get(u);
    if (!primeiraVez) {
      secoes.push(`(URL repetida — mesma leitura da seção ${primeiraPosicao.get(u) + 1} acima)`);
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

  const ok = unicas.filter((u) => lidos[indice.get(u)].ok).length;
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
 * Lê páginas que dependem de JavaScript (React, Vue, Angular, Next.js, etc.).
 */
export async function toolReadDynamicPage(args) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const payload = await fetchTextCached(parsed.href, { timeoutMs });
  const { text: html, finalUrl, contentType } = payload;
  ensureHtml(contentType, html, finalUrl);
  if (isConteudoBruto(contentType, html)) {
    return conteudoBrutoResult(html, finalUrl, maxChars);
  }
  const meta = metaMemo(payload);

  const pareceDinamica = htmlIndicaDinamico(html);

  if (!pareceDinamica) {
    const markdown = markdownMemo(payload);
    const { text, truncated } = truncate(markdown, maxChars);
    return formatReadResult({
      finalUrl,
      meta,
      text,
      truncated,
      fullLength: fullLengthDe(payload, markdown),
      extraLabel: "Pagina estatica (nao precisa de JavaScript)",
    });
  }

  const markdown = markdownMemo(payload);
  const estaticoCompleto = markdown.replace(/\s+/g, " ").trim().length >= 300;

  if (estaticoCompleto) {
    const { text, truncated } = truncate(markdown, maxChars);
    return formatReadResult({
      finalUrl,
      meta,
      text,
      truncated,
      fullLength: fullLengthDe(payload, markdown),
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
    fullLength: fullLengthDe(payload, markdown),
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

  const payload = await fetchTextCached(parsed.href, { timeoutMs });
  ensureHtml("", payload.text, payload.finalUrl);
  const internos = linksMemo(payload).filter((l) => l.internal);
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
 * Filtra os links internos uteis para seguir num crawl: mesmo dominio, nao a
 * propria pagina e fora dos padroes de navegacao (login, tag, paginacao...).
 * Opera sobre a lista MEMOIZADA do payload: a extracao roda uma vez por
 * conteudo baixado, nao uma vez por chamada.
 */
function linksParaCrawl(payload) {
  return linksMemo(payload)
    .filter((l) => l.internal && l.href !== payload.finalUrl && !isNavigationUrl(l.href))
    .map((l) => l.href);
}

/**
 * Le UMA pagina e devolve { conteudo, links }. E o unico lugar que conhece o
 * pipeline completo (fetch -> valida -> markdown/cru -> trunca), compartilhado
 * por read_multiple_pages e crawl_site.
 */
async function lerPaginaCompleta(url, maxChars, timeoutMs) {
  const parsed = validateHttpUrl(url);
  const payload = await fetchTextCached(parsed.href, { timeoutMs });
  const { text: html, finalUrl, contentType } = payload;
  ensureHtml(contentType, html, finalUrl);
  if (isConteudoBruto(contentType, html)) {
    return {
      conteudo: conteudoBrutoResult(html, finalUrl, maxChars),
      links: linksParaCrawl(payload),
    };
  }
  const meta = metaMemo(payload);
  const markdown = markdownMemo(payload);
  const { text, truncated } = truncate(markdown, maxChars);
  return {
    conteudo: formatReadResult({ finalUrl, meta, text, truncated, fullLength: fullLengthDe(payload, markdown) }),
    links: linksParaCrawl(payload),
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
    const primeira = await lerPaginaCompleta(start.href, maxChars, timeoutMs);
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
          return { ok: true, url, ...(await lerPaginaCompleta(url, maxChars, timeoutMs)) };
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
    case "read_video":
      return await toolReadVideo(args || {});
    case "read_pdf":
      return await toolReadPdf(args || {});
    case "read_feed":
      return await toolReadFeed(args || {});
    case "read_json":
      return await toolReadJson(args || {});
    case "find_on_page":
      return await toolFindOnPage(args || {});
    default:
      throw new FerramentaDesconhecidaError(name);
  }
}
