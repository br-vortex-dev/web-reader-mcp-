#!/usr/bin/env node
/**
 * _probe-innertube.mjs — o InnerTube (/youtubei/v1/player) é uma porta ainda
 * aberta do YouTube fora da página /watch?
 *
 * Contexto: no Render a /watch responde 429 (IP de datacenter) e o read_video
 * cai no oEmbed — que não tem duração, views, descrição nem faixas de legenda.
 * O InnerTube é o endpoint que o próprio player usa para carregar o vídeo.
 *
 * Responde:
 *   1. O robots.txt permite /youtubei/? (controle: /api/timedtext bloqueado)
 *   2. GET no endpoint -> esperado 405 (é POST)
 *   3. POST cliente WEB -> devolve videoDetails completo? captionTracks?
 *   4. POST cliente ANDROID -> responde melhor?
 *   5. Se vier captionTracks: onde mora o download, e o corpo ainda é vazio?
 *      (o corpo vazio anônimo já foi provado em _probe-legenda*.mjs)
 *
 * NOTA: sondagem de ROTA — usa o fetch global de propósito: o transporte do
 * projeto é GET-only, e aqui a pergunta é se a rota responde (a fidelidade de
 * transporte fica para outra sondagem, se o caminho valer).
 *
 * Uso: node dev/_probe-innertube.mjs [id]
 */
import { checarRobots } from "../src/security.mjs";

const id = process.argv[2] || "dQw4w9WgXcQ";
const KEY_WEB = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT = 20000;

/* ---------- 1. robots.txt ---------- */
console.log("== 1. robots.txt do youtube.com ==");
for (const [rotulo, url] of [
  ["/youtubei/v1/player", `https://www.youtube.com/youtubei/v1/player?key=${KEY_WEB}`],
  ["/api/timedtext (controle)", `https://www.youtube.com/api/timedtext?v=${id}&lang=en`],
  ["/oembed (controle)", `https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`],
]) {
  try {
    await checarRobots(url);
    console.log(`PASSA     ${rotulo}`);
  } catch (err) {
    console.log(`BLOQUEADO ${rotulo} — ${String(err.message).split("Defina")[0].trim()}`);
  }
}

/* ---------- 2. GET ---------- */
console.log("\n== 2. GET /youtubei/v1/player ==");
try {
  const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${KEY_WEB}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const t = await r.text();
  console.log(`HTTP ${r.status} (esperado 405 — o endpoint é POST) | ${t.length} bytes`);
} catch (err) {
  console.log(`falha: ${err.message}`);
}

/* ---------- 3/4. POST por cliente ---------- */
async function postPlayer(rotulo, client) {
  const body = {
    videoId: id,
    context: { client },
    contentCheckOk: true,
    racyCheckOk: true,
  };
  try {
    const r = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${KEY_WEB}&prettyPrint=false`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": UA,
          "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
          origin: "https://www.youtube.com",
          referer: `https://www.youtube.com/watch?v=${id}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT),
      }
    );
    const texto = await r.text();
    console.log(`\n== ${rotulo}: HTTP ${r.status} | ${texto.length} bytes ==`);
    let j = null;
    try {
      j = JSON.parse(texto);
    } catch {
      console.log(`  corpo (não-JSON): ${texto.slice(0, 160).replace(/\s+/g, " ")}`);
      return null;
    }
    const vd = j.videoDetails || {};
    const ps = j.playabilityStatus || {};
    const tracks = ((j.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || [];
    console.log(`  playabilityStatus: ${ps.status || "?"}`);
    console.log(`  titulo: ${vd.title || "(ausente)"}`);
    console.log(
      `  canal: ${vd.author || "(ausente)"} | duracao: ${vd.lengthSeconds || "?"}s | views: ${vd.viewCount || "?"}`
    );
    console.log(`  descricao: ${(vd.shortDescription || "").length} caracteres`);
    console.log(`  captionTracks: ${tracks.length}`);
    if (tracks.length) {
      const t = tracks[0];
      const host = (() => {
        try {
          const u = new URL(t.baseUrl);
          return `${u.host}${u.pathname}`;
        } catch {
          return "(url inválida)";
        }
      })();
      console.log(`    primeira faixa: ${t.languageCode || "?"}/${t.kind || "manual"} -> ${host}`);
      return t.baseUrl;
    }
    return null;
  } catch (err) {
    console.log(`\n== ${rotulo}: FALHOU ${err.message} ==`);
    return null;
  }
}

console.log("\n== 3. cliente WEB ==");
const baseWeb = await postPlayer("POST WEB", {
  clientName: "WEB",
  clientVersion: "2.20240304.00.00",
  hl: "pt",
  gl: "BR",
});

console.log("\n== 4. cliente ANDROID ==");
await postPlayer("POST ANDROID", {
  clientName: "ANDROID",
  clientVersion: "19.09.37",
  androidSdkVersion: 30,
  hl: "pt",
  gl: "BR",
});

/* ---------- 5. o download da legenda segue vazio? ---------- */
if (baseWeb) {
  console.log("\n== 5. download da legenda (SEM robots, só para constatar o corpo) ==");
  const alvo = /fmt=/.test(baseWeb) ? baseWeb.replace(/fmt=[^&]*/, "fmt=json3") : `${baseWeb}&fmt=json3`;
  try {
    const r = await fetch(alvo, {
      headers: { "user-agent": UA, "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const b = await r.text();
    console.log(`HTTP ${r.status} | ${b.length} bytes | ${b.slice(0, 120).replace(/\s+/g, " ") || "(VAZIO)"}`);
  } catch (err) {
    console.log(`falha: ${err.message}`);
  }
}

console.log("\nfim do probe InnerTube.");
