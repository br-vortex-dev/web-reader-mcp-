/**
 * Leitura de feed (read_feed) e de JSON público (read_json).
 *
 * Por que estas ferramentas existem: fevereiro/Atom e JSON são o que a web
 * pública usa para publicar "o que mudou" — e o read_page, por desenho, só
 * aceita HTML. Antes disto, um feed devolvia "o conteúdo não é HTML" e uma API
 * pública devolvia o mesmo erro: dois caminhos legítimos de leitura simplesmente
 * não existiam.
 *
 * Nada aqui baixa nada: o download, o SSRF, o robots.txt, o cache e a junção
 * em voo continuam no `fetchTextCached` (fetch.mjs). Este módulo só interpreta
 * o texto que já chegou, com parser próprio para XML (zero dependências).
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: o texto já baixado (XML de feed, ou JSON de uma API pública).
 *   Sai:   uma lista de itens legível — título, link, data e resumo — ou os
 *          campos que o chamador pediu, quando é JSON.
 *
 * QUEM USA
 *   Usado por: tools.mjs (read_feed e read_json).
 *   Importa de: fetch, html-parser.
 */

import {
  fetchTextCached,
  clampMaxChars,
  clampTimeoutMs,
  truncate,
  validateHttpUrl,
} from "./fetch.mjs";
import { decodeEntities } from "./html-parser.mjs";

/**
 * Tipo grosseiro do corpo recebido. Só serve para escolher a MENSAGEM de
 * recusa ("isto é HTML, use read_page"), não para processar nada — por isso
 * olhar o começo do texto basta.
 */
function tipoDoCorpo(contentType, texto) {
  const tipoConteudo = String(contentType || "").toLowerCase();
  if (tipoConteudo.includes("json")) return "json";
  if (tipoConteudo.includes("html")) return "html";
  if (/^\s*<(!doctype\s+html|html[\s>])/i.test(String(texto || ""))) return "html";
  return "outro";
}

/* ===================================================================== *
 * XML: um leitor de tags mínimo, mas honesto                            *
 * ===================================================================== */

/**
 * O par de regex de uma tag, montado uma vez só. Antes, o fechamento era
 * compilado dentro do laço — um feed com 50 <item> compilava 50 vezes.
 * O conjunto de tags de um feed é pequeno e fixo, então o cache é estável.
 */
const memoRegexTag = new Map();
function regexTag(tag) {
  let par = memoRegexTag.get(tag);
  if (!par) {
    par = {
      abertura: new RegExp(`<${tag}(\\s[^>]*)?>`, "gi"),
      fechamento: new RegExp(`</${tag}\\s*>`, "gi"),
    };
    memoRegexTag.set(tag, par);
  }
  return par;
}

/**
 * Devolve o conteúdo interno de todas as ocorrências de `<tag ...>...</tag>`.
 * Aceita CDATA. Não é um parser XML completo de propósito: feeds são rasos e
 * regulares, e o que importa é não perder texto (o erro caro seria engolir um
 * item inteiro por causa de um `<` no meio).
 */
export function conteudoDasTags(xml, tag) {
  const out = [];
  const { abertura, fechamento } = regexTag(tag);
  // O par é memoizado e as duas regex são globais, então o lastIndex precisa
  // ser zerado a cada uso: sem isto, a segunda leitura da mesma tag começaria
  // no meio do documento anterior.
  abertura.lastIndex = 0;
  let m;
  while ((m = abertura.exec(xml)) !== null) {
    const inicio = m.index + m[0].length;
    fechamento.lastIndex = inicio;
    const fim = fechamento.exec(xml);
    if (!fim) break;
    out.push(xml.slice(inicio, fim.index));
    abertura.lastIndex = fim.index + fim[0].length;
  }
  return out;
}

/** Primeira ocorrência, ou string vazia. */
function primeiraTag(xml, tag) {
  const todas = conteudoDasTags(xml, tag);
  return todas.length > 0 ? todas[0] : "";
}

/** Remove tags HTML de um texto em uma passada linear. */
function removerTags(texto) {
  let saida = "";
  let i = 0;
  for (;;) {
    const abre = texto.indexOf("<", i);
    if (abre === -1) {
      saida += texto.slice(i);
      break;
    }
    const fecha = texto.indexOf(">", abre + 1);
    if (fecha === -1) {
      // "<" sem fecho é texto comum (ex.: "a < b"), não uma tag.
      saida += texto.slice(i);
      break;
    }
    saida += texto.slice(i, abre) + " ";
    i = fecha + 1;
  }
  return saida;
}

