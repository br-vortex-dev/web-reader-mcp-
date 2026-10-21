#!/usr/bin/env node
/**
 * _mede-multi-teto.mjs — o teto de download nas ferramentas de VÁRIAS páginas.
 *
 * Três lições que esta versão existe para não repetir (todas foram erro meu):
 *
 *  1. Página menor que o PISO do teto (1 MB) não sofre efeito nenhum. A
 *     primeira versão usava 410 KB e media ruído.
 *  2. O texto útil tem de estar no TOPO e cobrir o `maxChars` pedido: se o
 *     corte deixar o markdown abaixo do pedido, o código refaz o download
 *     grande de propósito e o ganho desaparece (correto, mas não é o caso
 *     medido aqui).
 *  3. Cada ferramenta precisa de um conjunto de URLs PRÓPRIO e de um servidor
 *     recém-subido: com cache quente a segunda medição lia da memória e dava
 *     15 ms para 20 páginas — número impossível que quase virou conclusão.
 *
 * read_multiple_pages recebe o teto; crawl_site NÃO (precisa dos links, que
 * moram no rodapé). O crawl aparece aqui como controle do que não muda.
 *
 * Uso: node dev/_mede-multi-teto.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVIDOR = join(RAIZ, "server.js");
const TOKEN = "token-multi";
const BANDA = Number(process.env.BANDA_MB_S || 8) * 1024 * 1024;
const PEDACO = 64 * 1024;
const PAGINAS = Number(process.env.PAGINAS || 10);
const MAX_CHARS = Number(process.env.MAX_CHARS || 2000);
const KB_POR_PAGINA = Number(process.env.KB_POR_PAGINA || 2000);

// Conjuntos independentes: cada medição usa o seu, assim nenhuma herda cache.
const CONJUNTOS = { a: "a", b: "b", c: "c", d: "d" };

function pagina(prefixo, i) {
  // TOPO: o conteúdo que interessa, e em quantidade suficiente para cobrir o
  // maxChars pedido (senão o código refaz o download grande e não há ganho).
  const util = Array.from(
    { length: 45 },
    (_, k) =>
      `<p>${prefixo}${i} conteudo real ${k}: o texto que o leitor quer, curto, com acento e pontuacao. ` +
      `Cada paragrafo existe para o markdown passar do teto pedido.</p>`
  ).join("");
  const tamanhoUtil = util.length;
  // MEIO: marcação pesada que o parser JOGA FORA (script). É o peso real de
  // uma página moderna — e é exatamente o que o teto evita baixar.
  const unidade = `<script>var dado = ${JSON.stringify("x".repeat(60))};</script>`;
  const peso = unidade.repeat(Math.max(1, Math.ceil((KB_POR_PAGINA * 1024 - tamanhoUtil) / unidade.length)));
  // RODAPÉ: os links que o CRAWL precisa e o read_multiple_pages não.
  const links = Array.from({ length: 5 }, (_, k) => `<a href="/${prefixo}${i + k + 1}">proxima ${k}</a>`).join(" ");
  return (
    `<!DOCTYPE html><html><head><title>Pagina ${prefixo}${i}</title></head><body>` +
    `<h1>${prefixo}${i}</h1>${util}${peso}<div class="rodape">${links}</div></body></html>`
  );
}

const HTMLS = new Map();
for (const p of Object.values(CONJUNTOS)) {
  for (let i = 0; i < PAGINAS + 8; i++) HTMLS.set(`/${p}${i}`, pagina(p, i));
}

// Cada medição tem o SEU contador. Um contador global compartilhado fazia os
// bytes ainda em trânsito da medição anterior caírem na seguinte e uma leitura
// de 40 MB aparecia como 79 MB — duas vezes o real, por erro de instrumento.
function novoContador() {
  return { requisicoes: 0, bytesEnviados: 0 };
}
let stats = novoContador();

const fixture = await new Promise((resolve) => {
  const s = createServer((req, res) => {
    stats.requisicoes++;
    const u = req.url.split("?")[0];
    if (u === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    const html = HTMLS.get(u);
    if (!html) return res.writeHead(404, { "content-type": "text/html" }).end("<html><body>404</body></html>");
    const buf = Buffer.from(html, "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": String(buf.length) });
    let pos = 0;
    const passo = () => {
      if (res.destroyed || res.writableEnded) return;
      if (pos >= buf.length) return res.end();
      const fim = Math.min(pos + PEDACO, buf.length);
      res.write(buf.subarray(pos, fim));
      const n = fim - pos;
      pos = fim;
      stats.bytesEnviados += n;
      setTimeout(passo, (n / BANDA) * 1000);
    };
    passo();
  });
  s.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) }));
});

async function portaLivre() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

/** Servidor novo por medição: cache limpo é parte do método. */
async function comServidorNovo(env, fn) {
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [SERVIDOR, "--http"], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(porta), MCP_AUTH_TOKEN: TOKEN, ALLOW_PRIVATE_HOSTS: "1", ...env },
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
  try {
    return await fn(async (nome, args) => {
      // Espera o fixture drenar o que a medição anterior deixou em trânsito
      // (com conexões abortadas no meio, o `close` chega depois da resposta).
      await new Promise((r) => setTimeout(r, 300));
      stats = novoContador();
      const meuContador = stats;
      const t0 = process.hrtime.bigint();
      const r = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: nome, arguments: args } }),
      });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const j = await r.json().catch(() => null);
      return {
        ms,
        text: j?.result?.content?.[0]?.text ?? "",
        isError: Boolean(j?.result?.isError),
        requisicoes: meuContador.requisicoes,
        kbEnviados: Math.round(meuContador.bytesEnviados / 1024),
      };
    });
  } finally {
    filho.kill();
  }
}

