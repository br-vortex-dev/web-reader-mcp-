#!/usr/bin/env node
/**
 * _probe-video4.mjs — fecha as pendências do desenho:
 *   A. Vimeo: baixar UMA legenda (captions.vimeo.com) — robots + corpo VTT real
 *   B. Vimeo: metadados no config do player (video/owner) + og da página
 *   C. MDN friday.vtt: robots
 *   D. YouTube: shortDescription existe no videoDetails?
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

console.log("=== A. Vimeo legenda: robots + download VTT ===");
const cfg = await get("https://player.vimeo.com/video/76979871/config");
let trackUrl = null;
if (cfg.ok) {
  const j = JSON.parse(cfg.text);
  const tracks = (j.request && j.request.text_tracks) || [];
  console.log(`text_tracks: ${tracks.length}`);
  for (const t of tracks) console.log(`  lang=${t.lang} kind=${t.kind} label=${t.label} prov=${t.provenance}`);
  const en = tracks.find((t) => t.lang === "en") || tracks[0];
  trackUrl = en && en.url;
}
if (trackUrl) {
  console.log(`\n-> track escolhida: ${trackUrl.slice(0, 110)}...`);
  try {
    await checarRobots(trackUrl);
    console.log("robots captions.vimeo.com: PASSA");
  } catch (e) {
    console.log(`robots captions.vimeo.com: BLOQUEADO — ${e.message.split("Defina")[0].trim()}`);
  }
  const vtt = await get(trackUrl);
  console.log(
    vtt.ok
      ? `download: OK ct=${vtt.contentType} bytes=${vtt.text.length}\n--- primeiras linhas ---\n${vtt.text.slice(0, 700)}`
      : `download: FALHOU ${vtt.nome}: ${vtt.erro}`
  );
}

console.log("\n=== B. Vimeo metadados ===");
if (cfg.ok) {
  const j = JSON.parse(cfg.text);
  console.log("video:", JSON.stringify(j.video).slice(0, 900));
  console.log("\nowner:", JSON.stringify(j.owner || (j.video && j.video.owner)).slice(0, 300));
  console.log("\nview:", JSON.stringify(j.view).slice(0, 200));
}
const pg = await get("https://vimeo.com/76979871");
if (pg.ok) {
  console.log(`\npágina: ${pg.text.length} bytes`);
  const metas = [...pg.text.matchAll(/<meta[^>]+>/gi)].map((m) => m[0]);
  const relevantes = metas.filter((m) =>
    /og:title|og:description|og:image|og:video|og:site_name|og:type|duration|itemprop|twitter:title|twitter:description/i.test(m)
  );
  for (const m of relevantes.slice(0, 20)) console.log("  " + m.slice(0, 220));
  console.log(`\n(og:duration tem? ${pg.text.includes("duration") ? "sim" : "nao"})`);
}

console.log("\n=== C. robots do friday.vtt (MDN) ===");
try {
  await checarRobots("https://interactive-examples.mdn.mozilla.net/media/examples/friday.vtt");
  console.log("PASSA");
} catch (e) {
  console.log(`BLOQUEADO — ${e.message.split("Defina")[0].trim()}`);
}

console.log("\n=== D. YouTube shortDescription ===");
const yt = await get("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
if (yt.ok) {
  const pos = yt.text.indexOf("ytInitialPlayerResponse");
  const i = yt.text.indexOf("{", pos + 25);
  let depth = 0, emString = false, escape = false, j = i;
  for (; j < yt.text.length; j++) {
    const c = yt.text[j];
    if (emString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') emString = false;
      continue;
    }
    if (c === '"') emString = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { j++; break; } }
  }
  try {
    const player = JSON.parse(yt.text.slice(i, j));
    const vd = player.videoDetails || {};
    console.log("shortDescription?", vd.shortDescription ? `sim (${vd.shortDescription.length} chars)` : "NÃO");
    console.log("thumbnail:", JSON.stringify((vd.thumbnail || {}).thumbnails?.slice(-1)[0]).slice(0, 200));
    console.log("descrição (início):", String(vd.shortDescription || "").slice(0, 200).replace(/\n/g, " / "));
    console.log("playabilityStatus:", JSON.stringify(player.playabilityStatus || {}).slice(0, 200));
  } catch (e) {
    console.log("parse falhou:", e.message);
  }
}

console.log("\nfim do diagnóstico 4.");
