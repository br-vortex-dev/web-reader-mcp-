// Auditoria de exports orfaos: quais simbolos de src/ nenhum outro arquivo
// menciona? Uso: node scripts/auditoria-exports.mjs
//
// Nao e prova de codigo morto (um export pode ser API publica do modulo),
// e sim um mapa de onde olhar. Export usado por namespace (import * as X)
// aparece como referencia por nome, entao entra como vivo.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Roda da raiz do projeto (npm script / `node dev/...` a partir dela).
const RAIZ = process.cwd();
const DIRS = ["src", "scripts", "tests", "dev"];
const EXTRA = ["server.js"];

function listar(dir) {
  const saida = [];
  let itens;
  try {
    itens = readdirSync(join(RAIZ, dir), { withFileTypes: true });
  } catch {
    return saida;
  }
  for (const it of itens) {
    const rel = join(dir, it.name);
    if (it.isDirectory()) saida.push(...listar(rel));
    else if (it.name.endsWith(".mjs") || it.name.endsWith(".js")) saida.push(rel);
  }
  return saida;
}

const arquivos = [...DIRS.flatMap(listar), ...EXTRA];
const conteudo = new Map();
for (const arq of arquivos) {
  try {
    conteudo.set(arq, readFileSync(join(RAIZ, arq), "utf8"));
  } catch {
    /* arquivo ilegivel: ignora */
  }
}

if (conteudo.size === 0) {
  console.error(`nenhum arquivo lido a partir de ${RAIZ} — rode da raiz do projeto`);
  process.exit(1);
}

const declaracao = /^\s*export\s+(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm;
const orfaos = [];
let total = 0;

for (const [arq, texto] of conteudo) {
  if (!arq.startsWith("src")) continue;
  for (const m of texto.matchAll(declaracao)) {
    const nome = m[1];
    total++;
    let usado = 0;
    for (const [outroArq, outroTexto] of conteudo) {
      if (outroArq === arq) continue;
      // palavra inteira, para nao casar MAX_REDIRECTS com OUTRO_MAX_REDIRECTS
      const re = new RegExp(`(^|[^\\w$])${nome.replace(/[$]/g, "\\$")}([^\\w$]|$)`, "m");
      if (re.test(outroTexto)) usado++;
    }
    if (usado === 0) orfaos.push({ arq, nome });
  }
}

console.log(`exports declarados em src/: ${total}`);
console.log(`sem nenhuma referencia fora do proprio arquivo: ${orfaos.length}`);
for (const o of orfaos) console.log(`  ${o.arq}: ${o.nome}`);
