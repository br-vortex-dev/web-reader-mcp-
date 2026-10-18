#!/usr/bin/env node
/**
 * _probe-video7.mjs — /shorts é uma rota útil quando /watch é recusada?
 *
 * Contexto: no Render a página /watch devolve 429 (IP de datacenter). O
 * robots.txt do YouTube LIBERA /shorts/<id> (provado em _probe-video6). A
 * pergunta desta sondagem: a página do short traz o mesmo
 * ytInitialPlayerResponse (título, canais, duração, legendas) para um id
 * qualquer — inclusive de vídeo que não é short?
 *
 * Se sim, ela é candidata a rota de reserva na cascata do lerYouTube.
 *
 * Usa o transporte do projeto (fetchTextCached) — o mesmo que o servidor usa.
 *
 * Uso: node dev/_probe-video7.mjs
 */
import { fetchTextCached } from "../src/fetch.mjs";
import { extrairObjetoApos } from "../src/video.mjs";

const alvos = [
  ["video comum (Rick Astley)", "dQw4w9WgXcQ"],
  ["video comum (3Blue1Brown)", "aircAruvnKk"],
  ["atribuido a shorts (Me at the zoo)", "jNQXAC9IVRw"],
];

for (const [rotulo, id] of alvos) {
  for (const [rota, url] of [
    ["/shorts", `https://www.youtube.com/shorts/${id}`],
    ["/watch (controle)", `https://www.youtube.com/watch?v=${id}`],
  ]) {
    const t0 = Date.now();
    try {
      const r = await fetchTextCached(url, { timeoutMs: 20000 });
      const p = extrairObjetoApos(r.text, "ytInitialPlayerResponse");
      const vd = (p && p.videoDetails) || {};
      const tracks =
        ((p || {}).captions || {}).playerCaptionsTracklistRenderer || {};
      const nTracks = (tracks.captionTracks || []).length;
      const status = ((p || {}).playabilityStatus || {}).status || "?";
      console.log(
        `\n[${rota} / ${rotulo}] ${Date.now() - t0} ms | ${r.text.length} bytes\n` +
          `  url final: ${r.finalUrl}\n` +
          `  player=${Boolean(p)} | status=${status} | titulo=${vd.title ? "sim" : "nao"} | ` +
          `duracao=${vd.lengthSeconds || "?"}s | tracks=${nTracks}`
      );
      if (vd.title) console.log(`  titulo: ${String(vd.title).slice(0, 80)}`);
    } catch (err) {
      console.log(`\n[${rota} / ${rotulo}] FALHOU ${err.name}: ${String(err.message).split(" (")[0]}`);
    }
  }
}

console.log("\nfim do probe 7.");
