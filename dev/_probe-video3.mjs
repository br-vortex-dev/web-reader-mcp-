#!/usr/bin/env node
/**
 * _probe-video3.mjs — fecha o desenho da transcrição:
 *   A. Vimeo: onde vivem as text_tracks no config do player?
 *   B. Genérico: candidatos reais de página/VTT com <track> (MDN, Wikimedia)
 *   C. oEmbed Vimeo via curl (o nosso transporte deu 404 — é do site?)
 */
import { spawnSync } from "node:child_process";
import { fetchTextCached } from "../src/fetch.mjs";

function acharChaves(obj, alvo, caminho = "", achados = [], prof = 0) {
  if (prof > 12 || achados.length > 20) return achados;
  if (obj === null || typeof obj !== "object") return achados;
  for (const [k, v] of Object.entries(obj)) {
    const p = caminho ? `${caminho}.${k}` : k;
    if (k.toLowerCase().includes(alvo)) {
      achados.push(`${p} = ${JSON.stringify(v).slice(0, 220)}`);
    }
    acharChaves(v, alvo, p, achados, prof + 1);
  }
  return achados;
}

async function get(url, timeoutMs = 20000) {
  try {
    const r = await fetchTextCached(url, { timeoutMs });
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, nome: err.name, erro: err.message };
  }
}

console.log("=== A. Vimeo config: onde estão as text_tracks ===");
const cfg = await get("https://player.vimeo.com/video/76979871/config");
if (!cfg.ok) {
  console.log(`FALHOU: ${cfg.nome}: ${cfg.erro}`);
} else {
  try {
    const j = JSON.parse(cfg.text);
    const achados = acharChaves(j, "text_track");
    console.log(`ocorrências de "text_track": ${achados.length}`);
    for (const a of achados.slice(0, 10)) console.log("  " + a);
    const reqKeys = Object.keys(j.request || {});
    console.log("request chaves:", reqKeys.join(", "));
    if (j.request && j.request.text_tracks) {
      console.log("request.text_tracks:", JSON.stringify(j.request.text_tracks).slice(0, 600));
    }
    if (j.video && j.video.text_tracks) {
      console.log("video.text_tracks:", JSON.stringify(j.video.text_tracks).slice(0, 600));
    }
  } catch (e) {
    console.log(`parse falhou: ${e.message}`);
  }
}

console.log("\n=== B. Candidatos de VTT/track reais ===");
const candidatos = [
  ["MDN friday.vtt", "https://interactive-examples.mdn.mozilla.net/media/examples/friday.vtt"],
  ["MDN track example", "https://interactive-examples.mdn.mozilla.net/pages/tabbed/track.html"],
  ["MDN dom-examples vtt", "https://mdn.github.io/dom-examples/track/track.vtt"],
  ["MDN learning-area rabbit", "https://mdn.github.io/learning-area/html/multimedia-and-embedding/video-and-audio-content/rabbit320.mp4"],
];
for (const [rotulo, u] of candidatos) {
  const r = await get(u);
  console.log(
    `\n[${rotulo}] ${u}\n-> ${
      r.ok
        ? `OK ct=${r.contentType} ${r.text.length}b | ${r.text.slice(0, 160).replace(/\n/g, " / ")}`
        : `FALHOU ${r.nome}: ${r.erro.split("(")[0]}`
    }`
  );
}

console.log("\n=== B2. Página MDN docs com <video><track> embutido ===");
const paginas = [
  "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/track",
  "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video",
];
for (const p of paginas) {
  const r = await get(p);
  if (!r.ok) {
    console.log(`\n${p}\n-> FALHOU ${r.nome}: ${r.erro.split("(")[0]}`);
    continue;
  }
  const tracks = [...r.text.matchAll(/<track[^>]*>/gi)].map((m) => m[0]);
  const srcs = [...r.text.matchAll(/<track[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  console.log(`\n${p}\n-> OK ${r.text.length}b | <track>: ${tracks.length} | srcs: ${srcs.length}`);
  for (const s of srcs.slice(0, 5)) console.log(`   src: ${s}`);
  for (const t of tracks.slice(0, 4)) console.log(`   ${t.slice(0, 180)}`);
}

console.log("\n=== C. oEmbed Vimeo via curl ===");
for (const u of [
  "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871",
  "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871&width=640",
]) {
  const r = spawnSync(
    "curl.exe",
    ["-s", "-o", "NUL", "-w", "HTTP %{http_code} | ct=%{content_type} | bytes=%{size_download}", "-A",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", u],
    { encoding: "utf8" }
  );
  console.log(`${u}\n-> ${String(r.stdout || "").trim()} ${r.error ? "ERR " + r.error.message : ""}`);
}

console.log("\nfim do diagnóstico 3.");