/** Remove CDATA e resolve entidades, devolvendo texto limpo de tags. */
export function limparTextoXml(bruto) {
  if (!bruto) return "";
  let texto = String(bruto);
  // <![CDATA[ ... ]]> é o jeito de publicar HTML cru dentro do feed; o
  // conteúdo dele É o texto (não pode ser descartado junto com a embalagem).
  texto = texto.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Links/HTML dentro do resumo: a tag some, o texto fica. O varredor manual
  // evita o custo quadrático do velho /<[^>]+>/g num resumo cheio de "<" sem
  // fecho (cada "<" relia o resto do texto até o fim).
  texto = removerTags(texto);
  texto = decodeEntities(texto);
  return texto.replace(/\s+/g, " ").trim();
}

/** Atributos de uma tag já recortada ("a=\"1\" b='2'"), com entidades resolvidas. */
function atributosDaTag(tagTexto) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*["']([^"']*)["']/g;
  let m;
  while ((m = re.exec(tagTexto)) !== null) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2]);
  }
  return attrs;
}

/**
 * Link de um item/entry.
 * RSS: <link>https://...</link>
 * Atom: <link rel="alternate" href="https://..."/> (vazio por dentro)
 *
 * Atom pode trazer VÁRIOS <link> no mesmo item (enclosure, self, alternate) e
 * os atributos em qualquer ordem. Antes, duas regexes dependiam da ordem
 * rel→href e caíam no "primeiro link com href" — o enclosure de áudio saía no
 * lugar do artigo. Agora todos são lidos e o alternate vence.
 */
export function linkDoBloco(bloco) {
  let alternativo = "";
  let reserva = "";
  const re = /<link\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(bloco)) !== null) {
    const attrs = atributosDaTag(m[1]);
    const href = (attrs.href || "").trim();
    if (!href) continue;
    const rel = (attrs.rel || "alternate").toLowerCase();
    if (rel === "alternate") {
      if (!alternativo) alternativo = href;
    } else if (!reserva) {
      reserva = href;
    }
  }
  if (alternativo) return alternativo;
  const texto = limparTextoXml(primeiraTag(bloco, "link"));
  if (texto) return texto;
  return reserva;
}

/** Converte a data publicada em algo legível, sem inventar formato. */
function dataLegivel(bruto) {
  const texto = limparTextoXml(bruto);
  if (!texto) return "";
  const dataPublicada = new Date(texto);
  if (Number.isNaN(dataPublicada.getTime())) return texto;
  return dataPublicada.toISOString().replace(".000Z", "Z");
}

