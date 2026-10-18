#!/usr/bin/env node
/**
 * _probe-video6.mjs — as últimas cartadas para melhorar o YouTube no read_video.
 *
 * Responde com fatos, antes de qualquer plano:
 *   A) robots.txt: quais rotas candidatas o YouTube libera? (embed, shorts, playlist)
 *   B) legenda: resta alguma forma de o YouTube servir a transcrição anônima?
 *      (última varredura de hosts/formatos — o corpo vazio já foi provado em
 *      _probe-legenda e _probe-legenda2)
 *   C) páginas alternativas (embed/nocookie): trazem metadados que a oEmbed não
 *      tem (descrição, duração)? É o candidato a enriquecer o fallback do
 *      Render, onde a /watch dá 429.
 *   D) capítulos: a página /watch traz os capítulos no ytInitialData? (dá para
 *      entregar "Capitulos:" no read_video sem nenhuma chamada extra?)
 *
 * Uso: node dev/_probe-video6.mjs [id]
 */
process.env.ROBOTS_RESPECT = "0"; // só AQUI: enxergar o comportamento cru dos endpoints

const { fetchTextCached } = await import("../src/fetch.mjs");
const { checarRobots } = await import("../src/security.mjs");
const { extrairObjetoApos } = await import("../src/video.mjs");

const id = process.argv[2] || "dQw4w9WgXcQ";
const rec = (t, n = 110) => String(t || "").replace(/\s+/g, " ").slice(0, n);

/* ---------- A. robots.txt das rotas candidatas ---------- */
console.log("== A. robots.txt das rotas candidatas ==");
for (const [rot, url] of [
  ["/watch (controle)", `https://www.youtube.com/watch?v=${id}`],
  ["/embed/<id>", `https://www.youtube.com/embed/${id}`],
  ["/embed nocookie", `https://www.youtube-nocookie.com/embed/${id}`],
  ["/shorts/<id>", `https://www.youtube.com/shorts/${id}`],
  ["/playlist", "https://www.youtube.com/playlist?list=PL0000000000000000000"],
  ["/oembed (controle)", `https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`],
]) {
  try {
    await checarRobots(url);
    console.log(`PASSA     ${rot}`);
  } catch (err) {
    console.log(`BLOQUEADO ${rot} — ${String(err.message).split("Defina")[0].trim()}`);
  }
}

