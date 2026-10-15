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
function decodeEntities(input) {
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

/**
 * Divide o HTML em uma lista de tokens.
 */
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
    if (html.startsWith("<![CDATA[", lt)) {
      const end = html.indexOf("]]>", lt + 9);
      const inner = end === -1 ? html.slice(lt + 9) : html.slice(lt + 9, end);
      tokens.push({ type: "text", value: inner, raw: true });
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

/**
 * Converte o HTML em markdown enxuto.
 */
export function htmlToMarkdown(html, baseUrl) {
  let out = "";
  let skipDepth = 0;
  let preDepth = 0;
  const openStack = [];
  const aStack = [];
  const ariaHiddenStack = [];

  let tableDepth = 0;
  let tableRows = [];
  let tableRow = null;
  let tableCell = null;

  let ultimoBlocoCodigo = null;

  const emit = (chunk) => {
    if (tableCell) tableCell.text += chunk;
    else out += chunk;
  };

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
      let decoded = token.raw ? token.value : decodeEntities(token.value);
      if (preDepth === 0) {
        decoded = decoded
          .replace(/\[editar[^\]]*\]/g, "")
          .replace(/¶/g, "")
          .replace(/\s+/g, " ");
      }
      if (!decoded) continue;
      emit(decoded);
      continue;
    }

    if (token.type === "open") {
      const escondido = Boolean(token.attrs && token.attrs["aria-hidden"] === "true");
      if (isSkipped || escondido) {
        if (token.selfClosing) continue;
        skipDepth++;
        if (escondido) ariaHiddenStack.push(token.tag);
        continue;
      }
      if (skipDepth > 0) continue;
      if (preDepth > 0 && PRE_SILENCE_TAGS.has(token.tag)) continue;
      if (!token.selfClosing) openStack.push(token.tag);
      switch (token.tag) {
        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
          if (aStack.length > 0) {
            const href = aStack.pop();
            if (href) emit(`](${href})`);
            emit("\n\n");
          }
          emit("\n\n" + "#".repeat(Number(token.tag[1])) + " ");
          break;
        }
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
        case "table":
          if (tableDepth === 0) {
            tableRows = [];
            tableRow = null;
            tableCell = null;
          }
          tableDepth++;
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
          emit(tableCell ? " " : "\n");
          break;
        case "hr":
          emit("\n\n---\n\n");
          break;
        case "img": {
          const src = resolveUrl(token.attrs.src, baseUrl);
          const alt = (token.attrs.alt || "").trim();
          if (src) {
            const altLimitado = alt.length > 200 ? alt.slice(0, 200) + "…" : alt;
            emit(`![${altLimitado}](${src})`);
          }
          break;
        }
        default:
          break;
      }
      continue;
    }

    // token.type === "close"
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
    if (preDepth > 0 && PRE_SILENCE_TAGS.has(token.tag)) continue;
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
      case "pre": {
        if (preDepth > 0) preDepth--;
        if (!tableCell) out = out.replace(/\n+$/, "");
        const blocoAtual = out.slice(out.lastIndexOf("```\n") + 4);
        if (blocoAtual === ultimoBlocoCodigo && blocoAtual.length > 0) {
          out = out.slice(0, out.lastIndexOf("```\n"));
          ultimoBlocoCodigo = null;
        } else {
          ultimoBlocoCodigo = blocoAtual;
        }
        emit("\n```\n\n");
        break;
      }
      default:
        break;
    }
  }

  if (tableDepth > 0) out += renderTable(tableRows);

  let resultado = cleanMarkdown(out);
  resultado = resultado
    .replace(/\[\s*\]/g, "")
    .replace(/\[\s*\n\s*\]/g, "")
    .replace(/\[\s*\|\s*\]/g, "");
  resultado = resultado
    .replace(/^\[Skip to content\]\([^)]*\)\n*/i, "")
    .replace(/^\[Minha [^\]]+\]\([^)]*\)\n*/i, "")
    .replace(/\?utm_[^)\s]*/g, "");
  return resultado;
}

/**
 * Extrai todos os links de uma página HTML.
 */
export function extractLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const baseHost = hostOf(baseUrl);
  let skipDepth = 0;
  let current = null;

  for (const token of tokenize(html)) {
    const isSkipped = SKIP_TAGS.has(token.tag);

    if (token.type === "open") {
      if (isSkipped) {
        if (!token.selfClosing) skipDepth++;
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
