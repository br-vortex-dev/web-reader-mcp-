/**
 * Busca na web (read_search): acha as URLs de um assunto e devolve
 * titulo + URL + resumo de cada resultado. Fecha o ciclo que faltava no
 * MCP: hoje ele le uma URL que ja se tem; com a busca, ele tambem DESCOBRE
 * a URL. Depois de achar, quem consome segue com read_page/read_multiple_pages.
 *
 * Sobre os provedores (medido em dev/_probe-search*.mjs): nenhum motor
 * aceita o IP de datacenter do Render. DuckDuckGo e Mojeek dao timeout;
 * Google, Bing, Brave e Startpage barram por robots.txt; Ecosia devolve 403;
 * a API da Wikipedia bloqueia /w/. Por isso o motor e PLUGAVEL: o provedor
 * com chave (Brave Search API) e a instancia SearXNG propria sao feitos para
 * datacenter; o DuckDuckGo HTML fica como padrao porque funciona na maquina
 * local. Quando nenhum provedor esta configurado num ambiente onde o DDG nao
 * responde, a ferramenta diz o motivo — nunca devolve "nenhum resultado" como
 * se a busca tivesse rodado.
 *
 * Nao ha dependencia nova: a extracao do HTML do DDG e feita a mao, em passe
 * unico, e as APIs respondem JSON (lido com JSON.parse).
 */

import {
  SEARCH_PROVIDER,
  BRAVE_API_KEY,
  SEARXNG_URL,
  SEARCH_TIMEOUT_MS,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
} from "./config.mjs";
import { fetchText } from "./fetch.mjs";
import { ParametroInvalidoError, WebReaderError } from "./errors.mjs";

/* ===================================================================== *
 * Utilitarios de texto                                                    *
 * ===================================================================== */

/** Decodifica as entidades HTML mais comuns (nomeadas e numericas). */
function decodificarEntidades(texto) {
  return String(texto || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Tira as tags e normaliza os espacos de um trecho de HTML. */
function limparHtml(texto) {
  return decodificarEntidades(String(texto || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Limita a quantidade de resultados ao intervalo aceito. */
function clampLimit(valor) {
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n) || n <= 0) return SEARCH_DEFAULT_LIMIT;
  return Math.max(1, Math.min(SEARCH_MAX_LIMIT, n));
}

/* ===================================================================== *
 * Provedor 1 — DuckDuckGo HTML (sem chave; funciona fora de datacenter)   *
 * ===================================================================== */

/**
 * Extrai os resultados da pagina HTML do DuckDuckGo.
 *
 * Estrutura: cada resultado tem um <a class="result__a" href="...">titulo</a>
 * e um <a class="result__snippet">resumo</a>. O href real vem embrulhado no
 * redirecionador (//duckduckgo.com/l/?uddg=<url-encoded>) e precisa ser
 * desembrulhado. A classe pode vir antes ou depois do href, entao o regex
 * aceita as duas ordens capturando os atributos dos dois lados da classe.
 */
export function extrairDdg(html) {
  const resultados = [];
  const vistos = new Set();

  const reLink = /<a\b([^>]*?)class="[^"]*result__a[^"]*"([^>]*?)>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(reLink)) {
    const attrs = `${m[1]} ${m[2]}`;
    const hrefBruto = (attrs.match(/href="([^"]+)"/) || [])[1];
    if (!hrefBruto) continue;
    const url = urlRealDeDdg(hrefBruto);
    if (!url || !/^https?:/i.test(url)) continue;
    if (vistos.has(url)) continue;
    vistos.add(url);
    const titulo = limparHtml(m[3]) || "(sem titulo)";
    resultados.push({ titulo, url, resumo: "" });
  }

  // Pareia os resumos por ordem: N-esimo snippet com N-esimo resultado.
  const reSnippet = /<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const resumos = [...html.matchAll(reSnippet)].map((m) => limparHtml(m[1]));
  for (let i = 0; i < resultados.length && i < resumos.length; i++) {
    resultados[i].resumo = resumos[i];
  }

  return resultados;
}

/** Desembrulha o redirecionador do DDG (uddg=) e devolve a URL real. */
function urlRealDeDdg(href) {
  let limpo = href.replace(/&amp;/g, "&");
  const uddg = limpo.match(/[?&]uddg=([^&]+)/);
  if (uddg) {
    try {
      limpo = decodeURIComponent(uddg[1]);
    } catch {
      // percent-encoding malformado: cai no proprio href
    }
  }
  return limpo;
}

async function buscarDdg(query, limite, timeoutMs) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { text } = await fetchText(url, { timeoutMs });
  const achados = extrairDdg(text);
  return achados.slice(0, limite);
}

/* ===================================================================== *
 * Provedor 2 — Brave Search API (com chave; feita para datacenter)        *
 * ===================================================================== */

async function buscarBrave(query, limite, timeoutMs) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limite}`;
  const { text } = await fetchText(url, {
    timeoutMs,
    headers: {
      Accept: "application/json",
      // A chave viaja no header, nunca na URL: nao entra na chave de cache
      // nem em mensagem de erro.
      "X-Subscription-Token": BRAVE_API_KEY,
    },
  });
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new WebReaderError("A Brave Search API devolveu uma resposta que nao e JSON.", {
      code: "BUSCA_RESPOSTA_INVALIDA",
    });
  }
  const itens = (json.web && json.web.results) || [];
  return itens.slice(0, limite).map((r) => ({
    titulo: r.title || "(sem titulo)",
    url: r.url || "",
    resumo: limparHtml(r.description || ""),
  })).filter((r) => r.url);
}

/* ===================================================================== *
 * Provedor 3 — SearXNG proprio (sem chave; metadados em JSON)             *
 * ===================================================================== */

async function buscarSearxng(query, limite, timeoutMs) {
  const url = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&language=pt-BR`;
  const { text } = await fetchText(url, { timeoutMs, headers: { Accept: "application/json" } });
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new WebReaderError(
      "A instancia SearXNG nao devolveu JSON. Confirme que o formato JSON esta habilitado nela.",
      { code: "BUSCA_RESPOSTA_INVALIDA" }
    );
  }
  const itens = Array.isArray(json.results) ? json.results : [];
  return itens.slice(0, limite).map((r) => ({
    titulo: r.title || "(sem titulo)",
    url: r.url || "",
    resumo: limparHtml(r.content || ""),
  })).filter((r) => r.url);
}

