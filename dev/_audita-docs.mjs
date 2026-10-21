#!/usr/bin/env node
/**
 * _audita-docs.mjs — confere se o README bate com o código.
 *
 * Compara três coisas que envelhecem sozinhas quando o projeto muda:
 *   1. variáveis de ambiente lidas em src/ x tabela do README;
 *   2. contagem de ferramentas em TOOLS x o que o README anuncia;
 *   3. contagem de arquivos de teste x o número escrito no README.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const raiz = path.resolve(import.meta.dirname, "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8");

const readme = ler("README.md");

// ---------- 1. variáveis de ambiente ----------
const fontes = fs
  .readdirSync(path.join(raiz, "src"))
  .filter((f) => f.endsWith(".mjs"));

const envsCodigo = new Set();
for (const f of fontes) {
  const txt = fs.readFileSync(path.join(raiz, "src", f), "utf8");
  for (const m of txt.matchAll(/process\.env\.([A-Z0-9_]+)/g)) envsCodigo.add(m[1]);
}

const envsDoc = new Set(
  [...readme.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|/gm)].map((m) => m[1]),
);

const semDoc = [...envsCodigo].filter((e) => !envsDoc.has(e)).sort();
const fantasma = [...envsDoc].filter((e) => !envsCodigo.has(e)).sort();

// ---------- 2. ferramentas ----------
const { TOOLS } = await import(
  pathToFileURL(path.join(raiz, "src", "tool-schemas.mjs")).href
);
const totalFerramentas = TOOLS.length;
const citadoFerramentas = [...readme.matchAll(/(\d+)\s+ferramentas/g)].map((m) =>
  Number(m[1]),
);
const erradoFerramentas = [...new Set(citadoFerramentas)].filter(
  (n) => n !== totalFerramentas,
);

// ---------- 3. testes ----------
const arquivosTeste = fs
  .readdirSync(path.join(raiz, "tests"))
  .filter((f) => f.endsWith(".test.mjs"));

const citadoArquivos = [...readme.matchAll(/(\d+)\s+arquivos de teste/g)].map((m) =>
  Number(m[1]),
);
const citadoTestes = [...readme.matchAll(/(\d+)\s+testes/g)].map((m) => Number(m[1]));

console.log("=== VARIÁVEIS DE AMBIENTE ===");
console.log(`código: ${envsCodigo.size} | README: ${envsDoc.size}`);
console.log(`no código e SEM documentação (${semDoc.length}): ${semDoc.join(", ") || "nenhuma"}`);
console.log(`na doc e SEM uso no código (${fantasma.length}): ${fantasma.join(", ") || "nenhuma"}`);

console.log("\n=== FERRAMENTAS ===");
console.log(`TOOLS real: ${totalFerramentas}`);
console.log(`números citados no README: ${[...new Set(citadoFerramentas)].join(", ") || "nenhum"}`);
console.log(`divergentes: ${erradoFerramentas.join(", ") || "nenhum"}`);
console.log(`nomes: ${TOOLS.map((t) => t.name).join(", ")}`);

console.log("\n=== TESTES ===");
console.log(`arquivos .test.mjs reais: ${arquivosTeste.length}`);
console.log(`"N arquivos de teste" citado: ${[...new Set(citadoArquivos)].join(", ") || "nenhum"}`);
console.log(`"N testes" citado: ${[...new Set(citadoTestes)].join(", ") || "nenhum"}`);
