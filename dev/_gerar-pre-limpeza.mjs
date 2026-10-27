#!/usr/bin/env node
/**
 * _gerar-pre-limpeza.mjs — gera dev/_pre-limpeza.mjs: cópia do parser atual com
 * a limpeza final ANTIGA (sem os atalhos por gatilho) e a paridade de cercas
 * por `match`. Serve só para isolar o ganho da limpeza protegida.
 */
import { readFileSync, writeFileSync } from "node:fs";

let src = readFileSync(new URL("../src/html-parser.mjs", import.meta.url), "utf8");

function troca(novo, velho) {
  if (!src.includes(novo)) {
    console.error("NÃO ENCONTRADO:\n" + novo.slice(0, 160));
    process.exit(1);
  }
  src = src.replace(novo, velho);
}

troca(
  `function cleanMarkdown(text) {
  const blocks = [];
  let normalized = String(text);
  // Cada replace abaixo só é chamado quando o texto tem o gatilho que ele
  // procura — sem isso, páginas sem cerca/tab/CRLF pagavam a varredura inteira
  // em vão. A ordem e a semântica são as mesmas da cadeia original.
  if (normalized.indexOf("\\r") !== -1) normalized = normalized.replace(/\\r\\n?/g, "\\n");

  let masked = normalized;
  if (masked.indexOf("\`\`\`") !== -1) {
    masked = masked.replace(/\`\`\`[\\s\\S]*?\`\`\`/g, (match) => \`\\u0000\${blocks.push(match) - 1}\\u0000\`);
  }

  let cleaned = masked;
  if (cleaned.indexOf("\\t") !== -1 || cleaned.indexOf(" \\n") !== -1) {
    cleaned = cleaned.replace(/[ \\t]+\\n/g, "\\n");
  }
  if (cleaned.indexOf("\\t") !== -1 || cleaned.indexOf("  ") !== -1) {
    cleaned = cleaned.replace(/[ \\t]{2,}/g, " ");
  }
  if (cleaned.indexOf("\\n\\n\\n") !== -1) cleaned = cleaned.replace(/\\n{3,}/g, "\\n\\n");
  cleaned = cleaned.trim();

  if (cleaned.indexOf("\\u0000") !== -1) {
    cleaned = cleaned.replace(/\\u0000(\\d+)\\u0000/g, (_, index) => blocks[Number(index)]);
  }
  return cleaned;
}`,
  `function cleanMarkdown(text) {
  const blocks = [];
  const normalized = String(text).replace(/\\r\\n?/g, "\\n");
  const masked = normalized.replace(/\`\`\`[\\s\\S]*?\`\`\`/g, (match) => \`\\u0000\${blocks.push(match) - 1}\\u0000\`);
  const cleaned = masked
    .replace(/[ \\t]+\\n/g, "\\n")
    .replace(/[ \\t]{2,}/g, " ")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();
  return cleaned.replace(/\\u0000(\\d+)\\u0000/g, (_, index) => blocks[Number(index)]);
}`
);

troca(
  `function polirTexto(texto) {
  let resultado = texto;
  if (resultado.indexOf("[") !== -1) {
    resultado = resultado
      .replace(/\\[\\s*\\]/g, "")
      .replace(/\\[\\s*\\n\\s*\\]/g, "")
      .replace(/\\[\\s*\\|\\s*\\]/g, "");
  }
  if (resultado.charCodeAt(0) === 91) {
    resultado = resultado
      .replace(/^\\[Skip to content\\]\\([^)]*\\)\\n*/i, "")
      .replace(/^\\[Minha [^\\]]+\\]\\([^)]*\\)\\n*/i, "");
  }
  if (resultado.indexOf("?utm_") !== -1) resultado = resultado.replace(/\\?utm_[^)\\s]*/g, "");
  return resultado;
}`,
  `function polirTexto(texto) {
  let resultado = texto
    .replace(/\\[\\s*\\]/g, "")
    .replace(/\\[\\s*\\n\\s*\\]/g, "")
    .replace(/\\[\\s*\\|\\s*\\]/g, "");
  resultado = resultado
    .replace(/^\\[Skip to content\\]\\([^)]*\\)\\n*/i, "")
    .replace(/^\\[Minha [^\\]]+\\]\\([^)]*\\)\\n*/i, "")
    .replace(/\\?utm_[^)\\s]*/g, "");
  return resultado;
}`
);

troca(
  `  // Mesma paridade de \`(bruto.match(/\`\`\`/g) || []).length % 2\`, sem alocar
  // um array com uma entrada por cerca da página.
  let cercas = 0;
  for (let pos = bruto.indexOf("\`\`\`"); pos !== -1; pos = bruto.indexOf("\`\`\`", pos + 3)) cercas++;
  if (cercas % 2 !== 0) return null;`,
  `  const cercasPareadas = (bruto.match(/\`\`\`/g) || []).length % 2 === 0;
  if (!cercasPareadas) return null;`
);

writeFileSync(new URL("./_pre-limpeza.mjs", import.meta.url), src);
console.log("gerado dev/_pre-limpeza.mjs");
