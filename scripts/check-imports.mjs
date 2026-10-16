// check-imports.mjs — acha imports de modulo local que nao sao usados no corpo.
// Uso: node scripts/check-imports.mjs
import fs from "node:fs";
import path from "node:path";

const arquivos = process.argv.slice(2);
const raiz = process.cwd();

for (const rel of arquivos) {
  const full = path.join(raiz, rel);
  const src = fs.readFileSync(full, "utf8");
  const nomes = [];
  const re = /import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[3].startsWith(".")) {
      if (m[1]) {
        for (const parte of m[1].split(",")) {
          const t = parte.trim().split(/\s+as\s+/).pop().trim();
          if (t) nomes.push(t);
        }
      } else if (m[2]) {
        nomes.push(m[2]);
      }
    }
  }
  const corpo = src.replace(/import[^;]*;/g, "");
  const mortos = nomes.filter((n) => {
    const c = corpo.split(new RegExp(`\\b${n.replace(/[$]/g, "\\$")}\\b`, "g")).length - 1;
    return c === 0;
  });
  if (mortos.length) console.log(`${rel}: ${mortos.join(", ")}`);
}
console.log("fim");