/* ===================================================================== *
 * Escolha do provedor e saida                                             *
 * ===================================================================== */

/**
 * Decide qual provedor usar. Em "auto", prefere o que esta configurado: uma
 * chave da Brave e o caminho mais direto de datacenter; sem ela, um SearXNG
 * proprio; sem nenhum dos dois, o DuckDuckGo HTML (funciona localmente).
 */
function escolherProvedor() {
  if (SEARCH_PROVIDER !== "auto") return SEARCH_PROVIDER;
  if (BRAVE_API_KEY) return "brave";
  if (SEARXNG_URL) return "searxng";
  return "ddg";
}

const PROVEDORES = {
  ddg: { rotulo: "DuckDuckGo HTML", buscar: buscarDdg },
  brave: { rotulo: "Brave Search API", buscar: buscarBrave },
  searxng: { rotulo: "SearXNG", buscar: buscarSearxng },
};

/** Monta a saida em markdown da busca. */
function formatarSaida({ query, provedor, resultados, total }) {
  const linhas = [];
  linhas.push(`# Busca: "${query}"`);
  linhas.push(`Provedor: ${provedor} | ${resultados.length} resultado(s)${total > resultados.length ? ` de ${total}` : ""}`);
  linhas.push("");
  if (resultados.length === 0) {
    linhas.push(
      "Nenhum resultado devolvido. Se o provedor for o DuckDuckGo, confirme que o servidor " +
        "esta rodando fora de datacenter (o DDG nao atende IP de datacenter) ou configure " +
        "BRAVE_API_KEY / SEARXNG_URL para um provedor feito para servidor."
    );
    return linhas.join("\n");
  }
  resultados.forEach((r, i) => {
    linhas.push(`${i + 1}. ${r.titulo}`);
    linhas.push(`   ${r.url}`);
    if (r.resumo) linhas.push(`   ${r.resumo}`);
    linhas.push("");
  });
  linhas.push("Use read_page ou read_multiple_pages para ler as que interessar.");
  return linhas.join("\n").trimEnd();
}

/**
 * Ferramenta read_search. Valida a consulta, escolhe o provedor, busca e
 * formata. Falha de rede/robots sobe como erro do projeto (mensagem clara),
 * nunca como lista vazia — a IA que consome nao pode confundir "nao achei"
 * com "nao consegui buscar".
 */
export async function toolSearch(args) {
  const query = String(args.q || args.query || "").trim();
  if (!query) {
    throw new ParametroInvalidoError("q", "informe o termo de busca");
  }
  const limite = clampLimit(args.limit);
  const timeoutMs = Math.max(1000, Math.min(60000, Math.floor(Number(args.timeoutMs)) || SEARCH_TIMEOUT_MS));

  const nome = escolherProvedor();
  const provedor = PROVEDORES[nome];
  if (!provedor) {
    throw new ParametroInvalidoError(
      "SEARCH_PROVIDER",
      `provedor desconhecido '${nome}'. Use auto, ddg, brave ou searxng.`
    );
  }
  if (nome === "brave" && !BRAVE_API_KEY) {
    throw new ParametroInvalidoError("BRAVE_API_KEY", "o provedor brave exige a variavel BRAVE_API_KEY");
  }
  if (nome === "searxng" && !SEARXNG_URL) {
    throw new ParametroInvalidoError("SEARXNG_URL", "o provedor searxng exige a variavel SEARXNG_URL");
  }

  const resultados = await provedor.buscar(query, limite, timeoutMs);
  return formatarSaida({ query, provedor: provedor.rotulo, resultados, total: resultados.length });
}
