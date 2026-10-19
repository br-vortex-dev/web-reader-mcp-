#!/usr/bin/env node
/**
 * _probe-pdf.mjs — prova, na web real, se dá para extrair TEXTO de PDF
 * usando só built-ins do Node (node:zlib), sem dependência nenhuma.
 *
 * O caminho mínimo de um PDF de texto:
 *   1. o arquivo tem objetos "stream ... endstream", muitos em FlateDecode (zlib);
 *   2. descomprimido, o content stream traz operadores de desenho de texto:
 *      Tj ('texto') Tj,  TJ [(a) -1 (b)] TJ  e  ' (a) '  /  " ;
 *   3. os glifos vêm em strings literais (...) com escapes e, às vezes, em <hex>.
 *
 * O que este script mede: quantos alvos respondem, quantos streams inflaram,
 * quanto texto saiu e uma amostra. Não altera nada do produto.
 */

import { inflateSync, inflateRawSync, gunzipSync } from "node:zlib";

const ALVOS = [
  "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
  "https://www.africau.edu/images/default/sample.pdf",
  "https://www.orimi.com/pdf-test.pdf",
  "https://arxiv.org/pdf/1706.03762",
  "https://www.ietf.org/rfc/rfc2616.txt",
];

function inflar(buf) {
  const tentativas = [inflateSync, inflateRawSync, gunzipSync];
  for (const fn of tentativas) {
    try {
      const out = fn(buf);
      if (out && out.length) return out;
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

/** Extrai todos os pares "stream ... endstream" do arquivo cru. */
function streamsDoPdf(buf) {
  const marcador = Buffer.from("stream");
  const fim = Buffer.from("endstream");
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const s = buf.indexOf(marcador, i);
    if (s === -1) break;
    const e = buf.indexOf(fim, s + marcador.length);
    if (e === -1) break;
    // pula o CR/LF logo após "stream"
    let ini = s + marcador.length;
    if (buf[ini] === 0x0d) ini++;
    if (buf[ini] === 0x0a) ini++;
    out.push(buf.subarray(ini, e));
    i = e + fim.length;
  }
  return out;
}

/** Junta o texto dos operadores Tj/TJ/'/" de um content stream. */
function textoDeContentStream(txt) {
  const pedacos = [];
  // strings literais entre parênteses, com escapes \{ \) \\
  const re = /\((?:\\.|[^\\()])*\)/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    let s = m[0].slice(1, -1);
    s = s
      .replace(/\\([nrtbf])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", b: "", f: "" })[c] ?? "")
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
    pedacos.push(s);
  }
  return pedacos.join("");
}

async function testar(url) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; probe)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { url, status: res.status, erro: "HTTP " + res.status };
    const ct = res.headers.get("content-type") || "";
    if (url.endsWith(".txt")) {
      const t = await res.text();
      return { url, status: res.status, ct, tipo: "texto", chars: t.length, amostra: t.slice(0, 120) };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const streams = streamsDoPdf(buf);
    let inflados = 0;
    let texto = "";
    for (const s of streams) {
      const d = inflar(s);
      if (!d) continue;
      inflados++;
      texto += textoDeContentStream(d.toString("latin1"));
    }
    return {
      url,
      status: res.status,
      ct,
      bytes: buf.length,
      streams: streams.length,
      inflados,
      chars: texto.length,
      amostra: texto.replace(/\s+/g, " ").slice(0, 200),
    };
  } catch (e) {
    return { url, erro: e.name + ": " + e.message };
  }
}

for (const alvo of ALVOS) {
  const r = await testar(alvo);
  console.log(JSON.stringify(r, null, 2));
}
