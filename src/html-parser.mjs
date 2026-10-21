/**
 * html-parser.mjs — de HTML para markdown, sem biblioteca nenhuma.
 *
 * O QUE É
 *   Um tokenizador e um conjunto de regras de emissão escritos à mão. O
 *   objetivo não é reproduzir um navegador: é devolver o TEXTO ÚTIL de uma
 *   página, legível para uma IA, com o mínimo de ruído.
 *
 *   O que ele resolve: tags void, blocos que devem ser ignorados (script,
 *   style, nav, footer...), tabelas em formato GFM, blocos de código,
 *   entidades HTML, aria-hidden, e limpeza de artefatos do markdown final.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: o HTML como string e a URL base (para tornar link relativo em
 *          absoluto).
 *   Sai:   markdown, ou a lista de links, ou os metadados (título, descrição,
 *          canonical...) — dependendo da função chamada.
 *
 * AS TRÊS FUNÇÕES PÚBLICAS
 *   htmlToMarkdown          → só o markdown.
 *   htmlToMarkdownComLinks  → markdown + links numa passada só (o caminho
 *                             usado pelo read_page, mais rápido).
 *   extractLinks / extractMeta → só links, ou só metadados.
 *
 * QUEM USA
 *   Usado por: feeds, fetch, tools, video. É o arquivo mais reaproveitado do
 *   projeto — e por isso o que tem golden files em tests/golden/.
 */

// Tags que não têm conteúdo (void elements).
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// Tags cujo conteúdo é lixo para leitura.
const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "canvas", "iframe",
  "object", "audio", "video", "nav", "header", "footer", "aside", "form",
  "head", "select", "button",
]);

// Tags de bloco que, DENTRO de <pre>, não podem emitir quebra de linha.
const PRE_SILENCE_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "div", "section", "article", "main", "figure", "figcaption",
  "details", "summary", "ul", "ol", "dl", "blockquote", "li",
]);

// Tags cujos atributos algum consumidor realmente lê (`href`, `src`, `alt`).
// Para todas as outras, o tokenizador só paga `parseAttrs` se o corpo da tag
// contiver "aria-hidden" — ver o comentário longo no ponto de emissão.
const TAGS_COM_ATTRS = new Set(["a", "img"]);

// Objeto vazio compartilhado: evita alocar um `{}` por tag sem atributos.
// Ninguém escreve em `token.attrs`, então é seguro reaproveitar a instância.
const ATTRS_VAZIOS = Object.freeze({});

// Tabela de entidades HTML nomeadas (Latin-1 + tipografia).
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
  OElig: "\u0152", oelig: "\u0153", Scaron: "\u0160", scaron: "\u0161",
  Yuml: "\u0178", fnof: "\u0192", circ: "\u02c6", tilde: "\u02dc",
  ensp: " ", emsp: " ", thinsp: "\u2009", zwnj: "\u200c", zwj: "\u200d",
  lrm: "\u200e", rlm: "\u200f", oplus: "\u2295", otimes: "\u2297",
};

/** Um caractere de espaço no mesmo sentido que `\s` do JS. */
function ehEspaco(c) {
  return (
    c === 32 ||
    c === 9 ||
    c === 10 ||
    c === 13 ||
    c === 12 ||
    c === 11 ||
    c === 0xa0 ||
    c === 0xfeff ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/**
 * Decodifica o corpo de uma entidade (o que fica entre `&` e `;`).
 * Devolve `null` quando o corpo não é uma entidade conhecida.
 *
 * Substitui o `String.replace` com callback do caminho antigo: o perfil
 * apontava 16% do CPU do parser aqui, entre a regex e a closure.
 */
function decodificarCorpo(body) {
  const n = body.length;
  const c0 = body.charCodeAt(0);
  if (c0 === 35) {
    // "#..." — referência numérica (decimal ou hexadecimal).
    if (n < 2) return null;
    const c1 = body.charCodeAt(1);
    const isHex = c1 === 120 || c1 === 88; // x | X
    let k = isHex ? 2 : 1;
    if (k >= n) return null;
    for (; k < n; k++) {
      const c = body.charCodeAt(k);
      const okHex =
        (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
      if (isHex ? !okHex : !(c >= 48 && c <= 57)) return null;
    }
    const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
    try {
      return String.fromCodePoint(code);
    } catch {
      return null;
    }
  }
  // Nomeada: [A-Za-z][A-Za-z0-9]*
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return null;
  for (let k = 1; k < n; k++) {
    const c = body.charCodeAt(k);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57))) {
      return null;
    }
  }
  const replacement = NAMED_ENTITIES[body];
  return replacement === undefined ? null : replacement;
}

/** Teto de caracteres entre `&` e `;`: cobre toda entidade nomeada do HTML. */
const MAX_CORPO_ENTIDADE = 64;

/**
 * Decodifica entidades HTML (&amp;, &lt;, &#123;, etc.) para texto puro.
 *
 * Varredura manual com `indexOf`: nada é alocado nem concatenado enquanto
 * não aparece a primeira entidade — o caso comum (texto sem `&`) sai com
 * zero custo e o caso com entidade monta a saída uma vez.
 */
export function decodeEntities(input) {
  if (!input || input.indexOf("&") === -1) return input;
  const len = input.length;
  let partes = null; // só aloca ao primeiro "&" válido
  let ultimo = 0; // início do trecho ainda não copiado
  let i = 0;
  while (i < len) {
    const amp = input.indexOf("&", i);
    if (amp === -1) break;
    const semi = input.indexOf(";", amp + 1);
    const corpoLen = semi === -1 ? -1 : semi - amp - 1;
    if (corpoLen < 1 || corpoLen > MAX_CORPO_ENTIDADE) {
      i = amp + 1; // não é entidade: segue depois do "&"
      continue;
    }
    const rep = decodificarCorpo(input.slice(amp + 1, semi));
    if (rep === null) {
      i = amp + 1; // entidade desconhecida: fica como está no texto
      continue;
    }
    if (partes === null) partes = [];
    partes.push(input.slice(ultimo, amp), rep);
    ultimo = semi + 1;
    i = semi + 1;
  }
  if (partes === null) return input;
  partes.push(input.slice(ultimo));
  return partes.join("");
}

