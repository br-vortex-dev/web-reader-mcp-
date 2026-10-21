#!/usr/bin/env node
/**
 * _baseline-pdf.mjs — grava (ou compara) o texto que o extrator de PDF produz.
 *
 * Por que existe: o plano acelera a descompressão do read_pdf. Acelerar &eacute;
 * in&uacute;til se o texto mudar — o produto &eacute; a fidelidade da extra&ccedil;&atilde;o. Este script
 * baixa os mesmos PDFs e grava sha256 + texto de cada um. Depois da mudan&ccedil;a,
 * rodar de novo com `--compara` prova byte a byte que nada regrediu.
 *
 * Uso:
 *   node dev/_baseline-pdf.mjs            (grava em dev/_baseline-pdf/)
 *   node dev/_baseline-pdf.mjs --compara  (compara com o que foi gravado)
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { extrairTextoPdf } from "../src/pdf.mjs";

const ALVOS = [
  ["arxiv", "https://arxiv.org/pdf/1706.03762"],
  ["orimi", "https://www.orimi.com/pdf-test.pdf"],
  ["pdfobject", "https://pdfobject.com/pdf/sample.pdf"],
  ["dummy", "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"],
];

const PASTA = new URL("./_baseline-pdf/", import.meta.url);
mkdirSync(PASTA, { recursive: true });

const comparar = process.argv.includes("--compara");
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

let iguais = 0;
let diferentes = 0;
let falhas = 0;

for (const [nome, url] of ALVOS) {
  let buffer;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0" },
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.log(`${nome.padEnd(8)} PULADO (${e.message})`);
    falhas++;
    continue;
  }

  const t0 = performance.now();
  const r = extrairTextoPdf(buffer);
  const ms = performance.now() - t0;
  const h = sha(r.text);

  const arqTexto = new URL(`${nome}.txt`, PASTA);
  const arqMeta = new URL(`${nome}.json`, PASTA);

  if (comparar) {
    if (!existsSync(arqTexto)) {
      console.log(`${nome.padEnd(8)} SEM REFERENCIA (grave o baseline antes)`);
      falhas++;
      continue;
    }
    const antes = readFileSync(arqTexto, "utf8");
    if (antes === r.text) {
      console.log(`${nome.padEnd(8)} IDENTICO  sha ${h}  ${ms.toFixed(0)} ms  ${r.text.length} chars`);
      iguais++;
    } else {
      const meta = JSON.parse(readFileSync(arqMeta, "utf8"));
      console.log(
        `${nome.padEnd(8)} MUDOU!    antes sha ${meta.sha} ${meta.chars} chars -> agora ${h} ${r.text.length} chars`
      );
      diferentes++;
    }
  } else {
    writeFileSync(arqTexto, r.text);
    writeFileSync(arqMeta, JSON.stringify({ url, sha: h, chars: r.text.length, paginas: r.paginas }, null, 2));
    console.log(
      `${nome.padEnd(8)} GRAVADO   sha ${h}  ${ms.toFixed(0)} ms  ${r.text.length} chars  ${r.paginas} pag`
    );
  }
}

if (comparar) {
  console.log(`\nresultado: ${iguais} identicos, ${diferentes} diferentes, ${falhas} pulados`);
  process.exit(diferentes > 0 ? 1 : 0);
}
