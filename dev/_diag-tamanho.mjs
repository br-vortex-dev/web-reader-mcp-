#!/usr/bin/env node
/**
 * _diag-tamanho.mjs — quanto markdown a parada antecipada realmente produz?
 *
 * Converte o fixture pesado com as MESMAS opções do read_page e imprime o
 * tamanho do markdown finalizado. O que passa de `maxChars` é trabalho pago
 * e jogado fora na truncagem.
 */
process.env.ALLOW_PRIVATE_HOSTS = "1";

const { startFixture } = await import("../tests/helpers.mjs");
const { fetchTextCached } = await import("../src/fetch.mjs");
const { htmlToMarkdown } = await import("../src/html-parser.mjs");
const { HARD_MAX_CHARS } = await import("../src/config.mjs");

const fixture = await startFixture();
const url = `${fixture.url}/page/pesada?kb=1400&v=1`;

for (let i = 0; i < 3; i++) {
  const payload = await fetchTextCached(url, { timeoutMs: 15000, retries: 0 });
  const diag = { interrompida: false };
  const t0 = performance.now();
  const md = htmlToMarkdown(payload.text, payload.finalUrl, {
    minCharsEntregaveis: HARD_MAX_CHARS,
    diagnostico: diag,
  });
  const t1 = performance.now();
  const completo = i === 0 ? htmlToMarkdown(payload.text, payload.finalUrl, {}) : null;
  const t2 = performance.now();
  console.log(
    `passada ${i}: html ${payload.text.length} | HARD_MAX_CHARS ${HARD_MAX_CHARS} | markdown ${md.length} (interrompida ${diag.interrompida}) | ${(t1 - t0).toFixed(1)} ms` +
      (completo ? ` | completo ${completo.length} chars em ${(t2 - t1).toFixed(1)} ms` : "")
  );
}

await fixture.close?.();
