#!/usr/bin/env node
/**
 * _diag-quente.mjs — por que a SEGUNDA leitura de uma página ainda custa ~500 ms
 * com o cache quente.
 *
 * Se o HTML está no cache e as conversões são memoizadas, o que sobra? Este
 * script mede, no mesmo processo depois de aquecido:
 *   1. fetchTextCached        (deve ser ~0)
 *   2. htmlToMarkdown         (memoizado, deve ser ~0)
 *   3. extractEmbeddedData    (a suspeita: roda de novo a cada chamada)
 *   4. toolReadPage completa
 *
 * Uso: node dev/_diag-quente.mjs [url]
 */
const URL_ALVO = process.argv[2] || "https://www.washingtonpost.com/";
const { fetchTextCached } = await import("../src/fetch.mjs");
const { htmlToMarkdown, extractMeta } = await import("../src/html-parser.mjs");
const { toolReadPage } = await import("../src/tools.mjs");

const cron = async (rotulo, fn) => {
  const t0 = performance.now();
  try {
    const r = await fn();
    console.log(`${rotulo.padEnd(40)} ${(performance.now() - t0).toFixed(0).padStart(6)} ms`);
    return r;
  } catch (e) {
    console.log(`${rotulo.padEnd(40)} ${(performance.now() - t0).toFixed(0).padStart(6)} ms  ERRO ${e.message.slice(0, 50)}`);
    return null;
  }
};

// Aquecer tudo uma vez.
await toolReadPage({ url: URL_ALVO, maxChars: 25000, timeoutMs: 120000 });
console.log("--- aquecido, medindo de novo ---");

const payload = await cron("fetchTextCached", () => fetchTextCached(URL_ALVO, { timeoutMs: 120000 }));
await cron("extractMeta", () => extractMeta(payload.text, payload.finalUrl));
await cron("htmlToMarkdown", () => htmlToMarkdown(payload.text, payload.finalUrl));

// isDynamicPage/extractEmbeddedData não são exportadas: medimos o pipeline todo
// e depois o pipeline com API desligada, na mesma condição de cache.
await cron("toolReadPage (cache quente)", () => toolReadPage({ url: URL_ALVO, maxChars: 25000, timeoutMs: 120000 }));

// Quantas chamadas custam só a decisão de "esta página é dinâmica?"
await cron("10x toolReadPage (cache quente)", async () => {
  for (let i = 0; i < 10; i++) {
    await toolReadPage({ url: URL_ALVO, maxChars: 25000, timeoutMs: 120000 });
  }
});
