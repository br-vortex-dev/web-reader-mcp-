#!/usr/bin/env node
// Debug: testa htmlToMarkdown com HTML real do Google

const html = `<!DOCTYPE html>
<html>
<head>
  <title>Google</title>
  <script>var x = 1;</script>
</head>
<body>
  <div id="main">
    <h1>Google</h1>
    <p>Bem-vindo ao Google.</p>
  </div>
</body>
</html>`;

// Copia as funções do server.js
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "canvas", "iframe",
  "object", "audio", "video", "nav", "header", "footer", "aside", "form",
  "head", "select", "button",
]);

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
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
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

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

const result = htmlToMarkdown(html, "https://example.com");
console.log("Resultado:");
console.log(JSON.stringify(result));
console.log("\nTamanho:", result.length);