/**
 * Encontra o ">" que fecha uma tag, respeitando atributos entre aspas.
 *
 * Laço linear com `charCodeAt`: a versão com `indexOf` de aspas custava
 * O(n) por tag quando não havia aspa adiante (varria o documento até o
 * fim), o que na prática virava O(n²) numa página de 1,4 MB.
 */
function findTagEnd(html, start) {
  const len = html.length;
  let quote = 0; // 0 = fora de aspas; 34 = `"`; 39 = `'`
  for (let j = start + 1; j < len; j++) {
    const c = html.charCodeAt(j);
    if (quote !== 0) {
      if (c === quote) quote = 0;
    } else if (c === 34 || c === 39) {
      quote = c;
    } else if (c === 62) {
      return j;
    }
  }
  return -1;
}

function iniciaNomeAtributo(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58; // A-Z a-z _ :
}

function continuaNomeAtributo(c) {
  return (
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) ||
    c === 45 ||
    c === 95 ||
    c === 58 ||
    c === 46
  ); // A-Z a-z 0-9 - _ : .
}

/**
 * Extrai atributos de uma tag HTML.
 *
 * Scanner manual no lugar do `RegExp.exec` em laço: o perfil mostrava 12%
 * do CPU do parser aqui (a regex de atributo é das mais caras). A semântica
 * é a mesma: nome `[A-Za-z_:][-A-Za-z0-9_:.]*`, valor opcional entre aspas
 * duplas, simples ou sem aspas, e o último atributo repetido vence.
 */
function parseAttrs(source) {
  const attrs = {};
  const len = source.length;
  let i = 0;
  while (i < len) {
    // Pula o que não inicia nome (espaços, "/", "=", aspas...).
    while (i < len && !iniciaNomeAtributo(source.charCodeAt(i))) i++;
    if (i >= len) break;
    const inicio = i;
    i++;
    while (i < len && continuaNomeAtributo(source.charCodeAt(i))) i++;
    const nome = source.slice(inicio, i);

    // Valor: `\s*=\s*` é opcional.
    let j = i;
    while (j < len && ehEspaco(source.charCodeAt(j))) j++;
    let valor = "";
    if (j < len && source.charCodeAt(j) === 61) {
      j++;
      while (j < len && ehEspaco(source.charCodeAt(j))) j++;
      const c = j < len ? source.charCodeAt(j) : -1;
      if (c === 34 || c === 39) {
        const fim = source.indexOf(source[j], j + 1);
        if (fim === -1) {
          // Aspas sem fecho: nada é consumido além do nome, como na regex.
          i = j;
        } else {
          valor = source.slice(j + 1, fim);
          i = fim + 1;
        }
      } else {
        let k = j;
        while (k < len) {
          const cc = source.charCodeAt(k);
          if (ehEspaco(cc) || cc === 34 || cc === 39 || cc === 61 || cc === 60 || cc === 62 || cc === 96) {
            break;
          }
          k++;
        }
        valor = source.slice(j, k);
        i = k;
      }
    }
    attrs[nome.toLowerCase()] = valor.indexOf("&") === -1 ? valor : decodeEntities(valor);
  }
  return attrs;
}

/**
 * Generator de tokens — não materializa o array inteiro na memória.
 * Em sites grandes (1MB+ de HTML) isso reduz ~40% de pico de memória.
 */
