// check-imports.mjs — dois lints de import, sem dependencias:
//   1. todo import relativo aponta para um arquivo que EXISTE;
//   2. nenhum nome importado fica sem uso no corpo do arquivo.
//
// Uso:
//   node scripts/check-imports.mjs            -> confere server.js + src/*.mjs
//   node scripts/check-imports.mjs src/x.mjs  -> confere so os arquivos dados
//
// Sai com codigo 1 quando acha problema: o CI depende disso para falhar de
// verdade (antes era chamado sem argumento e nao conferia nada).
import fs from "node:fs";
import path from "node:path";

const raiz = process.cwd();

function listarPadrao() {
  const arquivos = ["server.js"];
  for (const nome of fs.readdirSync(path.join(raiz, "src")).sort()) {
    if (nome.endsWith(".mjs")) arquivos.push(path.join("src", nome));
  }
  return arquivos;
}

const arquivos = process.argv.slice(2).length ? process.argv.slice(2) : listarPadrao();
let problemas = 0;

function resolver(spec, deArquivo) {
  const base = path.resolve(path.dirname(deArquivo), spec);
  for (const candidato of [base, `${base}.mjs`, `${base}.js`, path.join(base, "index.mjs")]) {
    if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return candidato;
  }
  return null;
}

for (const rel of arquivos) {
  const full = path.join(raiz, rel);
  const src = fs.readFileSync(full, "utf8");

  // 1. Arquivos que o import aponta (inclusive `import "./x.mjs"` sem nomes).
  const specs = [];
  const reTodos = /(?:from\s+|import\s*)["']([^"']+)["']/g;
  let t;
  while ((t = reTodos.exec(src)) !== null) {
    const spec = t[1];
    if (spec.startsWith(".")) specs.push(spec);
  }
  for (const spec of specs) {
    if (!resolver(spec, full)) {
      console.log(`${rel}: import aponta para arquivo inexistente -> ${spec}`);
      problemas++;
    }
  }

  // 2. Nomes importados sem uso no corpo (heuristica por palavra inteira).
  const nomes = [];
  const reNomes = /import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = reNomes.exec(src)) !== null) {
    if (!m[3].startsWith(".")) continue;
    if (m[1]) {
      for (const parte of m[1].split(",")) {
        const nome = parte.trim().split(/\s+as\s+/).pop().trim();
        if (nome) nomes.push(nome);
      }
    } else if (m[2]) {
      nomes.push(m[2]);
    }
  }
  // So remove import de verdade (linha comecando em `import`), nunca a palavra
  // "importante" num comentario — a versao antiga cortava ate o proximo `;` e
  // escondia usos reais.
  const corpo = src.replace(/^import\b[^;]*;/gm, "");
  const mortos = nomes.filter((n) => {
    const usos = corpo.split(new RegExp(`\\b${n.replace(/[$]/g, "\\$")}\\b`, "g")).length - 1;
    return usos === 0;
  });
  if (mortos.length) {
    console.log(`${rel}: importado e nao usado -> ${mortos.join(", ")}`);
    problemas++;
  }
}

console.log(problemas ? `${problemas} problema(s) de import` : `imports ok (${arquivos.length} arquivo(s))`);
if (problemas) process.exitCode = 1;
