#!/usr/bin/env node
/**
 * _check-video-render.mjs — prova do read_video no serviço REAL do Render.
 *
 * Chama o /mcp do deploy com token e verifica de ponta a ponta o que a
 * ferramenta entrega NO AR:
 *   1. Vimeo   — metadados e TRANSCRIÇÃO de verdade (blocos com timestamp);
 *   2. YouTube — metadados completos e o motivo explícito quando a legenda
 *                não vem (robots do /api/ + corpo vazio), sem fingir leitura.
 *
 * Uso: node dev/_check-video-render.mjs <https://...onrender.com> <token>
 * (o token também pode vir de MCP_AUTH_TOKEN; nunca é gravado em arquivo)
 */
const base = (process.argv[2] || process.env.RENDER_URL || "").replace(/\/+$/, "");
const token = process.argv[3] || process.env.MCP_AUTH_TOKEN || "";
if (!base || !token) {
  console.error("uso: node dev/_check-video-render.mjs <https://sua-url.onrender.com> <token>");
  process.exit(1);
}

const TIMEOUT_MS = 120000; // cobre o cold start do plano free
let pass = 0;
let fail = 0;
const check = (cond, rotulo, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${rotulo}${extra ? "  ->  " + extra : ""}`);
  if (cond) pass++;
  else fail++;
};

async function chamarFerramenta(name, args, id) {
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null);
  return {
    status: res.status,
    isError: Boolean(json && json.result && json.result.isError),
    texto: (json && json.result && json.result.content && json.result.content[0].text) || "",
  };
}

console.log(`alvo: ${base}\n`);

// ---------- 1. Vimeo: metadados + transcrição de verdade ----------
{
  const r = await chamarFerramenta(
    "read_video",
    { url: "https://vimeo.com/76979871", maxChars: 4000 },
    1
  );
  check(r.status === 200 && !r.isError, "Vimeo: chamada respondida sem erro");
  check(/Plataforma: Vimeo/.test(r.texto), "Vimeo: plataforma identificada");
  check(/Transcricao: \d+ blocos/.test(r.texto), "Vimeo: transcrição com blocos");
  check(/\[\d+(?::\d{2}){1,2}\]\s+\S/.test(r.texto), "Vimeo: blocos com timestamp e texto");
  const linhaTrans = (r.texto.match(/Transcricao: [^\n]*/) || [""])[0].trim();
  if (linhaTrans) console.log(`   ${linhaTrans.slice(0, 130)}`);
  const fala = (r.texto.match(/\[\d+(?::\d{2}){1,2}\][^\n]*/) || [""])[0].trim();
  if (fala) console.log(`   primeira fala: ${fala.slice(0, 120)}`);
}

// ---------- 2. YouTube: metadados completos + motivo explícito ----------
{
  const r = await chamarFerramenta(
    "read_video",
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", maxChars: 3000 },
    2
  );
  check(r.status === 200 && !r.isError, "YouTube: chamada respondida sem erro");
  check(/Plataforma: YouTube/.test(r.texto), "YouTube: plataforma identificada");
  check(/Canal: Rick Astley/.test(r.texto), "YouTube: metadados completos (canal)");
  check(/Transcricao: /.test(r.texto), "YouTube: campo de transcrição sempre presente");
  const linha = (r.texto.match(/Transcricao: [^\n]*/) || [""])[0].trim();
  if (linha) console.log(`   ${linha.slice(0, 140)}`);
  if (/indisponivel/.test(linha)) {
    check(/robots|vazio/i.test(linha), "YouTube: motivo declarado (robots/corpo vazio)");
  }
}

console.log(`\nresultado: ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
