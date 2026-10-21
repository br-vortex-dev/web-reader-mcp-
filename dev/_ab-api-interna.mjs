#!/usr/bin/env node
/**
 * _ab-api-interna.mjs — quanto o tryInternalApi custa no washingtonpost.
 *
 * O pipeline do washingtonpost gasta ~641 ms NOSSOS com cache quente, e o
 * markdown estático é 0 chars. Quem entrega texto ali é o extractEmbeddedData,
 * que chama tryInternalApi com orçamento de API_TOTAL_BUDGET_MS (1500 ms) e
 * até API_MAX_CANDIDATES (2) candidatos.
 *
 * A /ab mede o MESMO alvo com e sem permissão de bater na API interna, numa
 * ordem alternada para o ruído de rede não cair sempre do mesmo lado.
 *
 * Uso: node dev/_ab-api-interna.mjs [url] [voltas]
 */
const URL_ALVO = process.argv[2] || "https://www.washingtonpost.com/";
const VOLTAS = Math.max(1, Number(process.argv[3] || 3));

/** Roda uma medição em processo filho, para a env valer no import do config. */
async function medirCom(env) {
  const { spawnSync } = await import("node:child_process");
  const script = `
    const t0 = performance.now();
    const { toolReadPage } = await import("./src/tools.mjs");
    const saida = await toolReadPage({ url: ${JSON.stringify(URL_ALVO)}, maxChars: 25000, timeoutMs: 120000 });
    const ms = performance.now() - t0;
    // aquece o cache do processo é impossível aqui; medimos a 2a leitura também
    const t1 = performance.now();
    const saida2 = await toolReadPage({ url: ${JSON.stringify(URL_ALVO)}, maxChars: 25000, timeoutMs: 120000 });
    const ms2 = performance.now() - t1;
    console.log(JSON.stringify({ frio: ms, quente: ms2, chars: saida.length, chars2: saida2.length }));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 300000,
  });
  if (r.status !== 0) return { erro: (r.stderr || "").slice(0, 200) };
  try {
    return JSON.parse(r.stdout.trim().split("\n").pop());
  } catch {
    return { erro: r.stdout.slice(0, 200) };
  }
}

const resultados = { ligado: [], desligado: [] };

for (let v = 1; v <= VOLTAS; v++) {
  // Alterna a ordem: se a rede melhorar/piorar, afeta os dois lados por igual.
  const ordem = v % 2 === 1 ? ["desligado", "ligado"] : ["ligado", "desligado"];
  for (const lado of ordem) {
    const env = lado === "desligado" ? { API_MAX_CANDIDATES: "0" } : { API_MAX_CANDIDATES: "2" };
    const r = await medirCom(env);
    if (r.erro) {
      console.log(`volta ${v} ${lado}: ERRO ${r.erro}`);
      continue;
    }
    resultados[lado].push(r);
    console.log(
      `volta ${v} | api ${lado.padEnd(9)} | 1a leitura ${r.frio.toFixed(0)} ms (${r.chars} chars) | ` +
        `2a leitura ${r.quente.toFixed(0)} ms (${r.chars2} chars)`
    );
  }
}

const mediana = (xs) => {
  if (xs.length === 0) return NaN;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
};

console.log("\n=== RESUMO (mediana) ===");
for (const lado of ["ligado", "desligado"]) {
  const rs = resultados[lado];
  console.log(
    `${lado.padEnd(9)}: 1a ${mediana(rs.map((r) => r.frio)).toFixed(0)} ms | ` +
      `2a ${mediana(rs.map((r) => r.quente)).toFixed(0)} ms`
  );
}
const a = mediana(resultados.ligado.map((r) => r.frio));
const b = mediana(resultados.desligado.map((r) => r.frio));
if (Number.isFinite(a) && Number.isFinite(b)) {
  console.log(`\ncusto do tryInternalApi (1a leitura): ${(a - b).toFixed(0)} ms (${(((a - b) / a) * 100).toFixed(0)}% do total)`);
}
