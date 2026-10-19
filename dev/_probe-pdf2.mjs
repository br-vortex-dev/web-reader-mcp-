#!/usr/bin/env node
/**
 * _probe-pdf2.mjs — segunda tentativa: reconstruir ESPAÇOS e QUEBRAS a partir
 * dos operadores de posicionamento de texto, e descartar streams que não são
 * de conteúdo (fontes, imagens, metadados).
 *
 * Operadores que importam num content stream:
 *   BT / ET                     início e fim de um bloco de texto
 *   Tf tamanho /Fonte           seleção de fonte e TAMANHO (dá escala dos saltos)
 *   Td tx ty   TD tx ty         move o cursor (ty != 0 => nova linha)
 *   Tm a b c d e f              matriz de texto (e,f = posição)
 *   T*                          nova linha
 *   Tj (texto) Tj               desenha uma string
 *   TJ [(a) -120 (b)] TJ        desenha com ajuste de kerning: número negativo
 *                               grande = espaço entre palavras
 *   ' (texto) '                 nova linha + string
 *   " aw ac (texto) "           espaçamento + string
 */

import { inflateSync, inflateRawSync, gunzipSync } from "node:zlib";

const ALVOS = [
  "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
  "https://www.orimi.com/pdf-test.pdf",
  "https://arxiv.org/pdf/1706.03762",
  "https://www.ietf.org/rfc/rfc2616.txt",
];

function inflar(buf) {
  for (const fn of [inflateSync, inflateRawSync, gunzipSync]) {
    try {
      const out = fn(buf);
      if (out && out.length) return out;
    } catch {
      /* próximo */
    }
  }
  return null;
}

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
    let ini = s + marcador.length;
    if (buf[ini] === 0x0d) ini++;
    if (buf[ini] === 0x0a) ini++;
    out.push(buf.subarray(ini, e));
    i = e + fim.length;
  }
  return out;
}

/** Um stream de conteúdo tem operadores de texto; fonte/imagem não costuma ter. */
function ehContentStream(txt) {
  return /\bBT\b/.test(txt) && /\b(Tj|TJ)\b/.test(txt);
}

