#!/usr/bin/env node
// Debug: testa o tokenizer com HTML real

const html = `<!DOCTYPE html>
<html>
<head>
  <title>Teste</title>
  <script>var x = 1;</script>
  <style>body { color: red; }</style>
</head>
<body>
  <h1>Título</h1>
  <p>Parágrafo com <a href="/link">link</a>.</p>
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

const tokens = tokenize(html);
console.log("Tokens:", tokens.length);
for (const t of tokens) {
  if (t.type === "open") {
    console.log(`OPEN: ${t.tag} (skip: ${SKIP_TAGS.has(t.tag)})`);
  } else if (t.type === "close") {
    console.log(`CLOSE: ${t.tag} (skip: ${SKIP_TAGS.has(t.tag)})`);
  } else {
    console.log(`TEXT: "${t.value.slice(0, 50)}..."`);
  }
}