/** Identifica o formato do texto recebido. */
export function detectarFormato(texto, contentType = "") {
  const tipoConteudo = String(contentType || "").toLowerCase();
  const inicio = String(texto || "").slice(0, 2000);
  if (/<(rss|rdf:RDF)\b/i.test(inicio) && /<channel\b/i.test(inicio)) return "rss";
  if (/<feed\b/i.test(inicio) && /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(inicio)) return "atom";
  if (/<feed\b/i.test(inicio) && /<entry\b/i.test(inicio)) return "atom";
  if (tipoConteudo.includes("json") || /^\s*[{[]/.test(inicio)) return "json";
  return "desconhecido";
}

/**
 * Interpreta um feed RSS 2.0 / RDF / Atom.
 * Devolve { formato, titulo, descricao, itens: [{titulo, link, data, autor, resumo}] }
 */
export function analisarFeed(texto) {
  const formato = detectarFormato(texto);
  if (formato === "json") return analisarJsonFeed(texto);
  if (formato === "desconhecido") return null;

  const ehAtom = formato === "atom";
  const canal = ehAtom ? "" : primeiraTag(texto, "channel") || texto;
  const blocos = ehAtom ? conteudoDasTags(texto, "entry") : conteudoDasTags(texto, "item");

  const titulo = limparTextoXml(primeiraTag(canal || texto, "title"));
  const descricao = limparTextoXml(
    primeiraTag(canal || texto, "description") || primeiraTag(canal || texto, "subtitle")
  );

  const itens = blocos.map((bloco) => {
    const tituloItem = limparTextoXml(primeiraTag(bloco, "title") || primeiraTag(bloco, "media:title"));
    const resumoBruto =
      primeiraTag(bloco, "description") ||
      primeiraTag(bloco, "summary") ||
      primeiraTag(bloco, "content") ||
      primeiraTag(bloco, "encoded");
    const autor =
      limparTextoXml(primeiraTag(bloco, "author")) ||
      limparTextoXml(primeiraTag(bloco, "dc:creator")) ||
      limparTextoXml(primeiraTag(bloco, "name"));
    const dataBruta =
      primeiraTag(bloco, "pubDate") ||
      primeiraTag(bloco, "published") ||
      primeiraTag(bloco, "updated") ||
      primeiraTag(bloco, "dc:date");
    return {
      titulo: tituloItem,
      link: linkDoBloco(bloco),
      data: dataLegivel(dataBruta),
      autor,
      resumo: limparTextoXml(resumoBruto),
    };
  });

  return { formato, titulo, descricao, itens };
}

/** Interpreta o JSON Feed (jsonfeed.org) — o feed "moderno". */
function analisarJsonFeed(texto) {
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!dados || !Array.isArray(dados.items)) return null;
  return {
    formato: "jsonfeed",
    titulo: String(dados.title || ""),
    descricao: String(dados.description || ""),
    itens: dados.items.map((bruto) => {
      // O JSON Feed promete objetos, mas um campo null/número no meio derrubava
      // o feed inteiro ("Cannot read properties of null"). Item inválido vira
      // item vazio: o resto continua legível.
      const it = bruto && typeof bruto === "object" ? bruto : {};
      return {
        titulo: String(it.title || ""),
        link: String(it.url || it.external_url || ""),
        data: dataLegivel(it.date_published || it.date_modified || ""),
        autor: String((it.author && it.author.name) || ""),
        resumo: String(it.summary || it.content_text || "").replace(/\s+/g, " ").trim(),
      };
    }),
  };
}

/* ===================================================================== *
 * read_feed                                                             *
 * ===================================================================== */

const RESUMO_MAX_CHARS = 300;

/** Monta a saída em markdown do read_feed. */
export function formatarSaidaFeed({ finalUrl, feed, totalFeed = feed.itens.length }) {
  const linhas = [];
  linhas.push(`# ${feed.titulo || "(feed sem título)"}`);
  linhas.push(`URL: ${finalUrl}`);
  linhas.push(`Formato: ${rotuloFormato(feed.formato)}`);
  // `Itens:` é o tamanho do FEED, não o da página exibida: com limit=1 num
  // feed de 20 itens, "Itens: 1" fazia a IA acreditar que o feed só tinha um.
  const exibindo = feed.itens.length;
  linhas.push(`Itens: ${totalFeed}` + (exibindo < totalFeed ? ` (exibindo ${exibindo})` : ""));
  if (feed.descricao) linhas.push(`Descricao: ${feed.descricao.slice(0, RESUMO_MAX_CHARS)}`);
  linhas.push("");

  for (let i = 0; i < feed.itens.length; i++) {
    const it = feed.itens[i];
    linhas.push(`## ${i + 1}. ${it.titulo || "(sem título)"}`);
    if (it.link) linhas.push(`Link: ${it.link}`);
    if (it.data) linhas.push(`Publicado: ${it.data}`);
    if (it.autor) linhas.push(`Autor: ${it.autor}`);
    if (it.resumo) {
      const resumo = it.resumo.length > RESUMO_MAX_CHARS
        ? it.resumo.slice(0, RESUMO_MAX_CHARS) + "…"
        : it.resumo;
      linhas.push(`Resumo: ${resumo}`);
    }
    linhas.push("");
  }
  return linhas.join("\n");
}

function rotuloFormato(f) {
  if (f === "rss") return "RSS 2.0 / RDF";
  if (f === "atom") return "Atom";
  if (f === "jsonfeed") return "JSON Feed";
  return f;
}

/**
 * Ferramenta read_feed: lê RSS/Atom/JSON Feed e devolve os itens em markdown.
 *
 * O que ela NÃO faz: não segue os links dos itens (isso é read_page) e não
 * inventa campo que o feed não publicou.
 */
export async function toolReadFeed(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const limiteItens = Math.max(1, Math.min(100, Number(args.limit) || 20));

  const payload = await fetchTextCached(parsed.href, { timeoutMs });
  const feed = analisarFeed(payload.text);

  if (!feed) {
    const tipo = tipoDoCorpo(payload.contentType, payload.text);
    if (tipo === "html") {
      // Página HTML costuma ter <link rel="alternate" type="application/rss+xml">.
      const auto = payload.text.match(
        /<link\b[^>]*type\s*=\s*["']application\/(rss|atom)\+xml["'][^>]*>/i
      );
      const href = auto && auto[0].match(/href\s*=\s*["']([^"']+)["']/i);
      return (
        `# Feed nao reconhecido\nURL: ${payload.finalUrl}\n\n` +
        `O conteudo desta URL e uma pagina HTML, nao um feed RSS/Atom. ` +
        (href
          ? `A propria pagina anuncia um feed em: ${href[1]}\nLeia essa URL com read_feed.\n`
          : `Use read_page para ler a pagina.\n`)
      );
    }
    return (
      `# Feed nao reconhecido\nURL: ${payload.finalUrl}\n\n` +
      `O conteudo nao tem a estrutura de RSS, Atom ou JSON Feed. ` +
      `Se for uma pagina, use read_page; se for JSON de API, use read_json.\n`
    );
  }

  const selecionados = feed.itens.slice(0, limiteItens);
  const completo = formatarSaidaFeed({
    finalUrl: payload.finalUrl,
    feed: { ...feed, itens: selecionados },
    totalFeed: feed.itens.length,
  });
  const { text } = truncate(completo, maxChars);
  return text;
}

/* ===================================================================== *
 * read_json                                                             *
 * ===================================================================== */

/** Resume a forma de um valor JSON, para orientar quem vai consumir. */
export function resumirForma(valor) {
  if (Array.isArray(valor)) return `array de ${valor.length} item(ns)`;
  if (valor === null) return "null";
  if (typeof valor === "object") {
    const chaves = Object.keys(valor);
    const amostra = chaves.slice(0, 8).join(", ");
    return `objeto com ${chaves.length} chave(s)` + (chaves.length ? `: ${amostra}${chaves.length > 8 ? ", ..." : ""}` : "");
  }
  return typeof valor;
}

/**
 * Ferramenta read_json: lê uma resposta JSON pública e devolve formatada.
 *
 * Antes disto, JSON era erro por desenho ("o conteúdo não é HTML"). Aqui ele é
 * o produto: o JSON é parseado, indentado e entregue com a forma declarada —
 * e, se tiver um envelope comum de API, o caminho dos dados é apontado.
 */
export async function toolReadJson(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const caminho = args.path ? String(args.path) : "";

  const payload = await fetchTextCached(parsed.href, { timeoutMs });

  let dados;
  try {
    dados = JSON.parse(payload.text);
  } catch (err) {
    if (tipoDoCorpo(payload.contentType, payload.text) === "html") {
      return (
        `# JSON nao reconhecido\nURL: ${payload.finalUrl}\n\n` +
        `Esta URL devolveu HTML, nao JSON. Use read_page para ler a pagina.\n`
      );
    }
    return (
      `# JSON invalido\nURL: ${payload.finalUrl}\n\n` +
      `O corpo nao e um JSON valido (${err.message}). ` +
      `Pode ser JSONP, NDJSON ou um erro do servidor em texto puro.\n`
    );
  }

  // `path` no formato "data.items" — evita a IA ter de parsear o envelope.
  let alvo = dados;
  if (caminho) {
    for (const parte of caminho.split(".").filter(Boolean)) {
      if (alvo == null) break;
      alvo = alvo[parte];
    }
    if (alvo === undefined) {
      return (
        `# JSON: caminho nao encontrado\nURL: ${payload.finalUrl}\n\n` +
        `O caminho '${caminho}' nao existe. ` +
        `A raiz e um ${resumirForma(dados)}.\n`
      );
    }
  }

  const formatado = JSON.stringify(alvo, null, 2);
  const { text, truncated } = truncate(formatado, maxChars);

  const linhas = [];
  linhas.push(`# JSON: ${payload.finalUrl.split("/").pop() || payload.finalUrl}`);
  linhas.push(`URL: ${payload.finalUrl}`);
  if (caminho) linhas.push(`Caminho: ${caminho}`);
  linhas.push(`Forma: ${resumirForma(alvo)}`);
  linhas.push(`Conteudo: ${formatado.length} caracteres` + (truncated ? ` (exibidos ${text.length})` : ""));
  linhas.push("");
  linhas.push("```json");
  linhas.push(text);
  linhas.push("```");
  return linhas.join("\n");
}
