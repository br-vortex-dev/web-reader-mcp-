#!/usr/bin/env node
/**
 * _perfil-pdf.mjs — onde o tempo da extração de PDF é gasto.
 *
 * Medido antes: read_pdf de arxiv 1706.03762 levava 2.592 ms no total, mas o
 * download cru do MESMO arquivo levou 284-500 ms. Ou seja, ~2,1 s é o nosso
 * extrator. Aqui cada etapa é cronometrada separadamente, no mesmo buffer.
 *
 * Uso: node dev/_perfil-pdf.mjs [url]
 */
import { inflateSync, inflateRawSync, gunzipSync } from "node:zlib";
import { extrairTextoPdf } from "../src/pdf.mjs";

const URL_PDF = process.argv[2] || "https://arxiv.org/pdf/1706.03762";

const res = await fetch(URL_PDF, {
  headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0" },
  signal: AbortSignal.timeout(120000),
});
const buffer = Buffer.from(await res.arrayBuffer());
console.log(`PDF: ${(buffer.length / 1024).toFixed(0)} KB`);

const cron = (rotulo, fn) => {
  const t0 = performance.now();
  const r = fn();
  // Só imprime o retorno quando ele é um NÚMERO curto. Antes disto, imprimir
  // `${array}` de streams do PDF despejava 23 MB de saída e escondia as
  // próprias medições no meio do conteúdo do documento.
  const extra = typeof r === "number" ? `  -> ${r}` : Array.isArray(r) ? `  -> ${r.length} itens` : "";
  console.log(`${rotulo.padEnd(42)} ${(performance.now() - t0).toFixed(1)} ms${extra}`);
  return r;
};

// Etapa 1: varrer os pares stream/endstream.
const inicio = Buffer.from("stream");
const fim = Buffer.from("endstream");
const streams = cron("1. varrer stream/endstream", () => {
  const out = [];
  let i = 0;
  while (i < buffer.length) {
    const s = buffer.indexOf(inicio, i);
    if (s === -1) break;
    const e = buffer.indexOf(fim, s + inicio.length);
    if (e === -1) break;
    let ini = s + inicio.length;
    if (buffer[ini] === 0x0d) ini++;
    if (buffer[ini] === 0x0a) ini++;
    out.push(buffer.subarray(ini, e));
    i = e + fim.length;
  }
  return out;
});

// Etapa 2: descomprimir cada stream. Separa ACERTO de TENTATIVA FALHA, porque
// cada exceção do zlib custa caro e é lançada de novo no próximo filtro.
let falhas = 0;
const descomprimidos = cron("2. descomprimir todos os streams", () => {
  const out = [];
  for (const s of streams) {
    let achou = null;
    for (const fn of [inflateSync, inflateRawSync, gunzipSync]) {
      try {
        const o = fn(s);
        if (o && o.length) {
          achou = o;
          break;
        }
      } catch {
        falhas++;
      }
    }
    out.push({ dado: achou || s, inflado: Boolean(achou) });
  }
  return out;
});
console.log(`   -> ${streams.length} streams | ${descomprimidos.filter((d) => d.inflado).length} inflados | ${falhas} tentativas falhas`);

// Etapa 3: converter para latin1 (cópia de string de TODO o stream).
const strings = cron("3. toString('latin1') de cada stream", () =>
  descomprimidos.map((d) => d.dado.toString("latin1"))
);

// Etapa 4: filtrar content streams.
const conteudos = cron("4. filtrar ehContentStream", () =>
  strings.filter((txt) => txt.includes("BT") && (txt.includes("Tj") || txt.includes("TJ")))
);
console.log(`   -> ${conteudos.length} content streams de texto`);

// Etapa 5: interpretar os operadores de texto.
const RE_TOKEN_CONTENT =
  /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|[+-]?(?:\d+\.?\d*|\.\d+)|\/[^\s/<>[\]()]+|\[|\]|[A-Za-z'*"][A-Za-z0-9'*"]*/g;
cron("5. tokenizar content streams", () => {
  let n = 0;
  for (const c of conteudos) {
    RE_TOKEN_CONTENT.lastIndex = 0;
    while (RE_TOKEN_CONTENT.exec(c) !== null) n++;
  }
  return n;
});

// Etapa 6: o toString('latin1') do arquivo inteiro, só para contar páginas.
cron("6. toString('latin1') do arquivo inteiro", () => buffer.toString("latin1").length);

// Etapa 7: a extração completa, como o read_pdf chama.
const t0 = performance.now();
const r = extrairTextoPdf(buffer);
console.log(`${"7. extrairTextoPdf COMPLETO".padEnd(42)} ${(performance.now() - t0).toFixed(1)} ms  -> ${r.text.length} chars, ${r.paginas} paginas`);

// Etapa 8: repetição — o cache quente já elimina isto, mas mede o custo por leitura.
const t1 = performance.now();
extrairTextoPdf(buffer);
console.log(`${"8. segunda extração (sem cache)".padEnd(42)} ${(performance.now() - t1).toFixed(1)} ms`);
