#!/usr/bin/env node
/**
 * _bateria-pos-pdf-memo.mjs — mede no RENDER as duas correções desta rodada.
 *
 * Alvos:
 *   1. read_pdf (arxiv)   — a descompressão por cabeçalho;
 *   2. read_page washingtonpost — a página dinâmica, onde o conteúdo embutido
 *      agora é memoizado. Mede a 1a leitura (cache frio do servidor) e as
 *      seguintes (cache quente), que é onde o memo aparece.
 *
 * Rodízio entre os alvos, como em _repete-outliers.mjs: uma volta isolada na
 * internet engana.
 *
 * Uso: node dev/_bateria-pos-pdf-memo.mjs [voltas]
 */
const BASE = process.env.RENDER_URL || "https://web-reader-mcp-13z0.onrender.com";
const TOKEN = process.env.LIVE_TEST_TOKEN || process.env.MCP_AUTH_TOKEN || "";
if (!TOKEN) { console.error("defina LIVE_TEST_TOKEN (ou MCP_AUTH_TOKEN) com o token do servidor"); process.exit(1); }
const VOLTAS = Math.max(1, Number(process.argv[2] || 4));
const auth = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
let id = 1;

async function chamar(name, args, timeoutMs = 180000) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + "/mcp", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => null);
    const txt = json?.result?.content?.[0]?.text || "";
    return { ok: res.status === 200 && !json?.result?.isError, ms: Date.now() - t0, chars: txt.length, txt };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, chars: 0, erro: e.message };
  }
}

const pdf = { url: "https://arxiv.org/pdf/1706.03762", maxChars: 25000, timeoutMs: 120000 };
const wapo = { url: "https://www.washingtonpost.com/", maxChars: 25000, timeoutMs: 120000 };

// Aquece TLS + roteador antes de medir.
await chamar("read_page", { url: "https://example.com", maxChars: 2000 });

const dados = { pdf: [], wapo: [] };

for (let v = 1; v <= VOLTAS; v++) {
  const rp = await chamar("read_pdf", pdf);
  dados.pdf.push(rp.ms);
  console.log(
    `${rp.ok ? "OK   " : "FALHA"} ${String(rp.ms).padStart(6)} ms  read_pdf arxiv      ${rp.chars} chars` +
      (rp.erro ? `  !! ${rp.erro}` : "")
  );

  const rw = await chamar("read_page", wapo);
  dados.wapo.push(rw.ms);
  console.log(
    `${rw.ok ? "OK   " : "FALHA"} ${String(rw.ms).padStart(6)} ms  read_page wapo      ${rw.chars} chars` +
      (rw.erro ? `  !! ${rw.erro}` : "")
  );

  // Segunda leitura imediata da MESMA página: cache quente + conteúdo embutido
  // já memorizado. É aqui que a memoização aparece.
  const rw2 = await chamar("read_page", wapo);
  dados.wapo.push(rw2.ms);
  console.log(`${rw2.ok ? "OK   " : "FALHA"} ${String(rw2.ms).padStart(6)} ms  read_page wapo (2a) ${rw2.chars} chars`);
}

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
console.log("\n===== mediana (ms) =====");
console.log(`read_pdf arxiv            ${med(dados.pdf)}`);
console.log(`read_page wapo (todas)    ${med(dados.wapo)}`);

// Prova de fidelidade: o texto do PDF tem de continuar com o mesmo tamanho.
const conf = await chamar("read_pdf", pdf);
console.log(`\nfidelidade: read_pdf devolve ${conf.chars} chars | trecho: ${JSON.stringify(conf.txt.slice(0, 80))}`);
