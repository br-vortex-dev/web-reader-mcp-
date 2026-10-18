#!/usr/bin/env node
/**
 * _espera-versao.mjs — espera o deploy do Render publicar a versão nova.
 *
 * Faz polling no /health público até encontrar a versão pedida (ou estourar
 * o prazo). Uso: node dev/_espera-versao.mjs [versao] [minutos]
 */
const versao = process.argv[2] || "1.2.0";
const minutos = Number(process.argv[3]) || 6;
const base = "https://web-reader-mcp-13z0.onrender.com";
const limite = Date.now() + minutos * 60 * 1000;

console.log(`esperando v${versao} em ${base}/health (até ${minutos} min)...`);
let tentativa = 0;
while (Date.now() < limite) {
  tentativa++;
  const t0 = Date.now();
  try {
    const res = await fetch(base + "/health", { signal: AbortSignal.timeout(60000) });
    const texto = await res.text();
    const atual = (texto.match(/v([\d.]+)/) || [])[1] || "?";
    console.log(`[${tentativa}] ${Date.now() - t0} ms | HTTP ${res.status} | v${atual} | ${texto.slice(0, 90)}`);
    if (atual === versao) {
      console.log(`\nOK: v${versao} no ar.`);
      process.exit(0);
    }
  } catch (err) {
    console.log(`[${tentativa}] falha: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 15000));
}
console.log(`\nTEMPO ESGOTADO: v${versao} não apareceu em ${minutos} min.`);
process.exit(1);
