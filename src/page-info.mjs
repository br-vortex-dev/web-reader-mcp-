/**
 * page-info.mjs — o cartão de identidade de uma página (extract_page_info).
 *
 * O QUE É
 *   Devolve o que a página DIZ de si mesma: título, descrição, autor, datas,
 *   idioma, site, URL canônica e os tipos de dados estruturados — sem o corpo.
 *   É a chamada barata que uma IA faz antes de decidir se vale ler a página
 *   inteira: alguns caracteres em vez dos milhares do read_page.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: a URL (e o timeout opcional).
 *   Sai:   um bloco curto de campos. Campo desconhecido é omitido — nunca
 *         aparece "null" nem linha vazia.
 *
 * QUEM USA
 *   Usado por: tools.mjs.
 *   Importa de: conversao, fetch, html-parser, json-ld.
 */

import { fetchTextDocumentoCached, validateHttpUrl, clampTimeoutMs, ensureHtml, isConteudoBruto } from "./fetch.mjs";
import { decodeEntities } from "./html-parser.mjs";
import { metaMemo } from "./conversao.mjs";
import { extrairJsonLd, tiposDaPagina, tiposDe, textoDe, autorDe } from "./json-ld.mjs";

// Teto de cada campo: descrição de página às vezes vem com um parágrafo
// inteiro; o cartão existe para ser curto.
const LIMITE_DESCRICAO = 600;
const LIMITE_TITULO = 300;
const LIMITE_AUTOR = 200;

/**
 * Escaneia as tags <meta> até achar os dois campos que o extractMeta não
 * devolve (site e data de modificação). A varredura para no fim do <head>
 * quando ele existe: esses campos moram lá e uma página de 15 MB não precisa
 * ser lida até o fim para encontrar dois atributos.
 */
function lerMetaExtras(html) {
  const alvos = {
    "og:site_name": "site",
    "article:modified_time": "modified",
    "og:updated_time": "modified",
  };
  const extras = { site: "", modified: "" };
  const fimDoHead = html.search(/<\/head\s*>/i);
  const limite = fimDoHead === -1 ? Math.min(html.length, 300_000) : fimDoHead;
  let pos = -1;
  let faltam = 2;
  while (faltam > 0 && (pos = html.indexOf("<meta", pos + 1)) !== -1 && pos < limite) {
    const fim = html.indexOf(">", pos + 5);
    if (fim === -1 || fim > limite) break;
    const tag = html.slice(pos, fim + 1);
    const chave = atributo(tag, "property") || atributo(tag, "name");
    const campo = alvos[chave.toLowerCase()];
    if (!campo || extras[campo]) {
      pos = fim;
      continue;
    }
    const valor = atributo(tag, "content");
    if (valor) {
      extras[campo] = valor;
      faltam--;
    }
    pos = fim;
  }
  return extras;
}

/**
 * Valor de um atributo dentro de uma tag já recortada. Aceita aspas duplas,
 * simples e valor sem aspas — os três aparecem em HTML de verdade.
 */
