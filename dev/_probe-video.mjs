#!/usr/bin/env node
/**
 * _probe-video.mjs — levanta o caminho REAL da leitura de vídeo para desenhar
 * a ferramenta read_video com base em fatos (não em suposições).
 *
 * Tudo passa pelo transporte do PRÓPRIO projeto (fetchTextCached: IP fixado,
 * robots.txt respeitado, rotação de UA, cache, teto de bytes) — o resultado
 * reflete exatamente o que a ferramenta vai encontrar.
 *
 * Prova:
 *   1. robots.txt do youtube.com — o que vale para /watch, /oembed e /api/timedtext
 *   2. página do vídeo — ytInitialPlayerResponse: videoDetails + captionTracks
 *   3. legenda json3 — acesso e formato (preview da transcrição montada)
 *   4. oEmbed do YouTube (registro)
 *   5. (bônus) Vimeo — og tags + oEmbed discovery do caminho genérico
 *
 * Uso: node dev/_probe-video.mjs [id-ou-url-do-youtube] [url-do-vimeo]
 */
import { fetchTextCached } from "../src/fetch.mjs";
import { checarRobots } from "../src/security.mjs";

const alvo = process.argv[2] || "dQw4w9WgXcQ";
const idVideo = /^[\w-]{11}$/.test(alvo)
  ? alvo
  : (alvo.match(/[?&]v=([\w-]{11})/) || alvo.match(/youtu\.be\/([\w-]{11})/) || [])[1] || alvo;
const urlVideo = `https://www.youtube.com/watch?v=${idVideo}`;

const resumo = [];
function anotar(nome, ok, detalhe = "") {
  resumo.push(`${ok ? "PASS " : "FALHOU"}  ${nome}${detalhe ? " — " + detalhe : ""}`);
}

function secao(titulo) {
  console.log(`\n===== ${titulo} =====`);
}

/** Extrai o objeto balanceado que começa no primeiro "{" após o marcador. */
function extrairObjetoApos(texto, marcador) {
  const pos = texto.indexOf(marcador);
  if (pos === -1) return null;
  const i = texto.indexOf("{", pos + marcador.length);
  if (i === -1) return null;
  let depth = 0;
  let emString = false;
  let escape = false;
  let j = i;
  for (; j < texto.length; j++) {
    const c = texto[j];
    if (emString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') emString = false;
      continue;
    }
    if (c === '"') emString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  const bruto = texto.slice(i, j);
  try {
    return JSON.parse(bruto);
  } catch (err) {
    console.log(`  (parse do JSON falhou: ${err.message}; amostra: ${bruto.slice(0, 120)})`);
    return null;
  }
}

/** Monta blocos de transcrição: fecha em "\n" da legenda ou ao passar de N chars. */
function montarBlocos(eventos, limiteChars = 150) {
  const blocos = [];
  let buffer = "";
  let tInicio = null;
  const fechar = () => {
    const texto = buffer.replace(/\s+/g, " ").trim();
    if (texto) blocos.push({ t: Math.max(0, Math.floor((tInicio || 0) / 1000)), texto });
    buffer = "";
    tInicio = null;
  };
  for (const ev of eventos || []) {
    if (!ev.segs) {
      fechar();
      continue;
    }
    const texto = ev.segs.map((s) => s.utf8 || "").join("");
    if (!texto) continue;
    if (tInicio === null) tInicio = ev.tStartMs || 0;
    if (texto.includes("\n")) {
      buffer += texto.replace(/\n+/g, " ");
      fechar();
      continue;
    }
    buffer += texto;
    if (buffer.length >= limiteChars) fechar();
  }
  fechar();
  return blocos;
}

function formatarTempo(seg) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  const dois = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${m}:${dois(s)}`;
}

async function tentar(rotulo, fn) {
  const t0 = Date.now();
  try {
    const valor = await fn();
    console.log(`PASS ${rotulo} (${Date.now() - t0} ms)`);
    return { ok: true, valor };
  } catch (err) {
    console.log(`FALHOU ${rotulo} (${Date.now() - t0} ms): ${err.name}: ${err.message}`);
    return { ok: false, erro: err };
  }
}

console.log(`alvo: ${urlVideo}`);

// ---------- 1. robots.txt ----------
secao("1. robots.txt do youtube.com (com o transporte do projeto)");
const r1 = await tentar("GET /robots.txt", () =>
  fetchTextCached("https://www.youtube.com/robots.txt", { timeoutMs: 15000 })
);
if (r1.ok) {
  const r = r1.valor;
  console.log(`bytes: ${r.text.length} | content-type: ${r.contentType}`);
  console.log(r.text.slice(0, 12000));
  if (r.text.length > 12000) console.log(`...(cortado; total ${r.text.length})`);
  anotar("robots.txt acessível", true);
} else {
  anotar("robots.txt acessível", false, r1.erro.message);
}

for (const [rotulo, u] of [
  ["robots /watch", urlVideo],
  ["robots /oembed", `https://www.youtube.com/oembed?url=${encodeURIComponent(urlVideo)}&format=json`],
  ["robots /api/timedtext", `https://www.youtube.com/api/timedtext?v=${idVideo}&lang=en`],
]) {
  try {
    await checarRobots(u);
    console.log(`${rotulo}: PASSA (não bloqueado)`);
  } catch (err) {
    console.log(`${rotulo}: BLOQUEADO — ${err.message}`);
  }
}

