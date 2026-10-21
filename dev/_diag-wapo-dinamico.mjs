#!/usr/bin/env node
/**
 * _diag-wapo-dinamico.mjs — o custo que sobra no read_page do washingtonpost.
 *
 * O markdown ESTÁTICO dessa página é 0 chars: o texto vem de
 * extractEmbeddedData (JSON embutido / API interna). E o pipeline paga dois
 * downloads (teto proporcional + inteiro) porque 0 < maxChars.
 *
 * Aqui cada etapa é cronometrada no HTML já baixado, para separar:
 *   a) o download duplo  -> dá para evitar quando o corte não tem como ajudar?
 *   b) a extração embutida (que pode disparar requisições extras via
 *      tryInternalApi)
 *
 * Uso: node dev/_diag-wapo-dinamico.mjs [url]
 */
const { fetchTextCached } = await import("../src/fetch.mjs");
const { htmlToMarkdown, extractMeta } = await import("../src/html-parser.mjs");
const { toolReadPage } = await import("../src/tools.mjs");

const URL_ALVO = process.argv[2] || "https://www.washingtonpost.com/";

const cron = async (rotulo, fn) => {
  const t0 = performance.now();
  try {
    const r = await fn();
    const ms = performance.now() - t0;
    const tamanho =
      typeof r === "string" ? `${r.length} chars` : r && typeof r === "object" ? "objeto" : String(r);
    console.log(`${rotulo.padEnd(46)} ${ms.toFixed(0).padStart(6)} ms   ${tamanho}`);
    return r;
  } catch (e) {
    const ms = performance.now() - t0;
    console.log(`${rotulo.padEnd(46)} ${ms.toFixed(0).padStart(6)} ms   ERRO: ${e.message.slice(0, 60)}`);
    return null;
  }
};

// 1) Download inteiro (cache do processo já aquecido pela chamada real abaixo).
const payload = await cron("fetchTextCached (documento inteiro)", () =>
  fetchTextCached(URL_ALVO, { timeoutMs: 120000 })
);
if (!payload) process.exit(1);

console.log(`HTML: ${payload.text.length} chars | ratio de tag ${((payload.text.match(/</g) || []).length / payload.text.length * 100).toFixed(1)}%\n`);

// 2) As etapas internas, no MESMO html.
await cron("extractMeta", () => extractMeta(payload.text, payload.finalUrl));
const md = await cron("htmlToMarkdown (estático)", () => htmlToMarkdown(payload.text, payload.finalUrl));
console.log(`   -> markdown estático tem ${md ? md.replace(/\s+/g, " ").trim().length : 0} chars ÚTEIS\n`);

// 3) A extração embutida, que é quem entrega o texto aqui.
const { extractEmbeddedData } = await import("../src/tools.mjs").catch(() => ({}));
if (extractEmbeddedData) {
  const emb = await cron("extractEmbeddedData (JSON/API interna)", () =>
    extractEmbeddedData(payload.text, payload.finalUrl, 120000)
  );
  console.log(`   -> ${emb ? emb.length : 0} chars extraídos do conteúdo embutido\n`);
} else {
  console.log("extractEmbeddedData não é exportada — medindo pelo pipeline completo.\n");
}

// 4) O pipeline real, agora com cache quente (é o que o cliente paga depois da 1a).
await cron("toolReadPage (cache quente)", () => toolReadPage({ url: URL_ALVO, maxChars: 25000, timeoutMs: 120000 }));
