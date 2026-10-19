/**
 * Parser HTML → markdown feito à mão (tokenizer + regras de emissão).
 * Trata tags void, skip, tabelas GFM, deduplicação de código e limpeza de artefatos.
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

/**
 * Decodifica entidades HTML (&amp;, &lt;, &#123;, etc.) para texto puro.
 */
export function decodeEntities(input) {
  if (!input || input.indexOf("&") === -1) return input;
  return input.replace(
    /&(#[Xx][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g,
    (match, body) => {
      if (body[0] === "#") {
        const isHex = body[1] === "x" || body[1] === "X";
        const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
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

/**
 * Encontra o ">" que fecha uma tag, respeitando atributos entre aspas.
 */
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

/**
 * Extrai atributos de uma tag HTML.
 */
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

/* ===================================================================== *
 * Texto cru: script e style                                                *
 *                                                                          *
 * Em <script> e <style> o conteúdo NÃO é markup (são raw text elements da  *
 * spec do HTML): não existe tag nenhuma lá dentro para tokenizar. Mesmo     *
 * assim o tokenizador varria o miolo inteiro procurando "<" e parseando os  *
 * "atributos" do que achasse — numa página com JavaScript inline isso é     *
 * metade dos bytes e custava 17,8% da CPU do parser (medido em              *
 * dev/_perfil.mjs sobre 1,34 MB). Aqui o miolo é saltado de uma vez.       *
 *                                                                          *
 * As duas tags estão em SKIP_TAGS, então o conteúdo já não saía na leitura: *
 * saltar não muda UM caractere da saída. O token de abertura e o de         *
 * fechamento continuam sendo emitidos, para que a contagem de profundidade  *
 * (skipDepth) fique idêntica à de antes.                                   *
 * ===================================================================== */

const RAW_TEXT_TAGS = new Set(["script", "style"]);

// RegExp de fechamento por tag, reaproveitada entre chamadas (`lastIndex` é
// ajustado a cada uso). Precisa ser case-insensitive: HTML aceita <SCRIPT>.
const RAW_FECHAMENTO = new Map();
function fechamentoDe(tag) {
  let re = RAW_FECHAMENTO.get(tag);
  if (!re) {
    re = new RegExp("</" + tag, "gi");
    RAW_FECHAMENTO.set(tag, re);
  }
  return re;
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
    const startsTag =
      nextChar === "/" ||
      nextChar === "!" ||
      nextChar === "?" ||
      (nextChar !== undefined && /[A-Za-z]/.test(nextChar));
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
      yield { type: "close", tag };
    } else {
      yield { type: "open", tag, selfClosing, attrs: parseAttrs(body.slice(nameMatch[0].length)) };
      // <script>/<style>: o miolo é texto cru, não markup. Salta de uma vez até
      // o fechamento em vez de tokenizar centenas de tags que seriam
      // descartadas de qualquer forma (ver RAW_TEXT_TAGS acima).
      if (!selfClosing && RAW_TEXT_TAGS.has(tag)) {
        const re = fechamentoDe(tag);
        re.lastIndex = i;
        const achou = re.exec(html);
        if (achou) {
          const gtFim = html.indexOf(">", achou.index);
          i = gtFim === -1 ? html.length : gtFim + 1;
          yield { type: "close", tag };
        } else {
          // Sem fechamento: o resto do documento é o miolo. Um open sozinho
          // manteria skipDepth em 1 até o fim — idêntico ao que acontecia antes.
          i = html.length;
        }
      }
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
  const st = criarEstadoConversao();
  const emit = (chunk) => st.emit(chunk);
  const minimo = Number(opcoes.minCharsEntregaveis) > 0 ? Math.floor(opcoes.minCharsEntregaveis) : 0;
  const diagnostico = opcoes.diagnostico || null;
  let paradaAtiva = minimo > 0;
  let limiar = minimo + MARGEM_COMPRESSAO;
  let reChecagens = 0;

  for (const token of tokenize(html)) {
    if (paradaAtiva && st.outLen >= limiar && fronteiraSegura(st)) {
      // A limpeza final (máscara de cercas + polimento) só é fiel ao prefixo
      // completo se as cercas "```" estiverem TODAS emparelhadas no buffer:
      // com uma cerca ímpar, a máscara da limpeza mudaria de comportamento
      // dentro do trecho exibido. Paridade par = mascaramento idêntico.
      const bruto = materializar(st);
      const cercasPareadas = (bruto.match(/```/g) || []).length % 2 === 0;
      if (cercasPareadas) {
        const limpo = polirTexto(cleanMarkdown(bruto));
        if (limpo.length >= minimo + MARGEM_SEGURANCA) {
          if (diagnostico) diagnostico.interrompida = true;
          return finalizarConversao(st);
        }
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

  return finalizarConversao(st);
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
export function extractMeta(html) {
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