function atributo(tag, nome) {
  const re = new RegExp(`\\b${nome}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const achado = re.exec(tag);
  if (!achado) return "";
  return decodeEntities((achado[1] ?? achado[2] ?? achado[3] ?? "").trim());
}

/** Idioma declarado no <html lang="...">. */
function idiomaDaPagina(html) {
  const abertura = /<html\b[^>]*>/i.exec(html);
  return abertura ? atributo(abertura[0], "lang") : "";
}

/**
 * URL canônica declarada em <link rel="canonical">. A varredura para no fim
 * do <head>; o atributo rel pode vir antes ou depois do href, por isso os dois
 * são lidos da tag inteira em vez de casar uma ordem.
 */
function urlCanonica(html, finalUrl) {
  const fimDoHead = html.search(/<\/head\s*>/i);
  const limite = fimDoHead === -1 ? Math.min(html.length, 300_000) : fimDoHead;
  let pos = -1;
  while ((pos = html.indexOf("<link", pos + 1)) !== -1 && pos < limite) {
    const fim = html.indexOf(">", pos + 5);
    if (fim === -1 || fim > limite) break;
    const tag = html.slice(pos, fim + 1);
    const rel = atributo(tag, "rel").toLowerCase();
    if (rel.split(/\s+/).includes("canonical")) {
      const href = atributo(tag, "href");
      if (!href) return "";
      try {
        return new URL(href, finalUrl).href;
      } catch {
        return href;
      }
    }
    pos = fim;
  }
  return "";
}

/**
 * Dados estruturados e extras são caros de varrer e a página fica no cache:
 * o WeakMap prende o resultado ao payload e a página nova (TTL/revalidação)
 * libera tudo sozinha.
 */
const memoDeDados = new WeakMap();

function dadosDaPagina(payload) {
  let dados = memoDeDados.get(payload);
  if (dados) return dados;
  const html = payload.text;
  const itens = extrairJsonLd(html);
  dados = {
    extras: lerMetaExtras(html),
    idioma: idiomaDaPagina(html),
    canonica: urlCanonica(html, payload.finalUrl),
    itens,
    tipos: tiposDaPagina(itens),
  };
  memoDeDados.set(payload, dados);
  return dados;
}

/** Primeiro valor não vazio de um campo em todos os objetos JSON-LD. */
function primeiroCampo(itens, campo) {
  for (const item of itens) {
    const valor = textoDe(item[campo]);
    if (valor) return valor;
  }
  return "";
}

/** Primeiro autor declarado nos objetos JSON-LD. */
function primeiroAutor(itens) {
  for (const item of itens) {
    const autor = autorDe(item);
    if (autor) return autor;
  }
  return "";
}

/**
 * Nome do site: og:site_name é o mais comum; sem ele, um nó WebSite ou o
 * publisher de um artigo. O host fica de fora de propósito — o campo "Site"
 * deve dizer a MARCA, e o host já está na URL logo acima.
 */
function nomeDoSite(itens, extras) {
  if (extras.site) return extras.site;
  for (const item of itens) {
    if (tiposDe(item).some((t) => t.toLowerCase() === "website")) {
      const nome = textoDe(item.name);
      if (nome) return nome;
    }
  }
  for (const item of itens) {
    const dono = textoDe(item.publisher) || textoDe(item.provider);
    if (dono) return dono;
  }
  return "";
}

function limitar(texto, limite) {
  const limpo = String(texto || "").replace(/\s+/g, " ").trim();
  return limpo.length > limite ? limpo.slice(0, limite) + "…" : limpo;
}

function formatarData(valor) {
  const texto = String(valor || "").trim();
  // O extractMeta corta em 25 caracteres; aqui a data sai inteira, mas sem
  // virar parágrafo quando o site põe hora e fuso no mesmo campo.
  return texto.length > 40 ? texto.slice(0, 40) : texto;
}

/** Monta o cartão com os campos que existem, na ordem em que se lê. */
function montarCartao(finalUrl, campos) {
  const linhas = [`# Informacoes da pagina`, `URL: ${finalUrl}`];
  for (const [rotulo, valor] of campos) {
    if (valor) linhas.push(`${rotulo}: ${valor}`);
  }
  return linhas.join("\n") + "\n";
}

/**
 * Ferramenta extract_page_info.
 */
export async function toolExtractPageInfo(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const payload = await fetchTextDocumentoCached(parsed.href, { timeoutMs });
  const { text: html, finalUrl, contentType } = payload;

  const tipo = String(contentType || "").toLowerCase();
  if (tipo && !/html|xml|text\//.test(tipo)) {
    return (
      `# Informacoes da pagina\nURL: ${finalUrl}\nTipo de conteudo: ${contentType}\n\n` +
      `Esta URL nao devolve HTML, entao nao ha titulo, autor nem metadados de pagina ` +
      `para extrair. Use a ferramenta do formato: read_pdf para PDF, read_json para ` +
      `JSON e read_document para DOCX/PPTX/EPUB.\n`
    );
  }

  const meta = metaMemo(payload);
  if (isConteudoBruto(contentType, html)) {
    return montarCartao(finalUrl, [
      ["Titulo", limitar(meta.title, LIMITE_TITULO)],
      ["Tipo de conteudo", `${contentType} (texto puro/XML)`],
      ["Tamanho", `${html.length} caracteres`],
    ]);
  }

  ensureHtml(contentType, html, finalUrl);
  const dados = dadosDaPagina(payload);
  const { extras, itens } = dados;

  const titulo = limitar(meta.title || primeiroCampo(itens, "headline") || primeiroCampo(itens, "name"), LIMITE_TITULO);
  const descricao = limitar(meta.description || primeiroCampo(itens, "description"), LIMITE_DESCRICAO);
  const autor = limitar(meta.author || primeiroAutor(itens), LIMITE_AUTOR);
  const publicado = formatarData(meta.published || primeiroCampo(itens, "datePublished"));
  const modificado = formatarData(extras.modified || primeiroCampo(itens, "dateModified"));
  const site = limitar(nomeDoSite(itens, extras), LIMITE_AUTOR);
  const tipos = dados.tipos.join(", ");

  return montarCartao(finalUrl, [
    ["Titulo", titulo || "(sem titulo)"],
    ["Descricao", descricao],
    ["Autor", autor],
    ["Publicado", publicado],
    ["Modificado", modificado],
    ["Idioma", dados.idioma],
    ["Site", site],
    ["URL canonica", dados.canonica],
    ["Dados estruturados", tipos],
  ]);
}
