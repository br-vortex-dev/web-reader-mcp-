#!/usr/bin/env node
/**
 * _bateria-completa.mjs — bateria PESADA contra o deploy: cobre as 12 ferramentas
 * uma a uma (com tempo e erros) e depois dispara carga concorrente em escada.
 *
 * Uso: node dev/_bateria-completa.mjs <https://...onrender.com> <token>
 */
const base = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || "";
const MODO = process.env.MODO || "tudo"; // individual | carga | tudo
if (!base || !token) {
  console.error("uso: node dev/_bateria-completa.mjs <https://sua-url.onrender.com> <token>");
  process.exit(1);
}
import { writeFileSync } from "node:fs";
function gravar(nome, dados) {
  writeFileSync(`dev/load/bateria-${nome}.json`, JSON.stringify(dados, null, 2));
}

const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };
let idSeq = 100;

async function rpc(method, params, timeoutMs = 120000) {
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++idSeq, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function chamar(name, args, timeoutMs = 120000) {
  const t0 = Date.now();
  try {
    const { status, json } = await rpc("tools/call", { name, arguments: args }, timeoutMs);
    const texto = (json?.result?.content?.[0]?.text) || "";
    return {
      ok: status === 200 && !json?.result?.isError,
      status,
      ms: Date.now() - t0,
      chars: texto.length,
      erro: json?.result?.isError ? texto.slice(0, 200) : json?.error?.message || "",
      texto,
    };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, chars: 0, erro: e.name === "TimeoutError" ? "timeout" : e.message, texto: "" };
  }
}

const linhas = [];
function registrar(nome, r, extra = "") {
  const marca = r.ok ? "PASS" : "FALHA";
  linhas.push({ nome, marca, ms: r.ms, status: r.status, chars: r.chars, extra: extra || r.erro });
  console.log(`[${marca}] ${nome} | ${r.ms} ms | HTTP ${r.status} | ${r.chars} chars${extra ? " | " + extra : ""}${!r.ok && r.erro ? " | " + r.erro.slice(0, 160) : ""}`);
}

console.log(`alvo: ${base}\nmodo: ${MODO}\n`);

// ---- 0. catálogo ----
const cat = await rpc("tools/list", {}, 60000);
const nomes = cat.json?.result?.tools?.map((t) => t.name) || [];
console.log(`tools/list -> HTTP ${cat.status} | ${nomes.length} ferramentas: ${nomes.join(", ")}\n`);
if (cat.status !== 200) { console.log("ABORTADO: token invalido"); process.exit(1); }

