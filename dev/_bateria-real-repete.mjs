#!/usr/bin/env node
/**
 * _bateria-real-repete.mjs — o mesmo alvo real, N voltas por modo.
 *
 * A bateria de uma volta só (`_bateria-real-teto.mjs`) oscila demais: em duas
 * execuções o whatwg deu -32% e +11%. Isso é rede, não código. Aqui cada alvo
 * é lido 5 vezes em cada modo, alternando os servidores, e o resultado é a
 * MEDIANA — mais a dispersão, porque esconder a dispersão seria vender
 * precisão que a medição não tem.
 *
 * Uso: node dev/_bateria-real-repete.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVIDOR = join(RAIZ, "server.js");
const TOKEN = "token-repete";
const VOLTAS = Number(process.env.VOLTAS || 5);
const MAX_CHARS = Number(process.env.MC || 2000);

const ALVOS = [
  { nome: "whatwg (spec 12 MB)", url: "https://html.spec.whatwg.org/multipage/" },
  { nome: "washingtonpost", url: "https://www.washingtonpost.com/" },
  { nome: "iana", url: "https://www.iana.org/domains/reserved" },
  { nome: "nodejs docs", url: "https://nodejs.org/api/http.html" },
];

async function portaLivre() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function subir(env) {
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [SERVIDOR, "--http"], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(porta), MCP_AUTH_TOKEN: TOKEN, CACHE_TTL_MS: "500", ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const base = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      /* subindo */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    chamar: async (nome, args) => {
      const t0 = process.hrtime.bigint();
      const r = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: nome, arguments: args } }),
        signal: AbortSignal.timeout(120000),
      });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const j = await r.json().catch(() => null);
      return { ms, text: j?.result?.content?.[0]?.text ?? "" };
    },
    close: () => filho.kill(),
  };
}

const mediana = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Dois servidores vivos ao mesmo tempo, alternando a ordem das leituras: assim
// uma queda de rede no meio do experimento atinge os dois lados.
const desligado = await subir({ DOWNLOAD_MIN_BYTES: "5242880" });
const ligado = await subir({});

const resultados = [];
for (const alvo of ALVOS) {
  const temposA = [];
  const temposD = [];
  let textoA = "";
  let textoD = "";
  for (let i = 0; i < VOLTAS; i++) {
    // Ordem alternada: na volta par o "antes" vai primeiro, na ímpar o "depois".
    // Cache-buster: sem ele, quem tem cache de borda (Cloudflare, Fastly) na
    // frente serve a 2ª volta da memória — o whatwg de 12 MB voltava em 26 ms,
    // e a medição passava a medir o CDN, não o download. A query não muda o
    // tamanho da página, e a memória de tamanho do próprio MCP a ignora.
    const urlVolta = `${alvo.url}${alvo.url.includes("?") ? "&" : "?"}cb=${Date.now()}-${i}`;
    if (i % 2 === 0) {
      const a = await desligado.chamar("read_page", { url: urlVolta, maxChars: MAX_CHARS, timeoutMs: 90000 });
      const d = await ligado.chamar("read_page", { url: urlVolta, maxChars: MAX_CHARS, timeoutMs: 90000 });
      temposA.push(a.ms);
      temposD.push(d.ms);
      textoA = a.text;
      textoD = d.text;
    } else {
      const d = await ligado.chamar("read_page", { url: urlVolta, maxChars: MAX_CHARS, timeoutMs: 90000 });
      const a = await desligado.chamar("read_page", { url: urlVolta, maxChars: MAX_CHARS, timeoutMs: 90000 });
      temposD.push(d.ms);
      temposA.push(a.ms);
      textoA = a.text;
      textoD = d.text;
    }
  }
  const semUrl = (t) => t.replace(/^URL: .*$/m, "URL: (igual)");
  const r = {
    alvo: alvo.nome,
    voltas: VOLTAS,
    antes_mediana: Number(mediana(temposA).toFixed(0)),
    depois_mediana: Number(mediana(temposD).toFixed(0)),
    delta_pct: Number((((mediana(temposD) - mediana(temposA)) / mediana(temposA)) * 100).toFixed(0)),
    antes_dispersao: [Number(Math.min(...temposA).toFixed(0)), Number(Math.max(...temposA).toFixed(0))],
    depois_dispersao: [Number(Math.min(...temposD).toFixed(0)), Number(Math.max(...temposD).toFixed(0))],
    texto_identico: semUrl(textoA) === semUrl(textoD),
    header_antes: (textoA.match(/^Conteudo: .*$/m) || [""])[0],
    header_depois: (textoD.match(/^Conteudo: .*$/m) || [""])[0],
  };
  resultados.push(r);
  console.log(
    `${alvo.nome.padEnd(22)} antes ${String(r.antes_mediana).padStart(5)} ms [${r.antes_dispersao.join("-")}]  ` +
      `depois ${String(r.depois_mediana).padStart(5)} ms [${r.depois_dispersao.join("-")}]  ` +
      `${String(r.delta_pct).padStart(4)}%  texto ${r.texto_identico ? "IDENTICO" : "DIVERGIU"}`
  );
}

desligado.close();
ligado.close();

writeFileSync(
  join(RAIZ, "dev", "load", "bateria-real-repete.json"),
  JSON.stringify({ quando: new Date().toISOString(), voltas: VOLTAS, max_chars: MAX_CHARS, resultados }, null, 2),
  "utf8"
);
console.log("\ngravado: dev/load/bateria-real-repete.json");