/** Desescapa uma string literal de PDF. */
function desescapar(s) {
  return s
    .replace(/\\([nrtbf])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", b: "", f: "" })[c] ?? "")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

/**
 * Varre o content stream token a token, mantendo um cursor aproximado para
 * decidir onde entram espaço e quebra. Todos os números ficam numa pilha de
 * operandos; um operador consome o que precisa.
 */
function textoDoContent(txt) {
  const out = [];
  let pilha = [];
  let tamanhoFonte = 12; // pontos; usado como escala do espaço
  // cursor aproximado (unidades de texto) e última posição vertical
  let x = 0;
  let y = 0;
  let ultimoY = null;
  let ultimoFimX = null;
  let ultimoTamanho = 12;

  const i = { p: 0 };
  const s = txt;

  function empurrarEspaco() {
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo !== " " && ultimo !== "\n") out.push(" ");
  }

  while (i.p < s.length) {
    const c = s[i.p];

    // string literal
    if (c === "(") {
      let depth = 1;
      let j = i.p + 1;
      let bruto = "";
      while (j < s.length && depth > 0) {
        const ch = s[j];
        if (ch === "\\") {
          bruto += ch + (s[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) break;
        }
        bruto += ch;
        j++;
      }
      i.p = j + 1;
      pilha.push({ str: desescapar(bruto) });
      continue;
    }

    // string hexadecimal
    if (c === "<" && s[i.p + 1] !== "<") {
      const j = s.indexOf(">", i.p);
      if (j === -1) break;
      let hex = s.slice(i.p + 1, j).replace(/\s+/g, "");
      if (hex.length % 2) hex += "0";
      let str = "";
      for (let k = 0; k < hex.length; k += 2) {
        str += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
      }
      i.p = j + 1;
      pilha.push({ str });
      continue;
    }

    // número
    const mNum = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(s.slice(i.p, i.p + 40));
    if (mNum) {
      pilha.push(parseFloat(mNum[0]));
      i.p += mNum[0].length;
      continue;
    }

    // nome (/Fonte)
    if (c === "/") {
      const m = /^\/[^\s/<>[\]()]+/.exec(s.slice(i.p));
      pilha.push({ nome: m ? m[0] : "/" });
      i.p += m ? m[0].length : 1;
      continue;
    }

    // palavra (operador ou palavra-chave)
    const mOp = /^[A-Za-z'*"][A-Za-z0-9'*"]*/.exec(s.slice(i.p));
    if (mOp) {
      const op = mOp[0];
      i.p += op.length;
      switch (op) {
        case "Tf": {
          const tam = pilha.filter((v) => typeof v === "number").pop();
          if (typeof tam === "number" && tam > 0) tamanhoFonte = tam;
          break;
        }
        case "Td":
        case "TD": {
          const nums = pilha.filter((v) => typeof v === "number");
          const tx = nums[nums.length - 2] ?? 0;
          const ty = nums[nums.length - 1] ?? 0;
          if (ty !== 0) {
            out.push("\n");
            ultimoFimX = null;
          } else if (x !== null && tx > tamanhoFonte * 0.15) {
            empurrarEspaco();
          }
          break;
        }
        case "Tm": {
          const nums = pilha.filter((v) => typeof v === "number");
          const f = nums[nums.length - 1] ?? 0;
          if (ultimoY !== null && Math.abs(f - ultimoY) > tamanhoFonte * 0.5) {
            out.push("\n");
            ultimoFimX = null;
          }
          y = f;
          ultimoY = f;
          break;
        }
        case "T*":
          out.push("\n");
          ultimoFimX = null;
          break;
        case "Tj":
        case "'":
        case '"': {
          if (op !== "Tj") out.push("\n");
          const str = [...pilha].reverse().find((v) => v && typeof v === "object" && "str" in v);
          if (str) {
            out.push(str.str);
            ultimoTamanho = tamanhoFonte;
          }
          break;
        }
        case "TJ": {
          const arr = [...pilha].reverse().find((v) => Array.isArray(v));
          if (arr) {
            for (const item of arr) {
              if (typeof item === "string") out.push(item);
              else if (typeof item === "number" && item < -tamanhoFonte * 0.2) empurrarEspaco();
            }
            ultimoTamanho = tamanhoFonte;
          }
          break;
        }
        case "[":
          pilha.push([]);
          break;
        case "]":
          break;
        default:
          break;
      }
      pilha = [];
      continue;
    }

    i.p++;
  }

  // o array do TJ chega em pilha; reconstruímos de forma simples: como os
  // itens foram empilhados antes do ']', usamos uma passada alternativa.
  return out.join("");
}

/**
 * Versão do parser que trata o array do TJ empilhando item a item.
 * (o Tj simples usa a mesma máquina; aqui reescrevemos o laço de novo, mais
 * direto, porque o TJ é o operador mais comum e o anterior não fechava o
 * array.)
 */
function textoDoContent2(txt) {
  const out = [];
  let tam = 12;
  let ultimoY = null;

  const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|-?\d+(?:\.\d+)?|\/[^\s/<>[\]()]+|\[|\]|[A-Za-z'*"][A-Za-z0-9'*"]*/g;
  let tok;
  let pilha = [];
  const pString = (bruto) =>
    bruto[0] === "("
      ? desescapar(bruto.slice(1, -1))
      : (() => {
          let hex = bruto.slice(1, -1).replace(/\s+/g, "");
          if (hex.length % 2) hex += "0";
          let r = "";
          for (let k = 0; k < hex.length; k += 2) r += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
          return r;
        })();

  const espaco = () => {
    const u = out[out.length - 1];
    if (u && u !== " " && u !== "\n") out.push(" ");
  };

  while ((tok = re.exec(txt)) !== null) {
    const t = tok[0];
    if (t[0] === "(" || t[0] === "<") {
      pilha.push(pString(t));
      continue;
    }
    if (/^-?\d/.test(t)) {
      pilha.push(parseFloat(t));
      continue;
    }
    if (t[0] === "/") {
      pilha.push(t);
      continue;
    }
    if (t === "[") {
      pilha.push([]);
      continue;
    }
    if (t === "]") {
      // modifica o array no topo? mantemos os itens soltos; o TJ os lê em ordem
      continue;
    }
    switch (t) {
      case "Tf": {
        const n = [...pilha].reverse().find((v) => typeof v === "number");
        if (typeof n === "number" && n > 0) tam = n;
        break;
      }
      case "Tm": {
        const f = [...pilha].reverse().find((v) => typeof v === "number");
        if (ultimoY !== null && f !== undefined && Math.abs(f - ultimoY) > tam * 0.5) out.push("\n");
        ultimoY = f;
        break;
      }
      case "Td":
      case "TD": {
        const nums = pilha.filter((v) => typeof v === "number");
        const ty = nums[nums.length - 1] ?? 0;
        if (ty !== 0) out.push("\n");
        break;
      }
      case "T*":
        out.push("\n");
        break;
      case "Tj": {
        const str = [...pilha].reverse().find((v) => typeof v === "string");
        if (str) out.push(str);
        break;
      }
      case "TJ": {
        // lê a sequência de strings/ajustes que apareceu desde o último operador
        for (const v of pilha) {
          if (typeof v === "string") out.push(v);
          else if (typeof v === "number" && v < -tam * 0.2) espaco();
        }
        break;
      }
      case "'":
      case '"': {
        out.push("\n");
        const str = [...pilha].reverse().find((v) => typeof v === "string");
        if (str) out.push(str);
        break;
      }
    }
    pilha = [];
  }
  return out.join("");
}

async function testar(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; probe)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return { url, status: res.status, erro: "HTTP " + res.status };

  const ct = res.headers.get("content-type") || "";
  if (ct.startsWith("text/")) {
    const t = await res.text();
    return { url, status: res.status, ct, tipo: "texto", chars: t.length };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const streams = streamsDoPdf(buf);
  let content = 0;
  let texto1 = "";
  let texto2 = "";
  for (const s of streams) {
    let d = inflar(s);
    if (!d) d = s; // pode ser content stream sem filtro
    const t = d.toString("latin1");
    if (!ehContentStream(t)) continue;
    content++;
    texto1 += textoDoContent(t);
    texto2 += textoDoContent2(t);
  }
  return {
    url,
    status: res.status,
    bytes: buf.length,
    streams: streams.length,
    content,
    v1_chars: texto1.length,
    v2_chars: texto2.length,
    v1_amostra: texto1.replace(/\s+/g, " ").slice(0, 220),
    v2_amostra: texto2.replace(/\s+\n/g, "\n").slice(0, 300),
  };
}

for (const alvo of ALVOS) {
  const r = await testar(alvo);
  console.log(JSON.stringify(r, null, 2));
}