if (MODO === "individual" || MODO === "tudo") {
const ALVOS = {
  simples: "https://example.com",
  html: "https://www.iana.org/help/example-domains",
  // O alvo antigo (w3.org/.../dummy.pdf) passou a responder 403 para QUALQUER
  // User-Agent, inclusive o de um navegador real — o site fechou a porta, nao o
  // nosso codigo. Trocado por um PDF publico estavel (conferido em 21/10/2026).
  pdf: "https://pdfobject.com/pdf/sample.pdf",
  json: "https://api.github.com/repos/nodejs/node",
  feed: "https://hnrss.org/frontpage",
  sitemap: "https://www.iana.org",
  video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  vtt: "",
};

// ---- 1. tools/list repetido (CPU pura) ----
{
  const t0 = Date.now();
  const r = await rpc("tools/list", {}, 60000);
  registrar("tools/list", { ok: r.status === 200, status: r.status, ms: Date.now() - t0, chars: JSON.stringify(r.json).length, erro: "" });
}

// ---- 2. read_page ----
{
  const r = await chamar("read_page", { url: ALVOS.html, maxChars: 2000 });
  registrar("read_page", r);
}

// ---- 2b. read_page maxChars no teto ----
{
  const r = await chamar("read_page", { url: ALVOS.html, maxChars: 25000 });
  registrar("read_page (teto 25000)", r);
}

// ---- 3. extract_links ----
{
  const r = await chamar("extract_links", { url: ALVOS.html, limit: 200 });
  registrar("extract_links", r);
}

// ---- 4. read_multiple_pages ----
{
  const urls = [ALVOS.simples, ALVOS.html, "https://www.rfc-editor.org/rfc/rfc2606.txt", "https://httpbin.org/html", "https://www.iana.org/domains/reserved"];
  const r = await chamar("read_multiple_pages", { urls, maxChars: 1500 });
  registrar("read_multiple_pages (5 urls)", r);
}

// ---- 5. discover_urls ----
{
  const r = await chamar("discover_urls", { url: ALVOS.sitemap, limit: 100 });
  registrar("discover_urls", r);
}

// ---- 6. crawl_site ----
{
  const r = await chamar("crawl_site", { url: ALVOS.simples, maxPages: 5, maxChars: 1000 });
  registrar("crawl_site", r);
}

// ---- 7. read_dynamic_page ----
{
  const r = await chamar("read_dynamic_page", { url: "https://nextjs.org/", maxChars: 2000 });
  registrar("read_dynamic_page", r);
}

// ---- 8. read_video ----
{
  const r = await chamar("read_video", { url: ALVOS.video, maxChars: 3000 });
  registrar("read_video", r);
}

// ---- 9. read_pdf ----
{
  const r = await chamar("read_pdf", { url: ALVOS.pdf, maxChars: 3000 });
  registrar("read_pdf", r);
}

// ---- 10. read_feed ----
{
  const r = await chamar("read_feed", { url: ALVOS.feed, limit: 20 });
  registrar("read_feed", r);
}

// ---- 11. read_json ----
{
  const r = await chamar("read_json", { url: ALVOS.json, path: "stargazers_count" });
  registrar("read_json", r, r.texto ? `valor: ${r.texto.replace(/\s+/g, " ").slice(0, 60)}` : "");
}

// ---- 12. find_on_page ----
{
  const r = await chamar("find_on_page", { url: ALVOS.html, query: "example", maxHits: 20 });
  registrar("find_on_page", r);
}

// ---- 13. diff_page (primeira + segunda) ----
{
  const a = await chamar("diff_page", { url: ALVOS.simples, force: true });
  registrar("diff_page (marca)", a);
  const b = await chamar("diff_page", { url: ALVOS.simples });
  registrar("diff_page (compara)", b);
}

const passes = linhas.filter((l) => l.marca === "PASS").length;
console.log(`\nINDIVIDUAIS: ${passes}/${linhas.length} PASS`);
gravar("individual", { base, quando: new Date().toISOString(), catalogo: nomes, individuais: linhas });
console.log("gravado: dev/load/bateria-individual.json");
} // fim do bloco individual

if (MODO === "carga" || MODO === "tudo") {
console.log("\n===== CARGA (escada de concorrência) =====\n");

async function carga(nome, conc, segundos, argsFn) {
  const fim = Date.now() + segundos * 1000;
  const lat = [];
  let ok = 0, falha = 0, enviados = 0;
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: conc }, async (_, i) => {
      while (Date.now() < fim) {
        const args = argsFn(i);
        enviados++;
        const t = Date.now();
        const r = await chamar(nome, args, 20000).catch(() => ({ ok: false }));
        lat.push(Date.now() - t);
        r.ok ? ok++ : falha++;
      }
    })
  );
  const decorrido = (Date.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const p = (q) => lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] || 0;
  console.log(`[${nome}] conc=${conc} ${segundos}s | enviados ${enviados} | ok ${ok} | falha ${falha} | ${(ok / decorrido).toFixed(1)} req/s | p50 ${p(0.5)}ms p95 ${p(0.95)}ms p99 ${p(0.99)}ms`);
  return { nome, conc, enviados, ok, falha, rps: +(ok / decorrido).toFixed(2), p50: p(0.5), p95: p(0.95), p99: p(0.99) };
}

const resultadosCarga = [];
for (const conc of [128, 256, 512, 1024]) {
  resultadosCarga.push(await carga("read_page", conc, 6, () => ({ url: "https://example.com", maxChars: 500 })));
  gravar("carga", resultadosCarga);
}
for (const conc of [128, 512, 1024]) {
  resultadosCarga.push(await carga("tools/list", conc, 6, () => ({})));
  gravar("carga", resultadosCarga);
}
console.log(`\ncarga gravada: dev/load/bateria-carga.json`);
} // fim do bloco carga