// ---------- 2. página do vídeo ----------
secao("2. página do vídeo: ytInitialPlayerResponse");
const r2 = await tentar(`GET ${urlVideo}`, () => fetchTextCached(urlVideo, { timeoutMs: 20000 }));
let player = null;
if (r2.ok) {
  const { text: html, finalUrl, contentType } = r2.valor;
  console.log(`bytes: ${html.length} | finalUrl: ${finalUrl} | content-type: ${contentType}`);
  for (const marca of [
    "ytInitialPlayerResponse",
    "captionTracks",
    "ytInitialData",
    "consent.youtube.com",
    "playabilityStatus",
  ]) {
    console.log(`marcador "${marca}": ${html.includes(marca) ? "presente" : "ausente"}`);
  }
  player = extrairObjetoApos(html, "ytInitialPlayerResponse");
  if (player) {
    const vd = player.videoDetails || {};
    const mf = (player.microformat && player.microformat.playerMicroformatRenderer) || {};
    console.log(
      "videoDetails:",
      JSON.stringify(
        {
          videoId: vd.videoId,
          title: vd.title,
          author: vd.author,
          lengthSeconds: vd.lengthSeconds,
          viewCount: vd.viewCount,
          isLiveContent: vd.isLiveContent,
          keywords: (vd.keywords || []).slice(0, 5),
        },
        null,
        2
      )
    );
    console.log(
      "microformat:",
      JSON.stringify(
        {
          publishDate: mf.publishDate,
          uploadDate: mf.uploadDate,
          category: mf.category,
          isFamilySafe: mf.isFamilySafe,
          ownerChannelName: mf.ownerChannelName,
        },
        null,
        2
      )
    );
    const tracks =
      ((player.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || [];
    console.log(`captionTracks: ${tracks.length}`);
    for (const t of tracks) {
      const nome =
        (t.name && (t.name.simpleText || (t.name.runs || []).map((x) => x.text).join(""))) || "?";
      console.log(
        `  - lang=${t.languageCode} kind=${t.kind || "manual"} name=${nome} url=${String(
          t.baseUrl
        ).slice(0, 100)}...`
      );
    }
    anotar(
      "playerResponse com videoDetails",
      Boolean(vd.title),
      `${vd.title || "?"} / tracks ${tracks.length}`
    );
  } else {
    anotar("playerResponse com videoDetails", false, "json não extraído");
  }
} else {
  anotar("página do vídeo", false, r2.erro.message);
}

// ---------- 3. legenda json3 ----------
secao("3. legenda (json3): acesso e formato");
if (player) {
  const tracks =
    ((player.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || [];
  const pref = ["pt", "pt-BR", "en"];
  const manual = tracks.filter((t) => !t.kind);
  const escolhida = manual.find((t) => pref.includes(t.languageCode)) || manual[0] || tracks[0];
  if (escolhida) {
    const urlLegenda = /fmt=/.test(escolhida.baseUrl)
      ? escolhida.baseUrl.replace(/fmt=[^&]*/, "fmt=json3")
      : `${escolhida.baseUrl}&fmt=json3`;
    console.log(`escolhida: lang=${escolhida.languageCode} kind=${escolhida.kind || "manual"}`);
    console.log(`url (truncada): ${urlLegenda.slice(0, 140)}...`);
    const r3 = await tentar("GET legenda json3", () =>
      fetchTextCached(urlLegenda, { timeoutMs: 20000 })
    );
    if (r3.ok) {
      const corpo = r3.valor.text;
      console.log(`bytes: ${corpo.length} | content-type: ${r3.valor.contentType}`);
      console.log(`início do corpo: ${corpo.slice(0, 240).replace(/\n/g, " ")}`);
      let json = null;
      try {
        json = JSON.parse(corpo);
      } catch (e) {
        console.log(`não é JSON puro: ${e.message}`);
      }
      if (json && json.events) {
        console.log(`eventos: ${json.events.length}`);
        const blocos = montarBlocos(json.events, 150);
        console.log(`blocos montados: ${blocos.length}; primeiros 5:`);
        for (const b of blocos.slice(0, 5)) console.log(`  [${formatarTempo(b.t)}] ${b.texto}`);
        anotar("legenda json3 acessível", true, `${json.events.length} eventos`);
      } else {
        anotar("legenda json3 acessível", false, "corpo não tinha events");
      }
    }
  } else {
    console.log("nenhuma track de legenda no playerResponse");
    anotar("legenda json3 acessível", false, "sem tracks");
  }
}

// ---------- 4. oEmbed do YouTube ----------
secao("4. oEmbed do YouTube (registro)");
const urlOembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(urlVideo)}&format=json`;
const r4 = await tentar("GET /oembed", () => fetchTextCached(urlOembed, { timeoutMs: 15000 }));
if (r4.ok) console.log(r4.valor.text.slice(0, 600));

// ---------- 5. Vimeo (genérico) ----------
secao("5. (bônus) genérico: Vimeo — og tags + oEmbed discovery");
const alvoVimeo = process.argv[3] || "https://vimeo.com/76979871";
const r5 = await tentar(`GET ${alvoVimeo}`, () =>
  fetchTextCached(alvoVimeo, { timeoutMs: 20000 })
);
if (r5.ok) {
  const html = r5.valor.text;
  console.log(`bytes: ${html.length} | finalUrl: ${r5.valor.finalUrl}`);
  const metas = [
    ...html.matchAll(/<meta[^>]+(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["'][^>]*>/gi),
  ];
  for (const m of metas.slice(0, 20)) console.log(`  ${m[0].slice(0, 160)}`);
  const disc = html.match(/<link[^>]+type=["']application\/json\+oembed["'][^>]*>/i);
  console.log(`oEmbed discovery: ${disc ? disc[0] : "ausente"}`);
  if (disc) {
    const href = (disc[0].match(/href=["']([^"']+)["']/i) || [])[1];
    if (href) {
      const abs = new URL(href.replace(/&amp;/g, "&"), r5.valor.finalUrl).href;
      const r5b = await tentar("GET oEmbed endpoint", () =>
        fetchTextCached(abs, { timeoutMs: 15000 })
      );
      if (r5b.ok) console.log(r5b.valor.text.slice(0, 800));
    }
  }
}

// ---------- resumo ----------
secao("resumo");
for (const linha of resumo) console.log(linha);
