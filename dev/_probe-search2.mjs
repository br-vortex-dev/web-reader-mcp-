#!/usr/bin/env node
/**
 * _probe-search2.mjs — os provedores que PASSARAM no robots entregam
 * resultado parseavel de verdade?
 *
 * A sonda 1 mostrou: DDG html/lite permitem e respondem rapido; marginalia
 * permite; wikipedia bloqueia /w/, searx.be tem anti-bot, mojeek bloqueia.
 * Agora o que importa: dos que sobraram, da para extrair titulo + URL real?
 */
import { fetchText } from "../src/fetch.mjs";

async function testar(nome, url, extrair) {
  console.log(`\n===== ${nome} =====`);
  try {
    const r = await fetchText(url, { timeoutMs: 12000, retries: 0 });
    const itens = extrair(r.text);
    console.log(`status: OK | ${r.text.length} chars | ${itens.length} resultados`);
    for (const it of itens.slice(0, 5)) {
      console.log(`  - ${it.titulo}`);
      console.log(`    ${it.url}`);
    }
    return itens.length;
  } catch (e) {
    console.log(`FALHOU — ${e.name}: ${e.message}`);
    return 0;
  }
}

const Q = "web scraping etica";

// DuckDuckGo: resultados em <a class="result__a" href="//duckduckgo.com/l/?uddg=...">
// ou (lite) <a class="result-link" href="...">. O destino real vem em uddg=, URL-encoded.
function extrairDdg(texto) {
  const out = [];
  const links = [...texto.matchAll(/<a[^>]+class="[^"]*result(?:__a|-link)[^"]*"[^>]+href="([^"]+)"/gi)];
  const titulos = [...texto.matchAll(/<a[^>]+class="[^"]*result(?:__a|-link)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)];
  const achados = [];
  for (const m of texto.matchAll(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*result(?:__a|-link)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    achados.push({ href: m[1], bruto: m[2] });
  }
  for (const m of texto.matchAll(/<a[^>]+class="[^"]*result(?:__a|-link)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    achados.push({ href: m[1], bruto: m[2] });
  }
  const vistos = new Set();
  for (const a of achados) {
    let href = a.href.replace(/&amp;/g, "&");
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (!/^https?:/.test(href)) continue;
    if (vistos.has(href)) continue;
    vistos.add(href);
    const titulo = a.bruto.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    out.push({ titulo: titulo || "(sem titulo)", url: href });
  }
  console.log(`  [debug ddg] matches brutos: ${links.length} links / ${titulos.length} titulos / ${achados.length} pareados`);
  return out;
}

// Marginalia: resultados em <div class="result"> com <a href="/..."> interno? Ver o cru.
function extrairMarginalia(texto) {
  const out = [];
  for (const m of texto.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = m[1].replace(/&amp;/g, "&");
    const titulo = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!titulo) continue;
    out.push({ titulo, url });
  }
  console.log(`  [debug marginalia] total de <a> externos: ${out.length}`);
  return out;
}

const r1 = await testar("duckduckgo-html", `https://html.duckduckgo.com/html/?q=${encodeURIComponent(Q)}`, extrairDdg);
const r2 = await testar("duckduckgo-lite", `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(Q)}`, extrairDdg);
const r3 = await testar("marginalia", `https://search.marginalia.nu/search?query=${encodeURIComponent(Q)}`, extrairMarginalia);

console.log(`\nresumo: ddg-html=${r1} ddg-lite=${r2} marginalia=${r3}`);