const resultados = [];
const semUrl = (t) => t.replace(/^(URL|Crawl de) .*$/gm, "$1 (igual)");

for (const [nome, conjunto, montarArgs] of [
  ["read_multiple_pages", "a", (urls) => ({ urls, maxChars: MAX_CHARS, timeoutMs: 180000 })],
  ["crawl_site", "c", (urls) => ({ url: urls[0], maxPages: PAGINAS, maxChars: MAX_CHARS, timeoutMs: 180000 })],
]) {
  const urls = Array.from({ length: PAGINAS }, (_, i) => `${fixture.url}/${conjunto}${i}`);
  // SEM teto: piso no teto duro desliga o proporcional (comportamento antigo).
  const antes = await comServidorNovo({ DOWNLOAD_MIN_BYTES: "5242880" }, (ch) => ch(nome, montarArgs(urls)));
  const depois = await comServidorNovo({}, (ch) => ch(nome, montarArgs(urls)));
  const r = {
    ferramenta: nome,
    paginas: PAGINAS,
    kb_por_pagina: Math.round(Buffer.byteLength(HTMLS.get(`/${conjunto}0`), "utf8") / 1024),
    antes_ms: Number(antes.ms.toFixed(0)),
    depois_ms: Number(depois.ms.toFixed(0)),
    delta_pct: Number((((depois.ms - antes.ms) / antes.ms) * 100).toFixed(0)),
    kb_baixados_antes: antes.kbEnviados,
    kb_baixados_depois: depois.kbEnviados,
    erro_antes: antes.isError,
    erro_depois: depois.isError,
    chars_antes: antes.text.length,
    chars_depois: depois.text.length,
    texto_identico: semUrl(antes.text) === semUrl(depois.text),
  };
  resultados.push(r);
  console.log(
    `${nome.padEnd(21)} ${String(PAGINAS).padStart(2)} pag ${String(r.kb_por_pagina).padStart(5)} KB cada\n` +
      `  tempo:    antes ${String(r.antes_ms).padStart(6)} ms -> depois ${String(r.depois_ms).padStart(6)} ms (${r.delta_pct}%)\n` +
      `  baixado:  antes ${String(r.kb_baixados_antes).padStart(6)} KB -> depois ${String(r.kb_baixados_depois).padStart(6)} KB\n` +
      `  entrega:  texto ${r.texto_identico ? "IDENTICO" : "DIVERGIU"} (${r.chars_antes} vs ${r.chars_depois} chars)\n`
  );
}

await fixture.close();
writeFileSync(
  join(RAIZ, "dev", "load", "mede-multi-teto.json"),
  JSON.stringify(
    { quando: new Date().toISOString(), banda_mb_s: Number(process.env.BANDA_MB_S || 8), max_chars: MAX_CHARS, resultados },
    null,
    2
  ),
  "utf8"
);
console.log("gravado: dev/load/mede-multi-teto.json");
