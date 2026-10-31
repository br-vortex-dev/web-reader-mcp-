
/**
 * tools.mjs — as ferramentas do MCP e o pipeline de leitura de uma página.
 *
 * O QUE É
 *   O arquivo que liga o nome da ferramenta (`read_page`, `crawl_site`,
 *   `read_video`...) à função que faz o trabalho. E, principalmente, o dono de
 *   `lerPaginaCompleta`: o caminho ÚNICO de "baixar → converter → responder"
 *   compartilhado por read_page, read_multiple_pages, crawl_site e as demais.
 *   Ter um caminho só é o que garante que o teto de caracteres, o cache, o
 *   robots e o aviso de truncamento valham igual em todas as ferramentas.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: o nome da ferramenta e os argumentos que o cliente MCP mandou.
 *   Sai:   o resultado no formato MCP (conteúdo + isError quando falhou).
 *
 * QUEM USA
 *   Usado por: server.mjs (stdio) e http-transport.mjs (HTTP).
 *   Importa de: config, conversao, errors, feeds, fetch, html-parser, pdf,
 *   snapshot, video.
 */

import {
  MAX_PAGES_PER_CALL,
  MAX_PRAZO_MULTI_MS,
  PRAZO_MINIMO_MULTI_MS,
  API_MAX_CANDIDATES,
  API_TOTAL_BUDGET_MS,
  MULTI_MAX_TOTAL_CHARS,
  FETCH_CONCURRENCY,
  DEFAULT_MAX_CHARS,
  MAX_RESPONSE_BYTES,
  MAX_RESPONSE_BYTES_DOCUMENTO,
  CHECKPOINT_ANTECIPADO_BYTES,
  MARGEM_PARADA_DOWNLOAD,
  tetoDownloadPara,
} from "./config.mjs";
import {
  fetchTextCached,
  fetchTextComTeto,
  fetchTextDocumentoCached,
  validateHttpUrl,
  clampMaxChars,
  clampTimeoutMs,
  truncate,
  formatReadResult,
  ensureHtml,
  isConteudoBruto,
  conteudoBrutoResult,
} from "./fetch.mjs";
import { hostOf, decodeEntities } from "./html-parser.mjs";
import { registrarPedidoQuente } from "./warmer.mjs";
import {
  memoDoPayload,
  conversoesMemo,
  metaMemo,
  markdownMemo,
  markdownDeTexto,
  markdownCompleto,
  linksMemo,
  markdownELinksMemo,
  markdownInterrompida,
  fullLengthDe,
} from "./conversao.mjs";
import { toolReadVideo } from "./video.mjs";
import { toolReadPdf } from "./pdf.mjs";
import { toolReadFeed, toolReadJson } from "./feeds.mjs";
import {
  buscarMarca,
  guardarMarca,
  chaveSnapshot,
  hashConteudo,
  normalizarParaDiff,
  diffDeLinhas,
  formatarSaidaDiff,
  tamanhoDaMarca,
  TEXTO_DA_MARCA,
} from "./snapshot.mjs";
import { urlSemCredenciais, chaveCanonica } from "./utils.mjs";
import {
  ParametroInvalidoError,
  LimiteExcedidoError,
  FerramentaDesconhecidaError,
  CrawlError,
  RespostaMuitoGrandeError,
} from "./errors.mjs";

/**
 * O conteúdo embutido (__NEXT_DATA__, JSON-LD, API interna) memoizado por
 * payload.
 *
 * Existe porque essa etapa é a MAIS CARA do read_page numa página dinâmica e
 * ela rodava de novo a cada leitura do MESMO HTML. Medido no washingtonpost
 * (dev/_diag-quente.mjs): com o HTML no cache, o fetch custa 1 ms, o meta 7 e
 * o markdown 33 — mas a chamada inteira levava 561 ms, e 10 chamadas seguidas
 * levavam 3.567 ms. Todo esse tempo era esta função refazendo o trabalho:
 * varrer 4,4 MB de HTML em busca de candidatos e depois esperar a API interna
 * (orçamento de API_TOTAL_BUDGET_MS) para devolver exatamente o mesmo texto.
 *
 * A chave `null` é um resultado válido ("esta página não tem conteúdo
 * embutido") e por isso é testada com `in`, não com comparação de valor.
 */