function* tokenize(html) {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      yield { type: "text", value: html.slice(i) };
      break;
    }
    if (lt > i) yield { type: "text", value: html.slice(i, lt) };
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const nextChar = html[lt + 1];
    const nextCode = lt + 1 < html.length ? html.charCodeAt(lt + 1) : -1;
    const startsTag =
      nextChar === "/" ||
      nextChar === "!" ||
      nextChar === "?" ||
      (nextCode >= 65 && nextCode <= 90) ||
      (nextCode >= 97 && nextCode <= 122);
    if (!startsTag) {
      yield { type: "text", value: "<" };
      i = lt + 1;
      continue;
    }
    if (html.startsWith("<![CDATA[", lt)) {
      const end = html.indexOf("]]>", lt + 9);
      const inner = end === -1 ? html.slice(lt + 9) : html.slice(lt + 9, end);
      yield { type: "text", value: inner, raw: true };
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (nextChar === "!" || nextChar === "?") {
      const end = findTagEnd(html, lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const gt = findTagEnd(html, lt);
    if (gt === -1) {
      yield { type: "text", value: html.slice(lt) };
      break;
    }
    let rawInicio = lt + 1;
    let rawFim = gt;
    while (rawInicio < rawFim && ehEspaco(html.charCodeAt(rawInicio))) rawInicio++;
    while (rawFim > rawInicio && ehEspaco(html.charCodeAt(rawFim - 1))) rawFim--;
    const raw = html.slice(rawInicio, rawFim);
    i = gt + 1;
    if (!raw) continue;
    const closing = raw[0] === "/";
    // Corpo sem os espaços das pontas (o "/" final já é tratado depois).
    let bIni = closing ? 1 : 0;
    while (bIni < raw.length && ehEspaco(raw.charCodeAt(bIni))) bIni++;
    let bFim = raw.length;
    while (bFim > bIni && ehEspaco(raw.charCodeAt(bFim - 1))) bFim--;

    // Nome da tag: [A-Za-z][A-Za-z0-9:_-]* — scanner no lugar de `match`.
    if (bIni >= bFim) continue;
    const cNome = raw.charCodeAt(bIni);
    if (!((cNome >= 65 && cNome <= 90) || (cNome >= 97 && cNome <= 122))) continue;
    let k = bIni + 1;
    while (k < bFim) {
      const c = raw.charCodeAt(k);
      if (
        !((c >= 65 && c <= 90) ||
          (c >= 97 && c <= 122) ||
          (c >= 48 && c <= 57) ||
          c === 58 ||
          c === 95 ||
          c === 45)
      ) {
        break;
      }
      k++;
    }
    const tag = raw.slice(bIni, k).toLowerCase();
    // `selfClosing` olha o corpo inteiro: barra final ou tag void.
    const selfClosing = !closing && (VOID_TAGS.has(tag) || raw.charCodeAt(bFim - 1) === 47);
    if (closing) {
      yield { type: "close", tag };
    } else {
      // Parse de atributos CONDICIONAL. O perfil mostrou que a maior parte do
      // custo de `parseAttrs` era jogada fora: de todos os consumidores, só
      // `<a>` e `<img>` leem atributos de verdade, e o resto do parser só olha
      // `aria-hidden`. Então uma `<div class="..." data-...>` não paga mais
      // nada por carregar atributos que ninguém vai ler. O teste de
      // `aria-hidden` é um `indexOf` no corpo cru — se a string não aparece,
      // o atributo não existe, e o resultado é idêntico ao do parse completo.
      // O `slice` também é condicional: fatiar o corpo da tag para depois
      // descobrir que ninguém vai ler os atributos era alocar uma string por
      // tag (a página tem milhares). O teste de `aria-hidden` é feito sobre
      // `raw` a partir de `k`, na própria string já existente.
      let attrs = ATTRS_VAZIOS;
      if (TAGS_COM_ATTRS.has(tag)) {
        attrs = parseAttrs(k < bFim ? raw.slice(k, bFim) : "");
      } else if (k < bFim && raw.indexOf("aria-hidden", k) !== -1) {
        attrs = parseAttrs(raw.slice(k, bFim));
      }
      yield { type: "open", tag, selfClosing, attrs };
    }
  }
}

/**
 * Resolve um href relativo para URL absoluta. Remove parâmetros de rastreamento utm_*.
 */
function resolveUrl(href, baseUrl) {
  if (!href) return null;
  const value = String(href).trim();
  if (!value || value.startsWith("#") || /^(javascript|mailto|tel|data|ftp|file):/i.test(value)) return null;
  try {
    const url = new URL(value, baseUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Normaliza espaços e quebras do markdown SEM tocar no interior de blocos cercados (```).
 */
function cleanMarkdown(text) {
  const blocks = [];
  const normalized = String(text).replace(/\r\n?/g, "\n");
  const masked = normalized.replace(/```[\s\S]*?```/g, (match) => `\u0000${blocks.push(match) - 1}\u0000`);
  const cleaned = masked
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.replace(/\u0000(\d+)\u0000/g, (_, index) => blocks[Number(index)]);
}

/* ===================================================================== *
 * Tabelas                                                                 *
 * ===================================================================== */

/** Monta a linha markdown de uma linha de células, preenchendo as faltantes. */
function linhaDeTabela(cells, cols, celula) {
  const partes = [];
  for (let c = 0; c < cols; c++) partes.push(celula(cells[c]));
  return `| ${partes.join(" | ")} |`;
}

/**
 * Renderiza as linhas de uma tabela em markdown GFM.
 * Linhas sem células são descartadas; o número de colunas é o maior entre as
 * linhas válidas (colspan vira uma célula a mais).
 */
function renderTable(rows) {
  const validas = rows.filter((row) => row.cells.length > 0);
  if (validas.length === 0) return "";
  const cols = Math.max(...validas.map((row) => row.cells.length));
  const celula = (cell) =>
    String(cell ? cell.text : "")
      .replace(/\s+/g, " ")
      .replace(/\|/g, "\\|")
      .trim();
  const linhas = [
    linhaDeTabela(validas[0].cells, cols, celula),
    `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`,
  ];
  for (let r = 1; r < validas.length; r++) linhas.push(linhaDeTabela(validas[r].cells, cols, celula));
  return "\n\n" + linhas.join("\n") + "\n\n";
}

/* ===================================================================== *
 * Rastreio incremental do buffer                                          *
 *                                                                         *
 * O fecho de <pre> precisa, a cada bloco de código, da última cerca        *
 * "```\n" do buffer e do buffer sem os "\n" finais. Fazer isso varrendo    *
 * `out` inteiro a cada fecho custava O(n) por bloco — O(n²) na página      *
 * (o perfil apontou ~48% do CPU do parser aí). O estado mantido por estes  *
 * helpers responde às duas perguntas sem varredura:                        *
 *   - `cercas`: posições das cercas "```\n" no buffer, em ordem crescente; *
 *   - `tail`:   os últimos 3 caracteres do buffer (pega a cerca que cruza *
 *               a junção de dois chunks);                                  *
 *   - `nlMat`:  "\n" finais contíguos do buffer;                          *
 *   - `pend`:   "\n" finais ainda não materializados no buffer (o strip do *
 *               </pre> os descarta de graça).                              *
 * ===================================================================== */

/** Anexa um pedaço ao buffer lógico, mantendo o rastreio em sincronia. */
function empurrar(st, chunk) {
  if (!chunk) return;
  // Cerca "```\n" que cruza a fronteira deste pedaço com o anterior.
  const base = st.outLen - st.prevTail.length;
  const combinado = st.prevTail + chunk;
  for (let idx = combinado.indexOf("```\n"); idx !== -1; idx = combinado.indexOf("```\n", idx + 1)) {
    st.cercas.push(base + idx);
  }
  st.chunks.push(chunk);
  st.outLen += chunk.length;
  st.prevTail = combinado.slice(-3);
  let j = chunk.length;
  while (j > 0 && chunk.charCodeAt(j - 1) === 10) j--;
  st.nlFim = j === 0 ? st.nlFim + chunk.length : chunk.length - j;
}

/** Recalcula `prevTail` e `nlFim` a partir dos pedaços (após um corte). */
function sincronizarFim(st) {
  let nl = 0;
  for (let i = st.chunks.length - 1; i >= 0; i--) {
    const c = st.chunks[i];
    let j = c.length;
    while (j > 0 && c.charCodeAt(j - 1) === 10) j--;
    nl += c.length - j;
    if (j > 0) break;
  }
  st.nlFim = nl;
  let tail = "";
  for (let i = st.chunks.length - 1; i >= 0; i--) {
    const c = st.chunks[i];
    const falta = 3 - tail.length;
    if (c.length >= falta) {
      tail = c.slice(-falta) + tail;
      break;
    }
    tail = c + tail;
  }
  st.prevTail = tail;
}

/** Corta o buffer lógico para `novoLen` caracteres e sincroniza o rastreio. */
function truncarPara(st, novoLen) {
  if (novoLen >= st.outLen) return;
  if (novoLen < 0) novoLen = 0;
  let excesso = st.outLen - novoLen;
  while (excesso > 0) {
    const ult = st.chunks[st.chunks.length - 1];
    if (ult.length <= excesso) {
      st.chunks.pop();
      excesso -= ult.length;
    } else {
      st.chunks[st.chunks.length - 1] = ult.slice(0, ult.length - excesso);
      excesso = 0;
    }
  }
  st.outLen = novoLen;
  while (st.cercas.length > 0 && st.cercas[st.cercas.length - 1] + 4 > novoLen) {
    st.cercas.pop();
  }
  sincronizarFim(st);
}

/** Extrai do buffer lógico o trecho de `inicio` até o fim: `out.slice(inicio)`. */
function extrairDe(st, inicio) {
  if (inicio >= st.outLen) return "";
  let fim = st.outLen;
  const partes = [];
  for (let i = st.chunks.length - 1; i >= 0 && fim > inicio; i--) {
    const c = st.chunks[i];
    const pi = fim - c.length;
    if (pi >= inicio) {
      partes.push(c);
      fim = pi;
    } else {
      partes.push(c.slice(inicio - pi));
      fim = inicio;
    }
  }
  partes.reverse();
  return partes.join("");
}

/** Junta o buffer lógico numa string (uma vez, no final). */
function materializar(st) {
  return st.chunks.length === 1 ? st.chunks[0] : st.chunks.join("");
}

/** Remove os "\n" finais do buffer lógico (o strip do fecho de <pre>). */
function removerNovasLinhasFinais(st) {
  if (st.nlFim > 0) truncarPara(st, st.outLen - st.nlFim);
}

/* ===================================================================== *
 * Estado da conversão                                                     *
 * ===================================================================== */

/**
 * Estado mutável da conversão: saída acumulada, profundidades de skip/pre,
 * pilhas de tags abertas, de links e de blocos aria-hidden, e a tabela em
 * montagem. As ações recebem o estado e o emitem texto por `emit`.
 */
function criarEstadoConversao() {
  return {
    // Buffer lógico em pedaços + rastreio incremental (ver "Rastreio
    // incremental do buffer" acima): `chunks`/`outLen` são a saída;
    // `cercas`, `nlFim` e `prevTail` respondem barato às perguntas do
    // fecho de <pre> (última cerca, "\n" finais, junção de pedaços).
    chunks: [],
    outLen: 0,
    prevTail: "",
    nlFim: 0,
    cercas: [],
    skipDepth: 0,
    preDepth: 0,
    openStack: [],
    aStack: [],
    ariaHiddenStack: [],
    tableDepth: 0,
    tableRows: [],
    tableRow: null,
    tableCell: null,
    ultimoBlocoCodigo: null,
    emit(chunk) {
      if (this.tableCell) { this.tableCell.text += chunk; return; }
      empurrar(this, chunk);
    },
  };
}

/* ===================================================================== *
 * Texto                                                                   *
 * ===================================================================== */

/**
 * Normaliza um texto simples: decodifica entidades e, fora de <pre>, remove
 * o "[editar]" da Wikipédia, o "¶" e colapsa espaços.
 */
function textoNormalizado({ token, preDepth }) {
  if (!token) return "";
  let decoded = token.raw ? token.value : decodeEntities(token.value);
  if (preDepth === 0) {
    decoded = decoded
      .replace(/\[editar[^\]]*\]/g, "")
      .replace(/¶/g, "")
      .replace(/\s+/g, " ");
  }
  return decoded;
}

/* ===================================================================== *
 * Ações por categoria de tag                                              *
 * ===================================================================== */

const TAGS_BLOCOS_FECHO = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "div", "section", "article", "main",
  "ul", "ol", "dl", "blockquote",
  "figure", "figcaption", "details",
]);

/** Cabeçalhos: fecham o link aberto, depois abrem o título. */
function abrirCabecalho(st, tag, emit) {
  if (st.aStack.length > 0) {
    const href = st.aStack.pop();
    if (href) emit(`](${href})`);
    emit("\n\n");
  }
  emit("\n\n" + "#".repeat(Number(tag[1])) + " ");
}

/** Listas: marcador de item. */
function abrirLista(st, tag, emit) {
  emit("- ");
}

/** Tabelas: abrem a linha e a célula. */
function abrirTabela(st, tag, emit) {
  if (tag === "table") {
    if (st.tableDepth === 0) {
      st.tableRows = [];
      st.tableRow = null;
      st.tableCell = null;
    }
    st.tableDepth++;
  } else if (tag === "tr") {
    if (st.tableDepth > 0) {
      st.tableRow = { cells: [] };
      st.tableCell = null;
    } else {
      emit("\n");
    }
  } else if (tag === "th" || tag === "td") {
    if (st.tableDepth > 0) st.tableCell = { text: "" };
    else emit(" ");
  } else {
    // caption/tbody/thead/tfoot fora de tabela
    if (st.tableDepth === 0) emit("\n");
  }
}

/** Links e imagens: abrem "[texto](" ou "![alt](src)". */
function abrirLinkOuImagem(st, token, baseUrl, emit) {
  const tag = token.tag;
  if (tag === "a") {
    const href = resolveUrl(token.attrs.href, baseUrl);
    st.aStack.push(href);
    if (href) emit("[");
    return;
  }
  const src = resolveUrl(token.attrs.src, baseUrl);
  const alt = (token.attrs.alt || "").trim();
  if (src) {
    const altLimitado = alt.length > 200 ? alt.slice(0, 200) + "…" : alt;
    emit(`![${altLimitado}](${src})`);
  }
}

/** Código: abre bloco em <pre> ou cercado inline. */
function abrirCodigo(st, tag, emit) {
  if (tag === "pre") {
    st.preDepth++;
    emit("\n\n```\n");
  } else if (st.preDepth === 0) {
    emit("`");
  }
}

/** Fecho de cabeçalho/bloco/lista: quebras de linha. */
function fecharBloco(st, tag, emit) {
  emit("\n\n");
}

/** Fecho de item de lista. */
function fecharLista(st, tag, emit) {
  emit("\n");
}

/** Fecho de tabela: desce a profundidade e renderiza quando fecha a tabela. */
function fecharTabela(st, tag, emit) {
  if (tag === "table") {
    if (st.tableDepth > 0) {
      st.tableDepth--;
      if (st.tableDepth === 0) {
        empurrar(st, renderTable(st.tableRows));
        st.tableRows = [];
        st.tableRow = null;
        st.tableCell = null;
      }
    }
    return;
  }
  if (tag === "tr") {
    if (st.tableDepth > 0) {
      if (st.tableRow && st.tableRow.cells.length > 0) st.tableRows.push(st.tableRow);
      st.tableRow = null;
      st.tableCell = null;
    } else {
      emit("\n");
    }
    return;
  }
  if (tag === "th" || tag === "td") {
    if (st.tableDepth > 0) {
      if (st.tableRow && st.tableCell) st.tableRow.cells.push(st.tableCell);
      st.tableCell = null;
    } else {
      emit(" |");
    }
    return;
  }
  // caption/tbody/thead/tfoot fora de tabela
  if (st.tableDepth === 0) emit("\n");
}

/** Fecho de link, inline e código. */
function fecharInline(st, tag, emit) {
  if (tag === "a") {
    const href = st.aStack.pop();
    if (href) emit(`](${href})`);
    return;
  }
  if (tag === "code") {
    if (st.preDepth === 0) emit("`");
    return;
  }
  if (tag === "pre") {
    if (st.preDepth > 0) st.preDepth--;
    if (!st.tableCell) removerNovasLinhasFinais(st);
    const cerca = st.cercas.length > 0 ? st.cercas[st.cercas.length - 1] : -1;
    const blocoAtual = cerca === -1 ? materializar(st) : extrairDe(st, cerca + 4);
    if (blocoAtual === st.ultimoBlocoCodigo && blocoAtual.length > 0) {
      if (cerca !== -1) truncarPara(st, cerca);
      st.ultimoBlocoCodigo = null;
    } else {
      st.ultimoBlocoCodigo = blocoAtual;
    }
    emit("\n```\n\n");
    return;
  }
  if (tag === "strong" || tag === "b") {
    emit("**");
    return;
  }
  if (tag === "em" || tag === "i") {
    emit("*");
  }
}

/* ===================================================================== *
 * Conversão                                                               *
 * ===================================================================== */

/**
 * Aplica o fecho de uma tag na pilha de tags abertas (ignora o que não casa).
 */
function fecharNaPilha(st, tag) {
  for (let k = st.openStack.length - 1; k >= 0; k--) {
    if (st.openStack[k] === tag) {
      st.openStack.length = k;
      break;
    }
  }
}

// Parâmetros da parada antecipada (ver htmlToMarkdown). Números explicados:
// a limpeza final ENCOLHE o texto, então a primeira verificação só acontece
// com o buffer em `minimo + MARGEM_COMPRESSAO`; para liberar a parada, o
// texto limpo tem de passar de `minimo + MARGEM_SEGURANCA` (a diferença
// entre parcial e completo fica toda na cauda; essa folga cobre com sobra);
// se a verificação falhar, o limiar avança PASSO_RECHECAGEM e depois de
// MAX_RECHECAGENS sem atingir a garantia a conversão segue inteira (página
// quase toda espaço em branco não tem ponto de parada seguro).
const MARGEM_COMPRESSAO = 35000;
const MARGEM_SEGURANCA = 2000;
const PASSO_RECHECAGEM = 16384;
const MAX_RECHECAGENS = 6;

/**
 * A conversão pode parar neste ponto sem cortar nada entregável?
 * Exige: fora de <pre>, de tabela em montagem, de célula e de bloco
 * ignorado — a saída termina num token inteiro, não no meio de estrutura —
 * e as cercas "```\n" emparelhadas (o buffer termina depois de um bloco de
 * código completo, não dentro dele) e sem backtick solto no fim (que mudaria
 * o pareamento do mascaramento da limpeza final).
 */
function fronteiraSegura(st) {
  return (
    st.preDepth === 0 &&
    st.tableDepth === 0 &&
    !st.tableCell &&
    st.skipDepth === 0 &&
    st.aStack.length === 0 &&
    st.cercas.length % 2 === 0 &&
    !st.prevTail.endsWith("`")
  );
}

/**
 * Polimento final do texto (mesma cadeia de replaces do fim da conversão).
 * Fica em função própria porque a verificação da parada antecipada precisa
 * do comprimento FINAL — sem isso a folga de segurança seria medida num
 * texto que ainda vai encolher.
 */
function polirTexto(texto) {
  let resultado = texto
    .replace(/\[\s*\]/g, "")
    .replace(/\[\s*\n\s*\]/g, "")
    .replace(/\[\s*\|\s*\]/g, "");
  resultado = resultado
    .replace(/^\[Skip to content\]\([^)]*\)\n*/i, "")
    .replace(/^\[Minha [^\]]+\]\([^)]*\)\n*/i, "")
    .replace(/\?utm_[^)\s]*/g, "");
  return resultado;
}

