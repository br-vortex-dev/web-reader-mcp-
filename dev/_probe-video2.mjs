#!/usr/bin/env node
/**
 * _probe-video2.mjs — caminhos de TRANSCRIÇÃO fora do YouTube + metadados genéricos.
 *
 *   1. Vimeo — oEmbed (variantes) e o config público do player (text_tracks)
 *   2. Vimeo — metas da página (duration/itemprop/og)
 *   3. Genérico — página com <video><track ...> (MDN learning-area): achar, buscar e ler o VTT
 *   4. robots.txt dos hosts envolvidos
 *
 * Tudo pelo transporte do projeto (IP fixado, robots respeitado, cache, teto).
 * Uso: node dev/_probe-video2.mjs
 */
import { fetchTextCached } from "../src/fetch.mjs";
import { checarRobots } from "../src/security.mjs";

async function get(url, timeoutMs = 20000) {
  try {
    const r = await fetchTextCached(url, { timeoutMs });
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, nome: err.name, erro: err.message };
  }
}

console.log("=== 1. Vimeo oEmbed (variantes) ===");
for (const u of [
  "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871",
  "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871&width=640",
  "https://vimeo.com/api/oembed?url=https%3A%2F%2Fvimeo.com%2F76979871&format=json",
]) {
  const r = await get(u);
  console.log(
    `\n${u}\n-> ${
      r.ok
        ? `OK ${r.contentType} ${r.text.length}b | ${r.text.slice(0, 220).replace(/\n/g, " ")}`
        : `FALHOU ${r.nome}: ${r.erro.split("(")[0]}`
    }`
  );
}

console.log("\n=== 1b. Vimeo player config (text_tracks?) ===");
const cfg = await get("https://player.vimeo.com/video/76979871/config");
if (cfg.ok) {
  console.log(`content-type: ${cfg.contentType} | bytes: ${cfg.text.length}`);
  for (const marca of ["text_tracks", "captions", "subtitles"]) {
    console.log(`marcador "${marca}": ${cfg.text.includes(marca) ? "presente" : "ausente"}`);
  }
  try {
    const j = JSON.parse(cfg.text);
    console.log("chaves topo:", Object.keys(j).slice(0, 60).join(", "));
    const files = (j.request && j.request.files) || {};
    console.log("request.files chaves:", Object.keys(files).join(", "));
    const tt = files.text_tracks || j.text_tracks || null;
    console.log("text_tracks:", JSON.stringify(tt).slice(0, 800));
  } catch (e) {
    console.log(`não parseou como JSON: ${e.message}`);
    console.log(cfg.text.slice(0, 300).replace(/\n/g, " "));
  }
} else {
  console.log(`FALHOU ${cfg.nome}: ${cfg.erro}`);
}

console.log("\n=== 2. Vimeo página: metas relevantes ===");
const pg = await get("https://vimeo.com/76979871");
if (pg.ok) {
  const linhas = pg.text
    .split(/></)
    .map((s) => s.replace(/^\s+/, ""))
    .filter((s) => /meta|link/.test(s))
    .filter((s) => /duration|itemprop|og:video|og:title|og:description|og:image|og:site|oembed|ld\+json/i.test(s));
  for (const l of linhas.slice(0, 25)) console.log("  " + l.slice(0, 200));
} else {
  console.log(`FALHOU: ${pg.erro}`);
}

console.log("\n=== 3. Genérico: MDN learning-area (tem <video><track>?) ===");
const candidatos = [
  "https://mdn.github.io/learning-area/html/multimedia-and-embedding/video-and-audio-content/",
  "https://mdn.github.io/dom-examples/media/video/",
];
let achouVtt = false;
for (const cu of candidatos) {
  const mdn = await get(cu);
  if (!mdn.ok) {
    console.log(`\n${cu}\n-> FALHOU ${mdn.nome}: ${mdn.erro.split("(")[0]}`);
    continue;
  }
  const tracks = [...mdn.text.matchAll(/<track[^>]*>/gi)].map((m) => m[0]);
  console.log(`\n${cu}\n-> OK ${mdn.contentType} ${mdn.text.length}b | <track>: ${tracks.length}`);
  for (const t of tracks.slice(0, 6)) console.log("   " + t);
  const src = (mdn.text.match(/<track[^>]+src=["']([^"']+)["']/i) || [])[1];
  if (src) {
    const abs = new URL(src.replace(/&amp;/g, "&"), mdn.finalUrl).href;
    console.log(`   src -> ${abs}`);
    try {
      await checarRobots(abs);
      console.log("   robots: PASSA");
    } catch (e) {
      console.log(`   robots: BLOQUEADO — ${e.message.split("Defina")[0].trim()}`);
    }
    const vtt = await get(abs);
    if (vtt.ok) {
      console.log(`   OK ${vtt.contentType} ${vtt.text.length}b; primeiras linhas:`);
      console.log(
        vtt.text
          .slice(0, 500)
          .split("\n")
          .map((l) => "     " + l)
          .join("\n")
      );
      achouVtt = true;
    } else {
      console.log(`   FALHOU ${vtt.nome}: ${vtt.erro.split("(")[0]}`);
    }
    break;
  }
}
if (!achouVtt) console.log("\n(nenhum VTT real encontrado nos candidatos — a fixture local cobre o caminho)");

console.log("\n=== 4. robots dos hosts ===");
for (const u of [
  "https://player.vimeo.com/video/76979871/config",
  "https://vimeo.com/api/oembed.json",
  "https://vimeo.com/76979871",
  "https://mdn.github.io/learning-area/html/multimedia-and-embedding/video-and-audio-content/",
]) {
  await checarRobots(u).then(
    () => console.log(`PASSA     ${u}`),
    (e) => console.log(`BLOQUEADO ${u} — ${e.message.split("Defina")[0].trim()}`)
  );
}

console.log("\nfim do diagnóstico 2.");
