#!/usr/bin/env node
/**
 * _diag-read-page-etapas.mjs — no read_page lento, quem gasta: a rede ou nós?
 *
 * Dois alvos da bateria passavam de 3 s (nodejs all.html 3.091 ms,
 * washingtonpost 3.712 ms). Aqui cada alvo é medido duas vezes no MESMO
 * processo e na MESMA rede:
 *
 *   1. download cru (fetch global, sem SSRF/robots/cache) — o piso imposto
 *      pelo site;
 *   2. toolReadPage de verdade (o pipeline que o cliente MCP chama).
 *
 * A diferença entre os dois é o NOSSO custo. Se ela for pequena, o gargalo é
 * o alvo e não há código a corrigir.
 *
 * Uso: node dev/_diag-read-page-etapas.mjs
 */
const { toolReadPage } = await import("../src/tools.mjs");

const ALVOS = [
  ["nodejs all.html (~8MB)", "https://nodejs.org/api/all.html"],
  ["washingtonpost", "https://www.washingtonpost.com/"],
  ["python docs index", "https://docs.python.org/3/"],
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Download cru, sem nada do projeto. Devolve ms e bytes. */
async function cru(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-encoding": "gzip, br" },
      signal: AbortSignal.timeout(120000),
      redirect: "follow",
    });
    const buf = await res.arrayBuffer();
    return { ms: performance.now() - t0, status: res.status, bytes: buf.byteLength };
  } catch (e) {
    return { ms: performance.now() - t0, erro: e.message };
  }
}

console.log("alvo                          cru ms   bytes      pipeline ms  chars  veredito");
console.log("-----------------------------------------------------------------------------------");

for (const [nome, url] of ALVOS) {
  const c = await cru(url);

  const t0 = performance.now();
  let saida = "";
  let erro = "";
  try {
    saida = await toolReadPage({ url, maxChars: 25000, timeoutMs: 120000 });
  } catch (e) {
    erro = e.message;
  }
  const pMs = performance.now() - t0;

  const nosso = c.ms > 0 && pMs > 0 ? pMs - c.ms : 0;
  const veredito = erro
    ? `ERRO: ${erro.slice(0, 40)}`
    : nosso < c.ms
      ? "alvo manda"
      : "NOSSO custo domina";

  console.log(
    `${nome.padEnd(28)} ${String(c.ms?.toFixed(0) ?? "-").padStart(7)} ` +
      `${String(c.bytes ?? "-").padStart(10)}  ${pMs.toFixed(0).padStart(9)} ` +
      `${String(erro ? "-" : saida.length).padStart(7)}  ${veredito}`
  );
  if (!erro) console.log(`   -> custo nosso: ${nosso.toFixed(0)} ms (${((nosso / pMs) * 100).toFixed(0)}% do total)`);
}
