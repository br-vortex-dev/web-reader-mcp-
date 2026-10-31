#!/usr/bin/env node
/**
 * _diag-wapo-etapas.mjs — quanto o read_page baixa e converte no washingtonpost.
 *
 * O desenho antigo era em duas etapas (baixava o pedaço apertado, convertia e,
 * se não cobrisse o pedido, refazia o download inteiro). Agora o teto apertado
 * é um MARCO na mesma conexão: o download só continua quando a conversão no
 * marco não cobre o maxChars. Este script mostra, por volta, em qual marco a
 * leitura parou e quantos bytes vieram — e compara com o documento inteiro.
 *
 * Uso: node dev/_diag-wapo-etapas.mjs [url] [voltas]
 */
import { fetchTextComTeto, fetchTextCached } from "../src/fetch.mjs";
import { htmlToMarkdown, extractMeta } from "../src/html-parser.mjs";
import {
  MAX_RESPONSE_BYTES,
  CHECKPOINT_ANTECIPADO_BYTES,
  MARGEM_PARADA_DOWNLOAD,
  tetoDownloadPara,
} from "../src/config.mjs";

const URL_ALVO = process.argv[2] || "https://www.washingtonpost.com/";
const VOLTAS = Math.max(1, Number(process.argv[3] || 3));
const MAX_CHARS = 25000;

const ta = async (fn) => {
  const t0 = performance.now();
  try {
    const r = await fn();
    return { ms: performance.now() - t0, ok: true, r };
  } catch (e) {
    return { ms: performance.now() - t0, ok: false, erro: e.message };
  }
};

const apertado = tetoDownloadPara(MAX_CHARS, MAX_RESPONSE_BYTES);
const marcos = [...new Set([apertado, CHECKPOINT_ANTECIPADO_BYTES])]
  .filter((n) => n < MAX_RESPONSE_BYTES)
  .sort((a, b) => a - b);
const limiar = MAX_CHARS + MARGEM_PARADA_DOWNLOAD;

for (let v = 1; v <= VOLTAS; v++) {
  // 1) Leitura progressiva: o mesmo caminho do read_page.
  let markdownPronto = null;
  const aoCheckpoint = (texto, { finalUrl }) => {
    const md = htmlToMarkdown(texto, finalUrl);
    if (md.length < limiar) return false;
    markdownPronto = md;
    return true;
  };
  const comTeto = await ta(() =>
    fetchTextComTeto(URL_ALVO, {
      timeoutMs: 120000,
      largoBytes: MAX_RESPONSE_BYTES,
      checkpoints: marcos,
      aoCheckpoint,
      sabor: `diag${MAX_CHARS}`,
    })
  );
  const p1 = comTeto.r;

  // 2) Documento inteiro (o que as ferramentas de documento usam).
  const inteiro = await ta(() => fetchTextCached(URL_ALVO, { timeoutMs: 120000 }));
  const p2 = inteiro.r;

  console.log(
    `volta ${v} | progressiva: ${comTeto.ms.toFixed(0)} ms ` +
      (comTeto.ok
        ? `${p1.text.length} chars baixados, cortado=${p1.cortado}` +
          (p1.paradaEmCheckpoint ? ` no marco ${p1.paradaEmCheckpoint}` : " (foi ate o fim)")
        : `ERRO ${comTeto.erro}`)
  );
  console.log(
    `         | documento inteiro: ${inteiro.ms.toFixed(0)} ms ` +
      (inteiro.ok ? `${p2.text.length} chars` : `ERRO ${inteiro.erro}`)
  );

  if (comTeto.ok) {
    const t0 = performance.now();
    const md = markdownPronto ?? htmlToMarkdown(p1.text, p1.finalUrl);
    const ms = performance.now() - t0;
    console.log(
      `         | markdown: ${md.length} chars (${ms.toFixed(1)} ms) ` +
        `| cobre ${MAX_CHARS}? ${md.length >= MAX_CHARS ? "SIM" : "NAO"}`
    );
  }
  if (inteiro.ok) {
    const t0 = performance.now();
    const mdInt = htmlToMarkdown(p2.text, p2.finalUrl);
    const meta = extractMeta(p2.text);
    console.log(
      `         | markdown inteiro: ${mdInt.length} chars (${(performance.now() - t0).toFixed(1)} ms) ` +
        `| meta "${meta.title || ""}"`
    );
  }
  console.log("");
}
