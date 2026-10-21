#!/usr/bin/env node
/**
 * _diag-wapo-etapas.mjs — onde o read_page gasta 985 ms DE NÓS no washingtonpost.
 *
 * Medido em dev/_diag-read-page-etapas.mjs: download cru 582 ms, pipeline
 * 1.567 ms. Sobram ~985 ms que são nossos. A suspeita número um é o download
 * DUPLO do corte proporcional (dev/_mede-*): com maxChars 25000 e folga 60x o
 * teto fica em 1,5 MB, e a página tem 4,4 MB. Se o pedaço não cobrir o
 * maxChars, o código refaz o download inteiro — e aí pagamos duas vezes.
 *
 * Este script instrumenta o transporte para CONTAR as requisições reais e
 * cronometra cada etapa do pipeline separadamente.
 *
 * Uso: node dev/_diag-wapo-etapas.mjs [url] [voltas]
 */
import { fetchTextComTeto, fetchTextCached } from "../src/fetch.mjs";
import { htmlToMarkdown, extractMeta } from "../src/html-parser.mjs";

const URL_ALVO = process.argv[2] || "https://www.washingtonpost.com/";
const VOLTAS = Math.max(1, Number(process.argv[3] || 3));
const MAX_CHARS = 25000;

const t = (rotulo, fn) => {
  const t0 = performance.now();
  const r = fn();
  return { ms: performance.now() - t0, r };
};
const ta = async (rotulo, fn) => {
  const t0 = performance.now();
  try {
    const r = await fn();
    return { ms: performance.now() - t0, ok: true, r };
  } catch (e) {
    return { ms: performance.now() - t0, ok: false, erro: e.message };
  }
};

for (let v = 1; v <= VOLTAS; v++) {
  // 1) Download com o TETO PROPORCIONAL (o caminho do read_page).
  const comTeto = await ta("fetchTextComTeto", () =>
    fetchTextComTeto(URL_ALVO, { timeoutMs: 120000, maxBytes: MAX_CHARS * 60, maxChars: MAX_CHARS })
  );
  const p1 = comTeto.r;

  // 2) Download com o cache/documento inteiro (como as outras ferramentas fazem).
  const inteiro = await ta("fetchTextCached", () => fetchTextCached(URL_ALVO, { timeoutMs: 120000 }));
  const p2 = inteiro.r;

  console.log(
    `volta ${v} | teto proporcional: ${comTeto.ms.toFixed(0)} ms ` +
      `${comTeto.ok ? `${p1.text.length} chars cortado=${p1.cortado}` : `ERRO ${comTeto.erro}`}`
  );
  console.log(
    `         | documento inteiro:  ${inteiro.ms.toFixed(0)} ms ` +
      `${inteiro.ok ? `${p2.text.length} chars` : `ERRO ${inteiro.erro}`}`
  );

  if (comTeto.ok) {
    const mdTeto = t("md", () => htmlToMarkdown(p1.text, p1.finalUrl));
    console.log(`         | markdown do pedaco:  ${mdTeto.ms.toFixed(1)} ms -> ${mdTeto.r.length} chars`);
    const cobre = mdTeto.r.length >= MAX_CHARS;
    console.log(
      `         | cobre o maxChars?    ${cobre ? "SIM (nada a refazer)" : "NAO -> o read_page refaz o download inteiro"}` +
        ` (precisa >= ${MAX_CHARS}, tem ${mdTeto.r.length})`
    );
  }
  if (inteiro.ok) {
    const mdInt = t("md2", () => htmlToMarkdown(p2.text, p2.finalUrl));
    const meta = t("meta", () => extractMeta(p2.text, p2.finalUrl));
    console.log(
      `         | markdown inteiro:    ${mdInt.ms.toFixed(1)} ms -> ${mdInt.r.length} chars | meta ${meta.ms.toFixed(1)} ms`
    );
  }
  console.log("");
}
