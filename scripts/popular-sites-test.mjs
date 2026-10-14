#!/usr/bin/env node
/**
 * Teste com sites populares que muita gente usa.
 * Testa read_page, extract_links e read_multiple_pages em sites reais.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "..", "server.js");

const SITES = [
  { nome: "Google", url: "https://www.google.com" },
  { nome: "YouTube", url: "https://www.youtube.com" },
  { nome: "Wikipedia", url: "https://pt.wikipedia.org/wiki/Brasil" },
  { nome: "GitHub", url: "https://github.com" },
  { nome: "Stack Overflow", url: "https://stackoverflow.com" },
  { nome: "Reddit", url: "https://www.reddit.com" },
  { nome: "Amazon", url: "https://www.amazon.com.br" },
  { nome: "Twitter/X", url: "https://x.com" },
  { nome: "LinkedIn", url: "https://www.linkedin.com" },
  { nome: "Netflix", url: "https://www.netflix.com" },
  { nome: "Spotify", url: "https://open.spotify.com" },
  { nome: "WhatsApp Web", url: "https://web.whatsapp.com" },
  { nome: "Instagram", url: "https://www.instagram.com" },
  { nome: "Facebook", url: "https://www.facebook.com" },
  { nome: "TikTok", url: "https://www.tiktok.com" },
  { nome: "Mercado Livre", url: "https://www.mercadolivre.com.br" },
  { nome: "Globo", url: "https://www.globo.com" },
  { nome: "UOL", url: "https://www.uol.com.br" },
  { nome: "G1", url: "https://g1.globo.com" },
  { nome: "BBC", url: "https://www.bbc.com" },
];

let server;
let msgId = 0;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function callTool(name, args) {
  const res = await send("tools/call", { name, arguments: args });
  if (res.error) throw new Error(res.error.message);
  return res.result;
}

function parseResult(result) {
  if (result?.content?.[0]?.text) {
    try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; }
  }
  return result;
}

async function testSite(site) {
  const inicio = Date.now();
  const resultado = { nome: site.nome, url: site.url, ok: false, erro: null, titulo: null, chars: 0, links: 0, tempoMs: 0 };

  try {
    // Testa read_page
    const page = parseResult(await callTool("read_page", { url: site.url }));
    if (page && typeof page === "string" && page.length > 0) {
      resultado.ok = true;
      // Extrai título do markdown (# Título)
      const titleMatch = page.match(/^#\s+(.+)$/m);
      resultado.titulo = titleMatch ? titleMatch[1] : null;
      resultado.chars = page.length;
    } else if (page && typeof page === "object" && page.ok) {
      resultado.ok = true;
      resultado.titulo = page.titulo;
      resultado.chars = page.chars || 0;
    } else {
      resultado.erro = "read_page retornou vazio ou inválido";
    }

    // Testa extract_links
    const links = parseResult(await callTool("extract_links", { url: site.url }));
    if (links && typeof links === "object" && links.ok) {
      resultado.links = links.total || 0;
    }
  } catch (e) {
    resultado.erro = e.message;
  }

  resultado.tempoMs = Date.now() - inicio;
  return resultado;
}

async function main() {
  console.log("=== TESTE DE SITES POPULARES ===\n");

  server = spawn("node", [SERVER_PATH], { stdio: ["pipe", "pipe", "inherit"] });

  server.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          const { resolve } = pending.get(msg.id);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch {}
    }
  });

  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "popular-sites-test", version: "1.0.0" },
  });
  notify("notifications/initialized", {});

  console.log(`Testando ${SITES.length} sites...\n`);

  const resultados = [];
  for (const site of SITES) {
    const r = await testSite(site);
    resultados.push(r);
    const status = r.ok ? "OK" : "FALHOU";
    const titulo = r.titulo ? `"${r.titulo.slice(0, 50)}"` : "-";
    console.log(`  [${status}] ${r.nome.padEnd(20)} ${r.tempoMs}ms  ${titulo}  (${r.chars} chars, ${r.links} links)`);
    if (r.erro) console.log(`         Erro: ${r.erro}`);
  }

  // Testa read_multiple_pages com 5 sites
  console.log("\n--- Teste read_multiple_pages (5 sites) ---");
  const multiUrls = SITES.slice(0, 5).map(s => s.url);
  try {
    const multi = parseResult(await callTool("read_multiple_pages", { urls: multiUrls }));
    if (multi && typeof multi === "string" && multi.length > 0) {
      console.log(`  OK: ${multi.length} chars retornados`);
    } else if (multi && typeof multi === "object" && multi.ok) {
      console.log(`  OK: ${multi.results?.length || 0} páginas lidas em ${multi.tempoMs || "?"}ms`);
    } else {
      console.log(`  FALHOU: ${multi?.erro || "erro desconhecido"}`);
    }
  } catch (e) {
    console.log(`  FALHOU: ${e.message}`);
  }

  // Resumo
  const ok = resultados.filter(r => r.ok).length;
  const falhou = resultados.filter(r => !r.ok).length;
  console.log(`\n=== RESUMO ===`);
  console.log(`  Total: ${resultados.length}`);
  console.log(`  OK: ${ok}`);
  console.log(`  Falhou: ${falhou}`);
  console.log(`  Taxa de sucesso: ${((ok / resultados.length) * 100).toFixed(1)}%`);

  if (falhou > 0) {
    console.log(`\n  Sites que falharam:`);
    for (const r of resultados.filter(r => !r.ok)) {
      console.log(`    - ${r.nome}: ${r.erro}`);
    }
  }

  server.kill();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