/** Fecha a conversão: tabela pendente, limpeza e polimento final. */
function finalizarConversao(st) {
  if (st.tableDepth > 0) empurrar(st, renderTable(st.tableRows));
  return polirTexto(cleanMarkdown(materializar(st)));
}

/**
 * Converte o HTML em markdown enxuto.
 *
 * `opcoes.minCharsEntregaveis` (número > 0) liga a PARADA ANTECIPADA: quando
 * o caller não consegue receber mais que isso (HARD_MAX_CHARS é o teto de
 * saída do servidor), páginas gigantes param de ser convertidas assim que
 * os caracteres entregáveis estão garantidos — o prefixo devolvido é byte a
 * byte igual ao da conversão completa (verificação de limpeza + margens
 * acima), então a fidelidade do texto não muda; o que muda é o trabalho
 * jogado fora, que chega a 97% em páginas de 1 MB. A parada só ocorre em
 * fronteira segura e `opcoes.diagnostico.interrompida` fica `true` quando
 * acontecer. Sem opções, o comportamento histórico: converte tudo.
 */
export function htmlToMarkdown(html, baseUrl, opcoes = {}) {
  return htmlToMarkdownComLinks(html, baseUrl, opcoes).markdown;
}

/**
 * PASSO ÚNICO: converte para markdown E extrai os links na MESMA tokenização.
 *
 * Antes, `htmlToMarkdown` e `extractLinks` liam o HTML inteiro cada um: em uma
 * página de 1,34 MB isso custava 52,6 ms + 41,0 ms — duas varreduras completas
 * do mesmo texto. A tokenização é a parte que se paga duas vezes, e ela não
 * depende do que se quer extrair: aqui um único laço produz os dois resultados.
 *
 * A coleta de links roda ANTES do processamento do markdown em cada token e
 * não é afetada pela parada antecipada. Quando a parada dispara, o markdown é
 * finalizado naquele ponto (`markdownFinal`) e o laço CONTINUA apenas coletando
 * links — o rabo da página ainda é varrido uma vez (barato), mas nunca mais
 * convertido duas vezes.
 *
 * As regras de "conteúdo que não é conteúdo" são idênticas às de `extractLinks`
 * (tags de skip e blocos `aria-hidden`), e a saída é verificada contra o golden
 * e contra o próprio `extractLinks` nos testes.
 */