async function embeddedMemo(payload, timeoutMs) {
  const memo = memoDoPayload(payload);
  if (!memo) return await extractEmbeddedData(payload.text, payload.finalUrl, timeoutMs);
  if (!("embedded" in memo)) {
    memo.embedded = await extractEmbeddedData(payload.text, payload.finalUrl, timeoutMs);
    conversoesMemo.realizadas++;
  } else {
    conversoesMemo.caronas++;
  }
  return memo.embedded;
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
 *
 * `estado.chars` é o orçamento compartilhado da conversão: um __NEXT_DATA__ ou
 * uma resposta de API grande montava a string inteira em memória antes de
 * qualquer truncate (o read_page só corta no fim). Ao estourar o teto, a
 * conversão para e a saída diz que parou.
 */
const LIMITE_MD_JSON = 200_000;

function jsonToMarkdown(data, depth = 0, seen = new Set(), estado = { chars: 0 }) {
  if (estado.chars >= LIMITE_MD_JSON) return "(limite de dados embutidos atingido)";
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data;
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  if (depth > 10) return "(profundidade máxima atingida)";
  if (typeof data === "object") {
    if (seen.has(data)) return "(referência circular)";
    seen.add(data);
    try {
      if (Array.isArray(data)) {
        const itens = [];
        for (const item of data) {
          if (estado.chars >= LIMITE_MD_JSON) break;
          const md = jsonToMarkdown(item, depth + 1, seen, estado);
          if (!md) continue;
          const linha = `- ${md}`;
          estado.chars += linha.length;
          itens.push(linha);
        }
        return itens.join("\n");
      }
      const lines = [];
      for (const [key, value] of Object.entries(data)) {
        if (estado.chars >= LIMITE_MD_JSON) break;
        if (value === null || value === undefined) continue;
        const formatted = jsonToMarkdown(value, depth + 1, seen, estado);
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
// Ter <script> nao basta para chamar a pagina de dinamica (quase toda pagina
// estatica tem um, ate o example.com) — por isso isto NAO entra no
// htmlIndicaDinamico. Nem o tamanho absoluto basta: o que separa os dois casos
// reais que ja apareceram e a DESPROPORCAO. O example.com entrega 156
// caracteres num documento de 620 bytes (a pagina toda); o
// quotes.toscrape.com/js entrega 95 num documento de 5,8 KB de jQuery e
// scripts que montam a lista. Um documento que gasta muitos bytes para dizer
// quase nada e uma casca; um documento minusculo que diz tudo o que tem e uma
// pagina curta. O piso de bytes evita que um beacon em pagina minuscula entre
// so pela proporcao.
const TEM_SCRIPT = /<script[\s>]/i;
const CASCA_PISO_BYTES = 4096;
const CASCA_PROPORCAO = 16;

/**
 * O HTML carrega sinais de que o conteudo vem de JavaScript?
 * Comum a read_page e read_dynamic_page: as duas ferramentas tem de concordar
 * sobre o que e "pagina dinamica", senao uma manda extrair e a outra nao.
 */
function htmlIndicaDinamico(html) {
  return MARCA_FRAMEWORK.test(html) || RAIZ_VAZIA.test(html);
}

/**
 * Quanto texto visível já basta para considerar a página "lida".
 *
 * Existem dois limiares, e eles NÃO são contraditórios — respondem perguntas
 * diferentes:
 *
 *   - TEXTO_MINIMO_UTIL (300): abaixo disto, a página quase certamente é uma
 *     casca de JavaScript e vale tentar extrair os dados embutidos. É usado
 *     pelo read_page para decidir se aciona a extração de fallback.
 *
 *   - TEXTO_MINIMO_ESTATICO (500): abaixo disto, a página é considerada
 *     dependente de JavaScript (isDynamicPage). É mais alto porque aqui a
 *     pergunta é outra: "dá para confiar que esta página é estática?". Entre
 *     300 e 500 caracteres a resposta honesta é "não sei" — e o código prefere
 *     dizer que é dinâmica a afirmar que é estática e entregar pouco texto.
 */
const TEXTO_MINIMO_UTIL = 300;
const TEXTO_MINIMO_ESTATICO = 500;

/**
 * Detecta se uma página provavelmente precisa de JavaScript.
 * `visivel` permite reaproveitar a contagem de texto já calculada pelo
 * chamador — a mesma varredura era feita duas vezes por leitura.
 */
function isDynamicPage(html, markdown, visivel = comprimentoVisivel(markdown)) {
  return htmlIndicaDinamico(html) || visivel < TEXTO_MINIMO_ESTATICO;
}

function comprimentoVisivel(markdown) {
  return markdown.replace(/\s+/g, " ").trim().length;
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

/**
 * Arquivo que NUNCA é uma página legível: folha de estilo, script, imagem,
 * fonte, mídia ou pacote. O crawl medido em dev/_probe-crawl-fases.mjs gastava
 * 93% do tempo baixando, e uma página inicial típica tem dezenas destes links
 * — baixar um .css de 300 KB para concluir que não tem texto é download
 * jogado fora em cada rodada do BFS.
 */
const EXTENSOES_ASSET = new Set([
  "css", "js", "mjs", "map",
  "ico", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "m4a", "webm", "ogg", "wav",
  "zip", "gz", "tar", "rar", "7z",
]);

function ehArquivoEstatico(href) {
  let parsed;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  const ponto = parsed.pathname.lastIndexOf(".");
  if (ponto < 0) return false;
  return EXTENSOES_ASSET.has(parsed.pathname.slice(ponto + 1).toLowerCase());
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
 * Busca uma página com o teto de download proporcional — agora um MARCO de
 * conferência, não o fim do download.
 *
 * O desenho anterior baixava até o teto apertado e, quando o texto convertido
 * não cobria o pedido, pagava uma SEGUNDA conexão no teto largo. A pergunta (o
 * texto que chegou já cobre o pedido?) sempre foi a certa; o desperdício era
 * fechar a conexão para fazê-la de novo.
 *
 * Agora o download PAUSA no teto apertado e no marco antecipado, converte o
 * que já chegou e decide:
 *
 *   - o texto cobre o `maxChars` com folga -> para AQUI, na mesma conexão, e
 *     reaproveita a conversão recém-feita no resultado;
 *   - ainda não cobre -> a MESMA conexão continua até o próximo marco (ou o
 *     teto largo). Existe UMA leitura por página, sempre.
 *
 * A folga (MARGEM_PARADA_DOWNLOAD) garante o contrato: o parser só pode
 * divergir no rabo do documento cortado, que fica DEPOIS da margem — os
 * caracteres entregues são idênticos aos de uma conversão completa.
 */
async function buscarComTetoInteligente(parsed, { maxChars, timeoutMs, largoBytes = MAX_RESPONSE_BYTES }) {
  // O teto largo NUNCA passa do teto duro declarado pelo servidor. Tentar
  // abrir até MAX_RESPONSE_BYTES_DOCUMENTO aqui parecia um ganho (lia a
  // documentação de 8 MB do nodejs), mas quebrava o contrato que
  // tests/parada-antecipada.test.mjs trava: com MAX_RESPONSE_BYTES baixo, o
  // read_page TEM de falhar com "Resposta muito grande" em vez de baixar
  // tudo. Ferramenta que precisa do documento inteiro tem caminho próprio
  // (fetchTextDocumentoCached), e é lá que esse teto vale.
  const largo = Math.max(largoBytes, MAX_RESPONSE_BYTES);
  const apertado = tetoDownloadPara(maxChars, largo);
  // Marcos em ordem: o teto proporcional (o ponto onde o desenho antigo
  // cortava) e o marco antecipado. Sem nenhum marco abaixo do largo — é o que
  // acontece quando o teto proporcional está desligado — o comportamento é o
  // de sempre: baixar até o largo e falhar se passar.
  const marcos = [...new Set([apertado, CHECKPOINT_ANTECIPADO_BYTES])]
    .filter((n) => n < largo)
    .sort((a, b) => a - b);
  const sabor = `p${largo > MAX_RESPONSE_BYTES ? "d" : ""}${maxChars}`;
  if (!marcos.length) {
    return fetchTextComTeto(parsed.href, { timeoutMs, largoBytes: largo, sabor });
  }
  const limiar = maxChars + MARGEM_PARADA_DOWNLOAD;
  let markdownPronto = null;
  let textoPronto = null;
  const aoCheckpoint = (texto, { contentType, finalUrl }) => {
    // Texto puro/XML não passa por conversão e o cabeçalho dele não marca
    // parcial — parar cedo aqui economizaria download, mas subnotificaria a
    // página. Fica de fora.
    if (isConteudoBruto(contentType, texto)) return false;
    // Fora do que o ensureHtml aceita (JSON, binário disfarçado): não vale
    // converter agora, a chamada vai recusar logo depois.
    if (contentType ? !/html|xml|text\//.test(contentType) : !/^\s*</.test(texto)) return false;
    const markdown = markdownDeTexto(texto, finalUrl);
    if (markdown.length < limiar) return false;
    markdownPronto = markdown;
    textoPronto = texto;
    return true;
  };
  const payload = await fetchTextComTeto(parsed.href, {
    timeoutMs,
    largoBytes: largo,
    checkpoints: marcos,
    aoCheckpoint,
    sabor,
  });
  if (markdownPronto === null) return payload;
  return { ...payload, text: textoPronto, markdownPronto };
}

/** Markdown da página: o da conferência do download, quando houve parada. */
function markdownDaPagina(payload) {
  return payload.markdownPronto === undefined ? markdownMemo(payload) : payload.markdownPronto;
}

/**
 * Lê uma página web e devolve o conteúdo extraído em markdown.
 */
export async function toolReadPage(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  // `largoBytes` NÃO recebe MAX_RESPONSE_BYTES_DOCUMENTO: o read_page respeita
  // o teto duro do servidor (é o contrato que tests/parada-antecipada.mjs
  // trava). O read_dynamic_page, sim — ver abaixo.
  const payload = await buscarComTetoInteligente(parsed, { maxChars, timeoutMs });
  const { text: html, finalUrl, contentType } = payload;
  ensureHtml(contentType, html, finalUrl);
  // O placar do aquecedor só aceita página que o cache comporta — daí a
  // checagem de tamanho lá dentro. Leitura cortada sem tamanho declarado fica
  // de fora: não dá para saber se aquecer seria baixar para descartar.
  registrarPedidoQuente(parsed.href, payload);
  if (isConteudoBruto(contentType, html)) {
    return conteudoBrutoResult(html, finalUrl, maxChars);
  }
  const meta = metaMemo(payload);
  let markdown = markdownDaPagina(payload);
  let textoVisivel = comprimentoVisivel(markdown);
  if (textoVisivel < TEXTO_MINIMO_UTIL && isDynamicPage(html, markdown, textoVisivel)) {
    const dynamicMarkdown = await embeddedMemo(payload, timeoutMs);
    if (dynamicMarkdown && dynamicMarkdown.length > markdown.length) {
      markdown = dynamicMarkdown;
      textoVisivel = comprimentoVisivel(markdown);
    }
  }
  const { text, truncated } = truncate(markdown, maxChars);
  // O aviso de "casca de JavaScript" disparava so com 0 caracteres, mas uma
  // pagina renderizada por JS quase sempre deixa migalhas — o <h1>, o link de
  // login. Medido em producao: 95 caracteres entregues como se fossem a pagina
  // toda, sem nada que dissesse "procura noutro lado". O texto curto so vira
  // aviso com o documento a indicar casca (ver CASCA_PROPORCAO): o
  // contrario troca uma pagina quebada por uma pagina curta.
  const estaticoCurto = textoVisivel < TEXTO_MINIMO_UTIL;
  // As duas marcas de casca varrem o documento INTEIRO (megabytes nas paginas
  // grandes) e o resultado so e usado quando o texto e curto — numa pagina
  // cheia de conteudo ele era jogado fora depois da varredura completa.
  const cascaDeJavaScript =
    estaticoCurto &&
    (htmlIndicaDinamico(html) ||
      (TEM_SCRIPT.test(html) && html.length >= CASCA_PISO_BYTES && html.length > CASCA_PROPORCAO * (textoVisivel + 1)));
  let extraLabel =
    markdown.trim().length === 0 || (estaticoCurto && cascaDeJavaScript)
      ? `Aviso: conteudo estatico muito curto (${markdown.trim().length} caracteres) — a pagina provavelmente e renderizada por JavaScript. Tente read_dynamic_page.`
      : undefined;
  return formatReadResult({ finalUrl, meta, text, truncated, fullLength: fullLengthDe(payload, markdown), extraLabel });
}

function buscarNasLinhas(linhas, matcher, maxContagem = 10000) {
  const casadas = new Set();
  let total = 0;
  let saturada = false;
  for (let i = 0; i < linhas.length; i++) {
    matcher.lastIndex = 0;
    let achou = false;
    let m;
    // exec em vez de test: o número de OCORRÊNCIAS deixa de ser o número de
    // linhas que casaram (uma linha com três "R$" contava como uma).
    while ((m = matcher.exec(linhas[i])) !== null) {
      achou = true;
      total++;
      // Regex de comprimento zero ("^", "x*") não avança sozinha: sem isto o
      // laço não termina.
      if (m[0] === "") matcher.lastIndex++;
      if (total >= maxContagem) {
        saturada = true;
        break;
      }
    }
    if (achou) casadas.add(i);
    if (saturada) break;
  }
  return { total, casadas, saturada };
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
export async function toolFindOnPage(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const query = String(args.query ?? "");
  if (!query) throw new ParametroInvalidoError("query", "informe o termo a buscar");
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const maxHits = Math.max(1, Math.min(100, Number(args.maxHits) || 20));
  // `Number(args.contexto) || 1` transformava o 0 (pedido válido: só a linha
  // do acerto, sem vizinhas) em 1. Zero é um valor legítimo; só ausência ou
  // lixo viram o padrão.
  const pedidoDeContexto = Number(args.contexto);
  const contexto = Number.isFinite(pedidoDeContexto)
    ? Math.max(0, Math.min(5, Math.floor(pedidoDeContexto)))
    : 1;

  const payload = await fetchTextDocumentoCached(parsed.href, { timeoutMs });
  const { text: html, finalUrl, contentType } = payload;
  ensureHtml(contentType, html, finalUrl);

  const bruto = isConteudoBruto(contentType, html);
  let conteudo = bruto ? html.replace(/\r\n?/g, "\n") : markdownMemo(payload);
  let interrompida = !bruto && markdownInterrompida(payload);

  let matcher;
  if (args.regex) {
    // Regex do chamador roda sobre linhas da página: um padrão patológico
    // ("(a+)+$") trava o processo num texto longo — e o processo é o servidor
    // inteiro. Recusa os aninhamentos clássicos e impõe teto de tamanho.
    if (query.length > 500) {
      throw new ParametroInvalidoError("query", "regex com mais de 500 caracteres");
    }
    if (/(\([^()]*[*+][^()]*\)\s*[*+])|(\[[^\]]*[*+][^\]]*\]\s*[*+])/.test(query)) {
      throw new ParametroInvalidoError(
        "query",
        "regex com quantificador dentro de grupo quantificado (risco de travamento); simplifique o padrão"
      );
    }
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
  let linhas = conteudo.split("\n");
  let { total, casadas, saturada } = buscarNasLinhas(linhas, matcher);

  // A parada antecipada converte só a frente da página. Se ela não teve
  // NENHUM acerto, responder "nenhuma ocorrencia" seria mentira quando o termo
  // está no rabo (medido em nodejs.org/api/all.html e no spec do WHATWG, onde
  // o termo existia mas a busca só cobria os primeiros ~59 mil caracteres).
  // Nesse caso — e só nele — a página é convertida inteira uma vez e a busca
  // roda de novo antes da resposta negativa.
  if (interrompida && total === 0) {
    conteudo = markdownCompleto(payload);
    interrompida = false;
    linhas = conteudo.split("\n");
    ({ total, casadas, saturada } = buscarNasLinhas(linhas, matcher));
  }

  // Cobertura da busca. Há dois modos de a ferramenta ver só um pedaço da
  // página: o download cortado no teto de bytes, e a conversão interrompida
  // que ficou valendo porque HOUVE acertos na frente coberta (aí o rabo não é
  // convertido e o aviso diz que o termo pode estar no resto).
  const avisoCobertura = payload.cortado
    ? `\nAVISO: documento maior que o teto de download — a busca cobre apenas os primeiros ` +
      `${payload.bytes} bytes, nao a pagina inteira.`
    : interrompida
    ? `\nAVISO: a pagina e grande demais para converter inteira — a busca cobriu os primeiros ` +
      `${conteudo.length} caracteres do texto extraido, nao a pagina toda. O termo pode estar no resto.`
    : "";

  if (total === 0) {
    return (
      `Nenhuma ocorrencia de "${query}" em ${finalUrl}.\n` +
      `A pagina tem ${linhas.length} linha(s) e ${conteudo.length} caracteres. ` +
      `Confira o termo ou leia a pagina com read_page.` +
      avisoCobertura
    );
  }

  // Constrói os blocos com contexto. O mapa guarda TODAS as linhas que devem
  // aparecer (acerto = true, contexto = false): antes, uma linha que era
  // contexto de um acerto anterior sumia do bloco do acerto seguinte — e o
  // marcador ">" do acerto ficava escondido. Linhas fora do mapa viram uma
  // quebra "..." entre blocos.
  const indices = [...casadas].sort((a, b) => a - b).slice(0, maxHits);
  const marcadas = new Map();
  for (const idx of indices) {
    const ini = Math.max(0, idx - contexto);
    const fim = Math.min(linhas.length - 1, idx + contexto);
    for (let j = ini; j <= fim; j++) {
      if (j === idx) marcadas.set(j, true);
      else if (!marcadas.has(j)) marcadas.set(j, false);
    }
  }
  const ordenadas = [...marcadas.keys()].sort((a, b) => a - b);
  const blocos = [];
  let atual = [];
  let anterior = null;
  for (const j of ordenadas) {
    if (anterior !== null && j !== anterior + 1) {
      blocos.push(atual.join("\n"));
      atual = [];
    }
    atual.push(`${marcadas.get(j) ? ">" : " "} ${String(j + 1).padStart(4)}| ${linhas[j]}`);
    anterior = j;
  }
  if (atual.length > 0) blocos.push(atual.join("\n"));
  const usadas = indices.length;
  // `maxHits` limita LINHAS com acerto, não ocorrências: uma linha com seis
  // "R$" já é exibida inteira com as seis. Contar `total - usadas` aqui dizia
  // "5 ocorrências além do limite" quando as cinco estavam na linha mostrada.
  const linhasOcultas = casadas.size - usadas;

  const cabecalho =
    `# Busca em: ${finalUrl}\n` +
    `Termo: "${query}"${args.regex ? " (regex)" : ""}\n` +
    `Ocorrencias: ${total}${saturada ? "+" : ""} em ${linhas.length} linha(s)` +
    (linhasOcultas > 0 ? ` — exibindo ${usadas} linha(s) com acerto` : "") +
    avisoCobertura;
  return (
    cabecalho +
    "\n\n" +
    blocos.join("\n\n...\n\n") +
    (linhasOcultas > 0
      ? `\n\n[... ${linhasOcultas} linha(s) com ocorrencias alem do limite; aumente maxHits ...]`
      : "")
  );
}

/**
 * Snapshot e diff de página: relê a URL, compara com a marca da leitura
 * anterior e devolve SÓ o que mudou.
 *
 * Uso típico: "o que mudou no edital desde ontem", "a página de preço mudou?".
 * Sem a marca, a primeira chamada grava o ponto de comparação (não é erro);
 * `force: true` grava de novo sem comparar ("marque como lido").
 */
export async function toolDiffPage(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const chave = chaveSnapshot(parsed.href);

  const payload = await fetchTextDocumentoCached(parsed.href, { timeoutMs });
  const { text: html, finalUrl, contentType } = payload;
  ensureHtml(contentType, html, finalUrl);

  // Leitura parcial num diff é pior que erro: o fim que faltou apareceria como
  // "removido" e o cliente leria uma mudança que não houve. Recusa explícita.
  if (payload.cortado) {
    throw new RespostaMuitoGrandeError(MAX_RESPONSE_BYTES_DOCUMENTO, finalUrl);
  }

  // A marca precisa do documento INTEIRO: a conversão de exibição para de
  // propósito no teto de saída (HARD_MAX_CHARS), e usá-la aqui fazia o
  // diff_page recusar qualquer página com mais de ~25 mil caracteres — a home
  // do Guardian, por exemplo, falhava mesmo com o download completo. A
  // conversão sem parada antecipada é o caminho que o find_on_page já usa
  // quando precisa do rabo; o download acima garante que exista documento
  // inteiro para converter.
  const conteudo = isConteudoBruto(contentType, html) ? html : markdownCompleto(payload);

  // O hash é do texto NORMALIZADO, o mesmo que o diff compara: uma diferença
  // só de espaços no fim da linha não é "o conteúdo mudou" — antes o hash cru
  // acusava mudança e o diff linha a linha vinha vazio.
  const textoNormalizado = normalizarParaDiff(conteudo);
  const hashDepois = hashConteudo(textoNormalizado);

  // A marca guarda só os primeiros 64 KB do texto. Comparar o documento
  // inteiro contra essa janela marcaria todo o resto como "adicionado" a cada
  // mudança; por isso a comparação usa a MESMA janela dos dois lados.
  const janelaAtual = textoNormalizado.slice(0, TEXTO_DA_MARCA);
  const marcaTruncada = textoNormalizado.length > TEXTO_DA_MARCA;
  const novaMarca = { hash: hashDepois, texto: janelaAtual };

  const anterior = buscarMarca(chave);

  if (!anterior || args.force) {
    void guardarMarca(chave, novaMarca, tamanhoDaMarca(novaMarca));
    return formatarSaidaDiff({
      finalUrl,
      primeiraVez: true,
      gravado: true,
      diff: null,
      hashAntes: null,
      hashDepois,
      maxChars,
    });
  }

  if (anterior.hash === hashDepois) {
    return formatarSaidaDiff({
      finalUrl,
      primeiraVez: false,
      gravado: false,
      diff: { iguais: true },
      hashAntes: anterior.hash,
      hashDepois,
      maxChars,
    });
  }

  const diff = diffDeLinhas(anterior.texto || "", janelaAtual);
  // Hash diferente com janela idêntica: a mudança está além dos 64 KB
  // guardados. Sem este desvio a saída diria "SEM MUDANCA" com dois hashes
  // diferentes — o pior desfecho possível para quem usa o diff_page.
  const mudancaForaDaJanela = diff.iguais;
  // A marca avança: o próximo diff mede a partir de agora (é o que a pessoa
  // espera de "o que mudou desde a ultima vez que eu olhei").
  void guardarMarca(chave, novaMarca, tamanhoDaMarca(novaMarca));

  return formatarSaidaDiff({
    finalUrl,
    primeiraVez: false,
    gravado: true,
    diff: mudancaForaDaJanela ? { grande: true } : diff,
    hashAntes: anterior.hash,
    hashDepois,
    maxChars,
    marcaTruncada,
  });
}

/**
 * Acessa uma página e lista seus links.
 */
export async function toolExtractLinks(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const payload = await fetchTextDocumentoCached(parsed.href, { timeoutMs });
  const { finalUrl } = payload;
  ensureHtml("", payload.text, finalUrl);
  const all = linksMemo(payload);
  const shown = all.slice(0, limit);
  const lines = [`Links em ${finalUrl}: ${all.length} encontrados, exibindo ${shown.length}.`];
  if (payload.cortado) {
    lines.push(
      `AVISO: documento maior que o teto de download — os links foram extraidos apenas dos ` +
        `primeiros ${payload.bytes} bytes; pode haver mais no restante da pagina.`
    );
  }
  lines.push("");
  shown.forEach((link, index) => {
    lines.push(`${index + 1}. ${link.text}`);
    lines.push(`   ${link.href}${link.internal ? " (interno)" : " (externo)"}`);
  });
  return lines.join("\n");
}

/**
 * Lê várias páginas por chamada (máx 30 URLs, em lotes paralelos).
 */
export async function toolReadMultiplePages(args = {}) {
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
  // PRAZO FINAL da chamada inteira.
  //
  // Antes, a resposta só saía quando a ÚLTIMA URL terminasse: 29 páginas
  // prontas em 300 ms ficavam presas atrás de uma que demorava 12 s. Como o
  // cliente MCP tem o próprio teto de tempo, o pior caso era perder tudo.
  //
  // Agora a chamada tem um orçamento (o timeout de UMA leitura, que é o que
  // o cliente pediu, limitado a um teto duro) e, ao estourar, devolve o que já
  // leu marcando as que faltaram. O trabalho em voo NÃO é cancelado: ele
  // termina no fetch, aquece o cache e a próxima chamada acha pronto.
  //
  // O prazo nunca é menor que o timeout de uma leitura: numa lista de uma URL
  // só, o comportamento tem de ser idêntico ao de antes.
  const prazoMs = Math.min(MAX_PRAZO_MULTI_MS, Math.max(timeoutMs, PRAZO_MINIMO_MULTI_MS));
  const prazoFinal = Date.now() + prazoMs;
  let estourouPrazo = false;
  // Pool contínuo em vez de lotes de CONCURRENCY com Promise.all por bloco.
  // No lote, os índices seguintes só começavam quando o MAIS LENTO do bloco
  // terminava: 31 URLs rápidas esperavam a 32ª. Aqui cada vaga puxa a próxima
  // URL assim que fica livre — a mesma concorrência, sem o degrau artificial.
  // O limite real de sockets segue garantido pelos limitadores do fetch
  // (global, por host e de memória), então isto não aumenta a carga na origem.
  let proximo = 0;
  const trabalhador = async () => {
    for (;;) {
      const posicao = proximo++;
      if (posicao >= unicas.length) return;
      // Prazo estourado: as vagas param de puxar trabalho novo. As leituras
      // já em curso continuam (e terminam sozinhas), mas não seguram a
      // resposta — o Promise.race abaixo devolve o que houver.
      if (Date.now() >= prazoFinal) {
        return;
      }
      const url = unicas[posicao];
      try {
        lidos[posicao] = { ok: true, text: (await lerPaginaCompleta(url, maxChars, timeoutMs)).conteudo };
      } catch (err) {
        lidos[posicao] = { ok: false, text: `# Erro ao ler ${urlSemCredenciais(url)}\n${err.message}` };
      }
    }
  };
  const vagas = Math.min(CONCURRENCY, unicas.length);
  const trabalho = Promise.all(Array.from({ length: vagas }, trabalhador));
  // Corrida contra o relógio. `unref` não se aplica a setTimeout de prazo
  // curto: queremos que ele dispare. O clearTimeout no finally evita deixar
  // o timer pendurado quando o trabalho termina primeiro.
  let timerPrazo;
  const prazo = new Promise((resolve) => {
    timerPrazo = setTimeout(() => {
      estourouPrazo = true;
      resolve();
    }, prazoMs);
  });
  try {
    await Promise.race([trabalho, prazo]);
  } finally {
    clearTimeout(timerPrazo);
    // O trabalho segue em segundo plano (aquece o cache). Sem este catch, uma
    // rejeição depois do prazo viraria "unhandled rejection", que neste
    // projeto derruba o processo de propósito.
    trabalho.catch(() => {});
  }

  const secoes = [];
  let total = 0;
  let omitidas = 0;
  let naoLidas = 0;
  const primeiraPosicao = new Map();
  urls.forEach((u, pos) => {
    if (!primeiraPosicao.has(u)) primeiraPosicao.set(u, pos);
  });
  urls.forEach((url, posicao) => {
    const primeiraVez = posicao === primeiraPosicao.get(url);
    if (!primeiraVez) {
      secoes.push(`(URL repetida — mesma leitura da seção ${primeiraPosicao.get(url) + 1} acima)`);
      return;
    }
    const leitura = lidos[indice.get(url)];
    // Fila barrada pelo prazo: a URL nem chegou a ser pedida. É diferente de
    // erro — nada falhou, o orçamento de tempo acabou. A mensagem diz isso e
    // aponta a saída, senão o cliente lê como se a página estivesse quebrada.
    // (Não prometemos cache quente: esta URL não foi baixada por ninguém.)
    if (!leitura) {
      naoLidas++;
      secoes.push(
        `(não lida: o prazo de ${prazoMs} ms da chamada terminou antes — peça esta URL em outra chamada)`
      );
      return;
    }
    if (total >= MULTI_MAX_TOTAL_CHARS) {
      omitidas++;
      secoes.push(`(omitida: teto de saída de ${MULTI_MAX_TOTAL_CHARS} caracteres já foi alcançado)`);
      return;
    }
    const restante = MULTI_MAX_TOTAL_CHARS - total;
    const texto = leitura.text.length > restante ? truncate(leitura.text, restante).text : leitura.text;
    total += texto.length;
    secoes.push(texto);
  });

  const ok = unicas.filter((u) => lidos[indice.get(u)] && lidos[indice.get(u)].ok).length;
  const resumo = [
    `Leitura concluida: ${ok}/${unicas.length} paginas OK (ate ${CONCURRENCY} em paralelo).`,
    duplicadas > 0 ? ` ${duplicadas} URL(s) repetida(s) lida(s) uma vez so.` : "",
    omitidas > 0 ? ` ${omitidas} secao(oes) omitida(s) por teto de saida total.` : "",
    naoLidas > 0
      ? ` ${naoLidas} URL(s) nao chegaram a ser lidas: o prazo da chamada terminou — peca de novo, o cache das ja lidas esta quente.`
      : "",
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
export async function toolReadDynamicPage(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  // Mesmo teto proporcional do read_page, e não o teto duro de 5 MB.
  //
  // Era o último caminho de leitura de UMA página ainda baixando até 5 MB
  // para devolver `maxChars` caracteres: numa página de 12 MB (o whatwg, que
  // a bateria usa) o read_page já parava em ~480 KB e o read_dynamic_page
  // baixava os 5 MB inteiros para entregar 8.000 caracteres.
  //
  // O `buscarComTetoInteligente` é reaproveitado de propósito em vez de um
  // teto "na unha": ele já resolve o caso perigoso desta ferramenta — se o
  // pedaço baixado não cobre o pedido (o que aconteceria se os dados bons
  // estivessem num script no fim do documento), a MESMA conexão continua até o
  // teto largo. Ou seja: o resultado é o mesmo de antes quando o corte custaria
  // conteúdo, e é mais rápido quando não custa.
  const payload = await buscarComTetoInteligente(parsed, {
    maxChars,
    timeoutMs,
    // Aqui o teto de DOCUMENTO é o certo, ao contrário do read_page: esta
    // ferramenta existe para páginas pesadas (React/Vue/Next com muitos
    // dados embutidos), e o que se quer do HTML é justamente o miolo de
    // script onde os dados moram — cortar em 5 MB devolvia erro numa
    // documentação de 8 MB, que é exatamente o caso de uso dela.
    largoBytes: MAX_RESPONSE_BYTES_DOCUMENTO,
  });
  const { text: html, finalUrl, contentType } = payload;
  ensureHtml(contentType, html, finalUrl);
  registrarPedidoQuente(parsed.href, payload);
  if (isConteudoBruto(contentType, html)) {
    return conteudoBrutoResult(html, finalUrl, maxChars);
  }
  const meta = metaMemo(payload);

  const pareceDinamica = htmlIndicaDinamico(html);

  if (!pareceDinamica) {
    const markdown = markdownDaPagina(payload);
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

  const markdown = markdownDaPagina(payload);
  const estaticoCompleto = markdown.replace(/\s+/g, " ").trim().length >= TEXTO_MINIMO_UTIL;

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

  const dynamicMarkdown = await embeddedMemo(payload, timeoutMs);

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
/**
 * URLs de um sitemap: cada `<loc>` é DECODIFICADO (o XML escreve `&amp;` nos
 * parâmetros; sem decodificar, a URL entregue não abria) e repetições são
 * descartadas — o mesmo endereço costuma aparecer em vários sitemaps filhos,
 * e repetido inflava a contagem e consumia o `limit`.
 */
function locsDoSitemap(texto) {
  const vistos = new Set();
  const urls = [];
  for (const m of texto.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const url = decodeEntities(m[1].trim());
    if (!url || vistos.has(url)) continue;
    vistos.add(url);
    urls.push(url);
  }
  return urls;
}

export async function toolDiscoverUrls(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const origin = `${parsed.protocol}//${parsed.host}`;
  const candidatos = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/wp-sitemap.xml`,
  ];

  // Dispara os 4 candidatos DE UMA VEZ e fica com o primeiro que responder
  // com <loc>, na ordem de prioridade. Site sem sitemap punha 4 idas de 404
  // em série (o iana.org levava 1.454 ms); em paralelo o custo é o de UMA
  // ida. O limitador por host do fetch.mjs segura a concorrência.
  //
  // As promessas são esperadas NA ORDEM, uma a uma, e a busca para no primeiro
  // resultado. Antes era allSettled: mesmo com o sitemap.xml já pronto, a
  // resposta esperava os outros três terminarem (um candidato lento segurava
  // tudo). Os que não foram esperados continuam em segundo plano e aquecem o
  // cache — por isso o catch: rejeição sem dono derrubaria o processo.
  const buscas = candidatos.map(async (candidato) => {
    // Sitemap é documento, não página: um sitemap de 40.000 URLs passa fácil
    // do teto duro de 5 MB. O teto de documento evita perder as URLs do fim.
    const { text, contentType } = await fetchTextDocumentoCached(candidato, { timeoutMs });
    if (!/xml/.test(contentType) && !text.includes("<loc>")) return [];
    return locsDoSitemap(text);
  });
  buscas.forEach((b) => b.catch(() => {}));
  let sitemapUrls = [];
  for (const busca of buscas) {
    let locs = [];
    try {
      locs = await busca;
    } catch {
      locs = [];
    }
    if (locs.length > 0) {
      sitemapUrls = locs;
      break;
    }
  }

  const filhos = sitemapUrls.filter((u) => /\.xml($|\?)/i.test(u));
  if (filhos.length > 0 && filhos.length === sitemapUrls.length) {
    // Mesma economia de cima: até 5 sitemaps filhos em paralelo, não em série.
    const respostasFilhos = await Promise.allSettled(
      filhos.slice(0, 5).map(async (filho) => {
        const { text } = await fetchTextDocumentoCached(filho, { timeoutMs });
        return locsDoSitemap(text);
      }),
    );
    const expandidas = respostasFilhos.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    if (expandidas.length > 0) sitemapUrls = [...new Set(expandidas)];
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

  const payload = await fetchTextDocumentoCached(parsed.href, { timeoutMs });
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
 */
function filtrarLinksParaCrawl(links, payload) {
  return links
    .filter((l) => l.internal && l.href !== payload.finalUrl && !isNavigationUrl(l.href) && !ehArquivoEstatico(l.href))
    .map((l) => l.href);
}

// Opera sobre a lista MEMOIZADA do payload: a extração roda uma vez por
// conteúdo baixado, não uma vez por chamada.
function linksParaCrawl(payload) {
  return filtrarLinksParaCrawl(linksMemo(payload), payload);
}

/**
 * Le UMA pagina e devolve { conteudo, links }. E o unico lugar que conhece o
 * pipeline completo (fetch -> valida -> markdown/cru -> trunca), compartilhado
 * por read_multiple_pages e crawl_site.
 */
async function lerPaginaCompleta(url, maxChars, timeoutMs) {
  const parsed = validateHttpUrl(url);
  // Sempre baixa a página INTEIRA aqui, de propósito.
  //
  // Esta função alimenta read_multiple_pages e crawl_site, e nas duas o custo
  // de cortar é maior que a economia: o crawl precisa dos links (que moram no
  // rodapé, justo o que o corte tira) e no multi o erro se multiplica por até
  // 30 páginas. Medido em dev/_mede-multi-teto.mjs: com corte, o texto saía
  // 3% menor — entregar menos não é otimização.
  //
  // O corte proporcional vale no read_page, que é uma página só e onde o
  // cabeçalho `Conteudo: N+` avisa que havia mais. Aqui, não.
  //
  // O teto é o de DOCUMENTO (24 MB) e não o duro (5 MB): esta função alimenta
  // read_multiple_pages e crawl_site, e uma página de 8 MB fazia a chamada
  // inteira falhar aqui enquanto o read_page lia a MESMA URL normalmente. O
  // payload vem cortado (e sinalizado) só acima do teto de documento, que é o
  // comportamento certo: 200 links de um documento parcial valem mais que zero.
  const payload = await fetchTextDocumentoCached(parsed.href, { timeoutMs });
  const { text: html, finalUrl, contentType } = payload;
  ensureHtml(contentType, html, finalUrl);
  if (isConteudoBruto(contentType, html)) {
    return {
      conteudo: conteudoBrutoResult(html, finalUrl, maxChars),
      links: linksParaCrawl(payload),
    };
  }
  const meta = metaMemo(payload);
  const { markdown, links } = markdownELinksMemo(payload);
  const { text, truncated } = truncate(markdown, maxChars);
  return {
    conteudo: formatReadResult({ finalUrl, meta, text, truncated, fullLength: fullLengthDe(payload, markdown) }),
    links: filtrarLinksParaCrawl(links, payload),
  };
}

/**
 * Lê um site sozinho: BFS com extração de links.
 */
/**
 * Lê UMA página do crawl, sem deixar o erro escapar.
 *
 * O crawl continua quando uma página falha: o resultado dela vira uma linha
 * de erro no texto final e a URL entra na lista de falhas. Por isso o formato
 * `{ ok, url, ... }` em vez de try/catch espalhado pelo trabalhador.
 */
async function lerUmaDoCrawl(url, maxChars, timeoutMs) {
  try {
    return { ok: true, url, ...(await lerPaginaCompleta(url, maxChars, timeoutMs)) };
  } catch (erro) {
    return { ok: false, url, erro };
  }
}

/** Cabeçalho do crawl: quantas páginas foram lidas e, se houve, o resumo das falhas. */
function cabecalhoDoCrawl({ start, lidas, maxPages, baseHost, falhas }) {
  let texto = `Crawl de ${start}: ${lidas} pagina(s) lida(s) (limite ${maxPages}, dominio ${baseHost}).`;
  if (falhas.length === 0) return texto;
  const agrupado = new Map();
  for (const f of falhas) agrupado.set(f.motivo, (agrupado.get(f.motivo) || 0) + 1);
  const motivos = [...agrupado.entries()].map(([motivo, n]) => `${n} ${motivo}`).join(", ");
  texto +=
    `\nRESULTADO PARCIAL: ${falhas.length} pagina(s) falharam — ${motivos}.` +
    `\nAs paginas marcadas com "# Erro ao ler" abaixo nao foram lidas.`;
  return texto;
}

export async function toolCrawlSite(args = {}) {
  const start = validateHttpUrl(args.url);
  const maxPages = Math.max(2, Math.min(30, Number(args.maxPages) || 10));
  const maxChars = clampMaxChars(args.maxChars ?? 2000);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const baseHost = hostOf(start.href);

  const visited = new Set([chaveCanonica(start.href)]);
  const queue = [];
  const conteudos = [];
  const falhas = [];
  let lidas = 0;
  // maxPages limita TENTATIVAS de leitura, não só sucessos. Contando apenas
  // sucessos, um site cheio de links quebrados disparava conexões sem teto:
  // maxPages=10 num site com 200 links mortos fazia 200 downloads para
  // devolver 10 páginas. A raiz já é a tentativa 1.
  let tentativas = 1;

  // PRAZO FINAL do crawl, pelo mesmo motivo do read_multiple_pages: a resposta
  // só saía quando o último trabalhador terminasse. Num site com páginas
  // lentas (o crawl do iana.org já foi de 6,9 s para 9,1 s por causa da
  // origem, não do código), o cliente desistia e perdia as páginas já lidas.
  // Estourou o prazo: devolve o que foi lido, marca o resto como não lido, e
  // o que está em voo segue aquecendo o cache.
  //
  // O relógio começa AQUI, antes da página raiz. A primeira versão contava a
  // partir do pool, e a medição (dev/_probe-crawl-tempo.mjs) mostrou o efeito:
  // raiz de 540 ms com prazo de 1000 ms devolvia em 1746 ms — o prazo virava
  // "raiz + prazo", sempre mais que o prometido. O prazo é da CHAMADA, não de
  // um pedaço dela.
  const prazoMs = Math.min(MAX_PRAZO_MULTI_MS, Math.max(timeoutMs, PRAZO_MINIMO_MULTI_MS));
  const prazoFinal = Date.now() + prazoMs;
  let estourouPrazo = false;

  /** Enfileira os links ainda não visitados de uma leitura. */
  const enfileirarLinks = (links) => {
    for (const href of links) {
      // A visita é marcada pela URL CANÔNICA: duas variações da mesma página
      // (utm_*, parâmetros em ordem diferente) são a mesma página. Sem isso,
      // um site que assina os links com rastreio relia o mesmo conteúdo até
      // esgotar maxPages.
      const chave = chaveCanonica(href);
      if (visited.has(chave)) continue;
      visited.add(chave);
      queue.push(href);
    }
  };

  // A primeira página é lida fora do pool: se ela falhar, o crawl não começa
  // (não faz sentido devolver 10 páginas de um site cuja entrada não abriu).
  try {
    const primeira = await lerPaginaCompleta(start.href, maxChars, timeoutMs);
    conteudos.push(primeira.conteudo);
    lidas++;
    enfileirarLinks(primeira.links);
  } catch (err) {
    throw new CrawlError(start.href, err.message);
  }

  const CONCURRENCY = FETCH_CONCURRENCY;
  // Pool contínuo em vez de lotes de CONCURRENCY com Promise.all por bloco.
  // No lote, os itens seguintes só começavam quando o MAIS LENTO do bloco
  // terminava — uma página pendurada segurava as outras 31 vagas. Aqui cada
  // vaga puxa a próxima URL assim que fica livre; a concorrência é a mesma e
  // os limitadores do fetch (global, por host, memória) seguem no comando.
  // A fila é alimentada pelas páginas recém-lidas, então a vaga que encontra
  // a fila vazia não pode simplesmente sair: outra vaga ainda ativa vai
  // empurrar links. Ela espera o aviso `acordar()` e reavalia.
  // Deadlock é impossível: quem espera nunca é quem está baixando, e a última
  // leitura sempre acorda todo mundo antes de terminar (que então reavalia,
  // vê fila vazia e nenhum ativo, e sai).
  // São sempre CONCURRENCY trabalhadores — mesmo com a fila inicial curta —
  // porque o crawl cresce sozinho: com um só, o resto do site seria lido em
  // série, um por vez.
  const emEspera = [];
  const acordar = () => {
    while (emEspera.length > 0) emEspera.shift()();
  };
  let ativos = 0;

  const trabalhador = async () => {
    for (;;) {
      if (tentativas >= maxPages) return;
      // Prazo estourado: ninguém puxa trabalho novo. Quem está lendo termina
      // sozinho, mas a resposta não espera — o Promise.race abaixo decide.
      if (Date.now() >= prazoFinal) {
        estourouPrazo = true;
        return;
      }
      if (queue.length === 0) {
        if (ativos === 0) return; // não há leitura em curso para descobrir mais URLs
        await new Promise((res) => emEspera.push(res));
        continue;
      }
      const url = queue.shift();
      tentativas++;
      ativos++;
      const r = await lerUmaDoCrawl(url, maxChars, timeoutMs);
      ativos--;
      if (r.ok) {
        conteudos.push(r.conteudo);
        lidas++;
        // Só os links de uma leitura BEM-SUCEDIDA entram na fila.
        enfileirarLinks(r.links);
      } else {
        falhas.push({ url: r.url, motivo: classifyFetchError(r.erro), mensagem: r.erro.message });
        conteudos.push(`# Erro ao ler ${urlSemCredenciais(r.url)}\n${r.erro.message}`);
      }
      acordar();
    }
  };
  const trabalho = Promise.all(Array.from({ length: CONCURRENCY }, trabalhador));
  let timerPrazo;
  const prazo = new Promise((resolve) => {
    // `prazoFinal - Date.now()`, e não `prazoMs`: o prazo é um INSTANTE, não
    // uma duração que recomeça. Criar o timer com a duração cheia aqui fazia
    // o crawl esperar "tempo da raiz + prazo" — medido em
    // dev/_probe-crawl-tempo.mjs: prazo de 1000 ms retornando em 1784 ms.
    // Com o resto do prazo, o timer fecha no instante prometido.
    timerPrazo = setTimeout(() => {
      estourouPrazo = true;
      // Acorda quem está parado esperando fila: sem isso o trabalhador
      // dormiria até a última leitura terminar, e a resposta ficaria presa
      // no prazo justamente no caso em que ele existe para salvar.
      acordar();
      resolve();
    }, Math.max(0, prazoFinal - Date.now()));
  });
  try {
    await Promise.race([trabalho, prazo]);
  } finally {
    clearTimeout(timerPrazo);
    // Trabalho remanescente segue em segundo plano (aquece o cache). O catch
    // evita "unhandled rejection", que neste projeto derruba o processo.
    trabalho.catch(() => {});
    // Quem ficou dormindo esperando fila precisa sair, senão o processo
    // seguraria promessas penduradas para sempre.
    acordar();
  }

  const cabecalho = cabecalhoDoCrawl({ start: start.href, lidas, maxPages, baseHost, falhas });
  const avisoPrazo = estourouPrazo
    ? `\nPRAZO ENCERRADO: a chamada parou em ${prazoMs} ms antes de ler tudo.` +
      `\nForam ${lidas} pagina(s) lidas; as que faltaram nao foram tentadas.` +
      `\nAs paginas ja lidas estao no cache — peca de novo para continuar de onde parou.`
    : "";
  return cabecalho + avisoPrazo + "\n\n" + conteudos.join("\n\n========================================\n\n");
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
    case "diff_page":
      return await toolDiffPage(args || {});
    default:
      throw new FerramentaDesconhecidaError(name);
  }
}
