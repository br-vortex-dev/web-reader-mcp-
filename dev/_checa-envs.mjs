#!/usr/bin/env node
/**
 * _checa-envs.mjs — para cada nome de variável, diz onde ele aparece em src/.
 *
 * Existe porque o findstr do Windows com /S e curinga mentiu (não achou nomes
 * que existem). Aqui a busca é em JS, arquivo por arquivo, com a linha exata.
 */
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const nomes = [
  "AGENT_CACHE_MAX",
  "HARD_MAX_CHARS",
  "HOST_CHECK_TTL_MS",
  "MAX_PAGES_PER_CALL",
  "RETRY_AFTER_MAX_MS",
  "ROBOTS_MAX_BYTES",
  "ROBOTS_MAX_ORIGINS",
  "DNS_TIMEOUT_MS",
];

const arquivos = fs
  .readdirSync(path.join(raiz, "src"))
  .filter((f) => f.endsWith(".mjs"));

for (const nome of nomes) {
  const achados = [];
  for (const f of arquivos) {
    const linhas = fs.readFileSync(path.join(raiz, "src", f), "utf8").split("\n");
    linhas.forEach((l, i) => {
      if (l.includes(nome)) achados.push(`${f}:${i + 1}: ${l.trim().slice(0, 110)}`);
    });
  }
  console.log(`\n=== ${nome} (${achados.length}) ===`);
  console.log(achados.length ? achados.join("\n") : "NAO APARECE EM src/");
}