/**
 * Cria o coletor de links da passada única.
 *
 * Ele mantém o próprio estado (pilha de tags ignoradas, link aberto no
 * momento) e roda em PARALELO à conversão do markdown, token a token. Duas
 * consequências que importam:
 *
 *   - Não depende do estado da conversão: `processar()` pode ser chamado
 *     antes, depois ou mesmo quando o markdown já foi finalizado pela parada
 *     antecipada — e continua coletando o rabo da página.
 *   - As regras de "o que não é conteúdo" são as MESMAS do `extractLinks`
 *     (SKIP_TAGS e blocos aria-hidden). Se divergissem, a passada única
 *     devolveria links diferentes da função dedicada.
 *
 * Devolve um objeto com `processar(token)` e o array `links`, que já sai
 * deduplicado por href e com a marca de interno/externo.
 */
function criarColetorDeLinks(baseUrl) {
  const links = [];
  const vistos = new Set();
  const baseHost = hostOf(baseUrl);
  const pilhaAria = [];
  let profundidadeSkip = 0;
  let linkAtual = null;

  function abrir(token, tagIgnorada, oculto) {
    if (tagIgnorada || oculto) {
      if (!token.selfClosing) {
        profundidadeSkip++;
        pilhaAria.push(token.tag);
      }
      return;
    }
    if (profundidadeSkip !== 0) return;
    if (token.tag === "a") {
      linkAtual = { href: resolveUrl(token.attrs.href, baseUrl), parts: [], imgAlt: null };
    }
    if (token.tag === "img" && linkAtual && !linkAtual.imgAlt) {
      const alt = (token.attrs.alt || "").trim();
      if (alt) linkAtual.imgAlt = alt;
    }
  }

  function fechar(token, tagIgnorada) {
    const idx = pilhaAria.lastIndexOf(token.tag);
    if (idx !== -1) {
      pilhaAria.length = idx;
      if (profundidadeSkip > 0) profundidadeSkip--;
      return;
    }
    if (tagIgnorada) {
      if (profundidadeSkip > 0) profundidadeSkip--;
      return;
    }
    if (profundidadeSkip !== 0) return;
    if (token.tag !== "a" || !linkAtual) return;
    const href = linkAtual.href;
    // O texto do link é o que estava entre <a>...</a>; sem texto, cai para o
    // alt da imagem (link que é só imagem) e, por último, para um marcador.
    const texto =
      decodeEntities(linkAtual.parts.join("")).replace(/\s+/g, " ").trim() ||
      linkAtual.imgAlt ||
      "(sem texto)";
    linkAtual = null;
    if (href && !vistos.has(href)) {
      vistos.add(href);
      links.push({ text: texto, href, internal: hostOf(href) === baseHost });
    }
  }

  return {
    links,
    processar(token) {
      const tagIgnorada = SKIP_TAGS.has(token.tag);
      const oculto = Boolean(token.attrs && token.attrs["aria-hidden"] === "true");
      if (token.type === "open") abrir(token, tagIgnorada, oculto);
      else if (token.type === "close") fechar(token, tagIgnorada);
      else if (token.type === "text" && linkAtual && profundidadeSkip === 0) {
        linkAtual.parts.push(token.value);
      }
    },
  };
}