/* ---------- B. legenda: últimas formas de pedir ---------- */
console.log("\n== B. legenda: últimas formas de pedir (corpo vazio confirma fechamento) ==");
let base = null;
let lang = "en";
try {
  const pg = await fetchTextCached(`https://www.youtube.com/watch?v=${id}`, { timeoutMs: 20000 });
  const player = extrairObjetoApos(pg.text, "ytInitialPlayerResponse");
  const tracks = (((player || {}).captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || [];
  const t = tracks.find((x) => x.languageCode === "en" && !x.kind) || tracks[0];
  if (t) {
    base = t.baseUrl;
    lang = t.languageCode || "en";
    console.log(`faixa usada: ${t.languageCode}/${t.kind || "manual"} (${tracks.length} faixas na página)`);
  } else {
    console.log("a página não listou faixas de legenda");
  }
} catch (err) {
  console.log(`página falhou: ${err.message.split(" (")[0]}`);
}

const variantes = [];
if (base) {
  variantes.push([
    "baseUrl + fmt=json3",
    /fmt=/.test(base) ? base.replace(/fmt=[^&]*/, "fmt=json3") : `${base}&fmt=json3`,
  ]);
  variantes.push(["baseUrl + c=WEB&cver", `${base}&c=WEB&cver=2.20260101.00.00`]);
}
variantes.push([
  "www /timedtext (sem /api)",
  `https://www.youtube.com/timedtext?v=${id}&lang=${lang}&fmt=json3`,
]);
variantes.push([
  "nocookie /api/timedtext",
  `https://www.youtube-nocookie.com/api/timedtext?v=${id}&lang=${lang}&fmt=json3`,
]);

for (const [rot, url] of variantes) {
  try {
    const r = await fetchTextCached(url, { timeoutMs: 15000, retries: 0 });
    const b = r.text || "";
    console.log(`${rot}: ${b.length} bytes${b.length ? " | " + rec(b, 90) : " (VAZIO — segue fechado)"}`);
  } catch (err) {
    console.log(`${rot}: FALHOU ${err.name}: ${String(err.message).split(" (")[0]}`);
  }
}

/* ---------- C. páginas alternativas: o que o embed traz? ---------- */
console.log("\n== C. páginas alternativas (embed/nocookie): metadados aproveitáveis? ==");
for (const [rot, url] of [
  ["www /embed", `https://www.youtube.com/embed/${id}`],
  ["nocookie /embed", `https://www.youtube-nocookie.com/embed/${id}`],
]) {
  try {
    const r = await fetchTextCached(url, { timeoutMs: 20000 });
    const t = r.text || "";
    const titulo = (t.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
    const og = {};
    for (const m of t.matchAll(/<meta[^>]+(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["'][^>]*>/gi)) {
      const c = m[0].match(/content=["']([^"']*)["']/i);
      if (c && !(m[1] in og)) og[m[1]] = rec(c[1], 90);
    }
    const itemprops = [...new Set([...t.matchAll(/<meta[^>]+itemprop=["']([^"']+)["']/gi)].map((m) => m[1]))];
    const sinais = {
      playerResponse: t.includes("ytInitialPlayerResponse"),
      videoDetails: t.includes('"videoDetails"'),
      lengthSeconds: t.includes('"lengthSeconds"'),
      viewCount: t.includes('"viewCount"'),
      shortDescription: t.includes('"shortDescription"'),
      ytInitialData: t.includes("ytInitialData"),
    };
    console.log(`\n${rot}: ${t.length} bytes | ct=${r.contentType || "?"}`);
    console.log(`  <title>: ${rec(titulo, 100) || "(vazio)"}`);
    console.log(`  og/twitter: ${Object.keys(og).join(", ") || "(nenhum)"}`);
    for (const k of ["og:title", "og:description", "og:image", "og:video:duration"]) {
      if (og[k]) console.log(`  ${k}: ${og[k]}`);
    }
    if (itemprops.length) console.log(`  itemprop: ${itemprops.slice(0, 8).join(", ")}`);
    console.log(`  sinais: ${Object.entries(sinais).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  } catch (err) {
    console.log(`\n${rot}: FALHOU ${err.name}: ${String(err.message).split(" (")[0]}`);
  }
}

/* ---------- D. capítulos no ytInitialData ---------- */
console.log("\n== D. capítulos no ytInitialData (sem chamada extra) ==");

function capitulosDe(inicial) {
  const mm =
    inicial?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer
      ?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap;
  const caps = [];
  if (Array.isArray(mm)) {
    for (const marker of mm) {
      const lista = marker?.value?.chapters;
      if (Array.isArray(lista)) caps.push(...lista);
    }
  }
  return caps.map((c) => {
    const cr = c?.chapterRenderer || {};
    const titulo = cr.title?.simpleText || (cr.title?.runs || []).map((r) => r.text).join("") || "";
    return { seg: Math.floor((Number(cr.timeRangeStartMillis) || 0) / 1000), titulo };
  });
}

for (const [rot, vid] of [
  ["3Blue1Brown", "aircAruvnKk"],
  ["freeCodeCamp Python", "rfscVS0vtbw"],
  ["controle (Rick)", "dQw4w9WgXcQ"],
]) {
  try {
    const r = await fetchTextCached(`https://www.youtube.com/watch?v=${vid}`, { timeoutMs: 25000 });
    const inicial = extrairObjetoApos(r.text, "ytInitialData");
    const caps = inicial ? capitulosDe(inicial) : [];
    console.log(
      `\n${rot} (${vid}): ytInitialData=${inicial ? "sim" : "nao"} | "chapters" no HTML=${
        r.text.includes('"chapters"') ? "sim" : "nao"
      } | itens=${caps.length}`
    );
    for (const c of caps.slice(0, 6)) console.log(`   - [${c.seg}s] ${rec(c.titulo, 70)}`);
  } catch (err) {
    console.log(`\n${rot}: FALHOU ${err.message.split(" (")[0]}`);
  }
}

console.log("\nfim do probe 6.");
