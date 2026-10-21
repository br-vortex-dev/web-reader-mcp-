#!/usr/bin/env node
/**
 * _bateria-real-teto.mjs — o teto de download medido contra a INTERNET.
 *
 * As baterias anteriores usavam fixture local com banda simulada, o que serve
 * para comparar caminhos de código mas não diz o que acontece no mundo real.
 * Aqui são sites de verdade, pesados, com o servidor subindo duas vezes (teto
 * ligado e desligado) e a mesma chamada nos dois.
 *
 * Dois detalhes de método que vieram de erros anteriores:
 *  - cada modo usa o SEU servidor e espera a drenagem antes de virar a chave;
 *  - a comparação é por TEXTO ENTREGUE, não só por tempo: ganho que muda a
 *    saída não é ganho.
 *
 * Uso: node dev/_bateria-real-teto.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVIDOR = join(RAIZ, "server.js");
const TOKEN = "token-real";

const ALVOS = [
  { nome: "whatwg (spec gigante)", url: "https://html.spec.whatwg.org/multipage/", maxChars: 2000 },
  { nome: "washingtonpost (notícia)", url: "https://www.washingtonpost.com/", maxChars: 2000 },
  { nome: "iana (página de registro)", url: "https://www.iana.org/domains/reserved", maxChars: 2000 },
  { nome: "nodejs docs", url: "https://nodejs.org/api/http.html", maxChars: 2000 },
  { nome: "exemplo pequeno", url: "https://example.com/", maxChars: 2000 },
];

async function portaLivre() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function comServidorNovo(env, fn) {
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [SERVIDOR, "--http"], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(porta), MCP_AUTH_TOKEN: TOKEN, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const base = `http://127.0.0.1:${porta}`;
  let subiu = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) {
        subiu = true;
        break;
      }
    } catch {
      /* subindo */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!subiu) {
    filho.kill();
    throw new Error("servidor nao subiu");
  }
  try {
    return await fn(async (nome, args) => {
      const t0 = process.hrtime.bigint();
      const r = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: nome, arguments: args } }),
        signal: AbortSignal.timeout(120000),
      });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const j = await r.json().catch(() => null);
      return {
        ms,
        isError: Boolean(j?.result?.isError),
        text: j?.result?.content?.[0]?.text ?? j?.error?.message ?? "",
      };
    });
  } finally {
    filho.kill();
    await new Promise((r) => setTimeout(r, 400));
  }
}

const resultados = [];
console.log("medindo contra a internet (pode levar alguns minutos)...\n");

for (const alvo of ALVOS) {
  // Cache TTL curto para medir download, não cache. Cada modo tem o seu servidor.
  const envBase = { CACHE_TTL_MS: "500", ROBOTS_TTL_MS: "500" };
  const desligado = await comServidorNovo({ ...envBase, DOWNLOAD_MIN_BYTES: "5242880" }, (ch) =>
    ch("read_page", { url: alvo.url, maxChars: alvo.maxChars, timeoutMs: 90000 })
  );
  const ligado = await comServidorNovo({ ...envBase }, (ch) =>
    ch("read_page", { url: alvo.url, maxChars: alvo.maxChars, timeoutMs: 90000 })
  );

  const semUrl = (t) => t.replace(/^URL: .*$/m, "URL: (igual)");
  const r = {
    alvo: alvo.nome,
    url: alvo.url,
    antes_ms: Number(desligado.ms.toFixed(0)),
    depois_ms: Number(ligado.ms.toFixed(0)),
    delta_pct: desligado.ms > 0 ? Number((((ligado.ms - desligado.ms) / desligado.ms) * 100).toFixed(0)) : 0,
    erro_antes: desligado.isError,
    erro_depois: ligado.isError,
    chars_antes: desligado.text.length,
    chars_depois: ligado.text.length,
    texto_identico: semUrl(desligado.text) === semUrl(ligado.text),
    cabecalho_antes: (desligado.text.match(/^Conteudo: .*$/m) || [""])[0],
    cabecalho_depois: (ligado.text.match(/^Conteudo: .*$/m) || [""])[0],
  };
  resultados.push(r);
  console.log(
    `${alvo.nome.padEnd(28)} ${String(r.antes_ms).padStart(6)} ms -> ${String(r.depois_ms).padStart(6)} ms ` +
      `(${String(r.delta_pct).padStart(4)}%) | texto ${r.texto_identico ? "IDENTICO" : "DIVERGIU"} | ` +
      `erro ${r.erro_antes ? "antes" : ""}${r.erro_depois ? "/depois" : ""}${r.erro_antes || r.erro_depois ? "" : "nao"}`
  );
  if (!r.texto_identico) {
    console.log(`   antes:  ${r.cabecalho_antes}`);
    console.log(`   depois: ${r.cabecalho_depois}`);
  }
}

const arquivo = join(RAIZ, "dev", "load", "bateria-real-teto.json");
writeFileSync(arquivo, JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 2), "utf8");
console.log(`\ngravado: dev/load/bateria-real-teto.json`);

const comErro = resultados.filter((r) => r.erro_antes || r.erro_depois);
if (comErro.length > 0) console.log(`ATENCAO: ${comErro.length} alvo(s) com erro — ver o JSON`);
const semTexto = resultados.filter((r) => !r.texto_identico && !r.erro_antes && !r.erro_depois);
console.log(
  semTexto.length === 0
    ? "texto identico em todos os alvos comparaveis"
    : `ATENCAO: texto divergiu em ${semTexto.map((r) => r.alvo).join(", ")}`
);