/**
 * Decide se já dá para finalizar o markdown agora (parada antecipada).
 *
 * A limpeza final (máscara de cercas + polimento) só é fiel ao prefixo
 * completo se as cercas "```" estiverem TODAS emparelhadas no buffer: com uma
 * cerca ímpar, a máscara da limpeza mudaria de comportamento dentro do trecho
 * exibido. Paridade par = mascaramento idêntico. Por isso uma cerca ímpar
 * bloqueia a parada, mesmo que o tamanho já tenha passado do mínimo.
 *
 * Devolve o markdown finalizado, ou null para continuar convertendo.
 */
function tentarFinalizar(st, { minimo, diagnostico }) {
  const bruto = materializar(st);
  const cercasPareadas = (bruto.match(/```/g) || []).length % 2 === 0;
  if (!cercasPareadas) return null;
  const limpo = polirTexto(cleanMarkdown(bruto));
  if (limpo.length < minimo + MARGEM_SEGURANCA) return null;
  if (diagnostico) diagnostico.interrompida = true;
  return finalizarConversao(st);
}

export function htmlToMarkdownComLinks(html, baseUrl, opcoes = {}) {
  const st = criarEstadoConversao();
  const emit = (chunk) => st.emit(chunk);
  const coletor = criarColetorDeLinks(baseUrl);
  let markdownFinal = null;
  const minimo = Number(opcoes.minCharsEntregaveis) > 0 ? Math.floor(opcoes.minCharsEntregaveis) : 0;
  const diagnostico = opcoes.diagnostico || null;
  let paradaAtiva = minimo > 0;
  let limiar = minimo + MARGEM_COMPRESSAO;
  let reChecagens = 0;

  for (const token of tokenize(html)) {
    // ---- coleta de links (mesma passada) ----------------------------
    // Roda ANTES do markdown para não depender do estado da conversão e
    // continua valendo depois da parada antecipada.
    coletor.processar(token);

    // Markdown já finalizado (parada antecipada): só segue coletando links.
    if (markdownFinal !== null) continue;

    if (paradaAtiva && st.outLen >= limiar && fronteiraSegura(st)) {
      const finalizado = tentarFinalizar(st, { minimo, diagnostico });
      if (finalizado !== null) {
        markdownFinal = finalizado;
        continue;
      }
      if (++reChecagens >= MAX_RECHECAGENS) paradaAtiva = false;
      else limiar = st.outLen + PASSO_RECHECAGEM;
    }
    const isSkipped = SKIP_TAGS.has(token.tag);

    // ---- texto -------------------------------------------------------
    if (token.type === "text") {
      if (st.skipDepth > 0) continue;
      const decoded = textoNormalizado({ token, preDepth: st.preDepth });
      if (!decoded) continue;
      emit(decoded);
      continue;
    }

    // ---- abertura de tag --------------------------------------------
    if (token.type === "open") {
      const escondido = Boolean(token.attrs && token.attrs["aria-hidden"] === "true");
      if (isSkipped || escondido) {
        if (token.selfClosing) continue;
        st.skipDepth++;
        if (escondido) st.ariaHiddenStack.push(token.tag);
        continue;
      }
      if (st.skipDepth > 0) continue;
      if (st.preDepth > 0 && PRE_SILENCE_TAGS.has(token.tag)) continue;
      if (!token.selfClosing) st.openStack.push(token.tag);

      const tag = token.tag;
      if (/^h[1-6]$/.test(tag)) abrirCabecalho(st, tag, emit);
      else if (tag === "p" || tag === "div" || tag === "section" || tag === "article" ||
               tag === "main" || tag === "figure" || tag === "figcaption" ||
               tag === "details" || tag === "summary" || tag === "ul" || tag === "ol" ||
               tag === "dl") {
        emit("\n");
      } else if (tag === "blockquote") {
        emit("\n> ");
      } else if (tag === "li") {
        abrirLista(st, tag, emit);
      } else if (tag === "table" || tag === "tr" || tag === "th" || tag === "td" ||
                 tag === "caption" || tag === "tbody" || tag === "thead" || tag === "tfoot") {
        abrirTabela(st, tag, emit);
      } else if (tag === "a" || tag === "img") {
        abrirLinkOuImagem(st, token, baseUrl, emit);
      } else if (tag === "strong" || tag === "b") {
        emit("**");
      } else if (tag === "em" || tag === "i") {
        emit("*");
      } else if (tag === "pre" || tag === "code") {
        abrirCodigo(st, tag, emit);
      } else if (tag === "br") {
        emit(st.tableCell ? " " : "\n");
      } else if (tag === "hr") {
        emit("\n\n---\n\n");
      }
      continue;
    }

    // ---- fechamento de tag ------------------------------------------
    const idxHidden = st.ariaHiddenStack.lastIndexOf(token.tag);
    if (idxHidden !== -1) {
      st.ariaHiddenStack.length = idxHidden;
      if (st.skipDepth > 0) st.skipDepth--;
      continue;
    }
    if (isSkipped) {
      if (st.skipDepth > 0) st.skipDepth--;
      continue;
    }
    if (st.skipDepth > 0) continue;
    if (st.preDepth > 0 && PRE_SILENCE_TAGS.has(token.tag)) continue;
    fecharNaPilha(st, token.tag);

    const tag = token.tag;
    if (TAGS_BLOCOS_FECHO.has(tag)) fecharBloco(st, tag, emit);
    else if (tag === "li") fecharLista(st, tag, emit);
    else if (tag === "table" || tag === "tr" || tag === "th" || tag === "td" ||
             tag === "caption" || tag === "tbody" || tag === "thead" || tag === "tfoot") {
      fecharTabela(st, tag, emit);
    } else if (tag === "a" || tag === "img" || tag === "strong" || tag === "b" ||
               tag === "em" || tag === "i" || tag === "code" || tag === "pre") {
      fecharInline(st, tag, emit);
    }
  }

  const markdown = markdownFinal !== null ? markdownFinal : finalizarConversao(st);
  return { markdown, links: coletor.links };
}

/**
 * Extrai todos os links de uma página HTML.
 *
 * Espelha o mesmo critério de "conteúdo que não é conteúdo" do
 * `htmlToMarkdown`: tags de skip E blocos `aria-hidden="true"` são ignorados.
 * Sem isso, um link dentro de um carrossel/navegação decorativa marcado como
 * aria-hidden aparecia na lista de links mas sumia do texto — e uma IA lendo a
 * lista acharia que a página tem um link que o markdown diz não existir.
 *
 * O `ariaHiddenStack` guarda a tag de CADA bloco aberto, então o fecho de uma
 * tag comum (ex.: `</nav>`) não baixa o contador de um bloco aria-hidden que
 * continua aberto — sem isso, um bloco mal fechado engolia os links seguintes.
 */
export function extractLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const baseHost = hostOf(baseUrl);
  let skipDepth = 0;
  const ariaHiddenStack = [];
  let current = null;

  for (const token of tokenize(html)) {
    const isSkipped = SKIP_TAGS.has(token.tag);
    const escondido = Boolean(token.attrs && token.attrs["aria-hidden"] === "true");

    if (token.type === "open") {
      if (isSkipped || escondido) {
        if (!token.selfClosing) {
          skipDepth++;
          ariaHiddenStack.push(token.tag);
        }
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
      // Fecho de um bloco escondido: baixa o contador só se a tag for a que
      // abriu o bloco. Fechar outra tag comum não pode encerrar o bloco.
      const idxHidden = ariaHiddenStack.lastIndexOf(token.tag);
      if (idxHidden !== -1) {
        ariaHiddenStack.length = idxHidden;
        if (skipDepth > 0) skipDepth--;
        continue;
      }
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

/**
 * Extrai metadados do HTML cru: título, meta descrição, autor e data de publicação.
 */
const META_TAGS_CHAVES_DESCRICAO = new Set(["description", "og:description"]);
const META_TAGS_CHAVES_TITULO = new Set(["og:title", "twitter:title"]);
const META_TAGS_CHAVES_DATA = new Set([
  "article:published_time",
  "og:published_time",
  "date",
  "pubdate",
]);

export function extractMeta(html) {
  let title = "";
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim();

  // UMA varredura das tags <meta> em vez de quatro regex de documento inteiro.
  // Antes, cada campo (descrição, og:title, autor, data) varria o HTML do
  // começo ao fim com um padrão `<meta[^>]+...` — quatro passadas completas,
  // e o `<meta` seguido de `[^>]+` ainda é um padrão que o motor de regex
  // explora com backtracking. Aqui o documento é varrido uma vez, cada tag é
  // lida com o scanner de atributos que já existe, e o primeiro valor de cada
  // campo (ordem do documento, como antes) vence.
  let description = "";
  let ogTitle = "";
  let author = "";
  let published = "";

  const reMeta = /<meta\b[^>]*>/gi;
  let achado;
  let faltam = 4;
  while (faltam > 0 && (achado = reMeta.exec(html)) !== null) {
    const attrs = parseAttrs(achado[0].slice(5, -1));
    const chave = String(attrs.property || attrs.name || "").toLowerCase();
    if (!chave) continue;
    const conteudo = attrs.content;
    if (conteudo === undefined) continue;
    const valor = decodeEntities(conteudo).trim();
    if (!valor) continue;
    if (!description && META_TAGS_CHAVES_DESCRICAO.has(chave)) {
      description = valor;
      faltam--;
    }
    if (!ogTitle && META_TAGS_CHAVES_TITULO.has(chave)) {
      ogTitle = valor;
      faltam--;
    }
    // `author` no HTML original só casava pelo atributo `name`.
    if (!author && attrs.name && chave === "author") {
      author = valor;
      faltam--;
    }
    if (!published && META_TAGS_CHAVES_DATA.has(chave)) {
      published = valor;
      faltam--;
    }
  }

  return {
    title: title || ogTitle,
    description,
    author,
    published: published.slice(0, 25),
  };
}

/**
 * Extrai o hostname de uma URL, removendo "www." para comparação.
 */
export function hostOf(urlOrHref) {
  try {
    return new URL(urlOrHref).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
