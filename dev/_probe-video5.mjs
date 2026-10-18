#!/usr/bin/env node
/**
 * _probe-video5.mjs — alternativas de página do YouTube (CONTEÚDO, local).
 *
 * A página /watch do www pode responder 429 para IPs de datacenter (visto no
 * Render). Antes de montar a cascata de fallback, este probe responde:
 * quais rotas alternativas trazem ytInitialPlayerResponse (com título e
 * captionTracks) e quais o robots.txt libera?
 *
 * Rotas: www/watch, m/watch, www/embed, www-nocookie/embed.
 *
 * Uso: node dev/_probe-video5.mjs
 */
import { fetchTextCached } from "../src/fetch.mjs";
import { extrairObjetoApos } from "../src/video.mjs";

const id = "dQw4w9WgXcQ";
const alvos = [
  ["www watch", `https://www.youtube.com/watch?v=${id}`],
  ["m watch", `https://m.youtube.com/watch?v=${id}`],
  ["www embed", `https://www.youtube.com/embed/${id}`],
  ["nocookie embed", `https://www.youtube-nocookie.com/embed/${id}`],
];

for (const [rotulo, url] of alvos) {
  const t0 = Date.now();
  try {
    const r = await fetchTextCached(url, { timeoutMs: 20000 });
    const p = extrairObjetoApos(r.text, "ytInitialPlayerResponse");
    const vd = p && p.videoDetails;
    const tracks = ((p || {}).captions || {}).playerCaptionsTracklistRenderer || {};
    console.log(
      `\n[${rotulo}] ${Date.now() - t0} ms | ${r.text.length} bytes | player=${Boolean(p)} | ` +
        `titulo=${vd && vd.title ? "sim" : "nao"} | tracks=${(tracks.captionTracks || []).length}`
    );
    if (vd && vd.title) console.log(`   título: ${vd.title}`);
  } catch (e) {
    console.log(`\n[${rotulo}] ${Date.now() - t0} ms | FALHOU ${e.name}: ${e.message.split(" (")[0]}`);
  }
}

console.log("\nfim do probe 5.");
