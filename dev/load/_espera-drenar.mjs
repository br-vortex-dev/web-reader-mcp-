#!/usr/bin/env node
// _espera-drenar.mjs - espera o servidor remoto voltar ao repouso
// (requisicoes ativas baixas, fila zero) antes da proxima fase da prova.
//
// Uso: node dev/load/_espera-drenar.mjs [maxSegundos]

const BASE = process.env.PROBE_URL || "https://web-reader-mcp-13z0.onrender.com";
const MAX_S = Math.max(30, Number(process.argv[2] || 300));
const t0 = Date.now();

for (;;) {
  let texto = "";
  try {
    const res = await fetch(BASE + "/health", { signal: AbortSignal.timeout(20000) });
    texto = await res.text();
  } catch (e) {
    texto = "erro: " + e.message;
  }
  const g = (re) => {
    const m = texto.match(re);
    return m ? Number(m[1]) : NaN;
  };
  const ativas = g(/requisicoes: (\d+) ativas/);
  const fila = g(/requisicoes: \d+ ativas, (\d+) na fila/);
  const recusadas = g(/recusadas (\d+)\)/);
  const drenado = ativas <= 4 && fila === 0;
  console.log(
    `[${Math.round((Date.now() - t0) / 1000)}s] ativas=${ativas} fila=${fila} recusadas=${recusadas}${drenado ? "  -> DRENADO" : ""}`
  );
  if (drenado) break;
  if ((Date.now() - t0) / 1000 > MAX_S) {
    console.log("teto de espera atingido - seguindo mesmo assim");
    break;
  }
  await new Promise((r) => setTimeout(r, 10000));
}
