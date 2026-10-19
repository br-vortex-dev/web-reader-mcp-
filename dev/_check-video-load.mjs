#!/usr/bin/env node
/**
 * _check-video-load.mjs — fumaça do módulo de vídeo (sem rede).
 * Carrega src/video.mjs, src/tools.mjs e src/tool-schemas.mjs e exercita as
 * funções puras: detecção de plataforma, extração de JSON balanceado,
 * conversão de legendas (VTT/SRT/json3), escolha de faixa por idioma,
 * metadados sintéticos nos formatos reais, schema e despacho.
 *
 * Uso: node dev/_check-video-load.mjs
 */
import {
  detectarVideo,
  youtubeIdDe,
  vimeoDe,
  extrairObjetoApos,
  converterVtt,
  converterJson3,
  converterLegenda,
  escolherTrack,
  segundosDeDuracao,
  formatarTempo,
  formatarNumero,
  procurarEmbedDeVideo,
  metadadosYouTube,
  metadadosVimeo,
  metadadosPagina,
} from "../src/video.mjs";
import { callTool } from "../src/tools.mjs";
import { TOOLS } from "../src/tool-schemas.mjs";

let ok = 0;
let fail = 0;
const t = (rotulo, cond, extra = "") => {
  if (cond) {
    ok++;
    console.log(`PASS ${rotulo}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`FAIL ${rotulo}${extra ? " — " + extra : ""}`);
  }
};

// --- detecção de plataforma ---
t("youtube /watch", detectarVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ").tipo === "youtube");
t("youtube youtu.be com timestamp", detectarVideo("https://youtu.be/dQw4w9WgXcQ?t=30").id === "dQw4w9WgXcQ");
t("youtube shorts", youtubeIdDe("https://www.youtube.com/shorts/abcdefghijk") === "abcdefghijk");
t("youtube music", youtubeIdDe("https://music.youtube.com/watch?v=abcdefghijk") === "abcdefghijk");
t("vimeo", detectarVideo("https://vimeo.com/76979871").tipo === "vimeo");
t(
  "vimeo player com hash",
  (() => {
    const v = vimeoDe("https://player.vimeo.com/video/76979871?h=abc123");
    return Boolean(v) && v.hash === "abc123";
  })()
);
t("legenda direta .vtt", detectarVideo("https://exemplo.com/subs/legenda.vtt").tipo === "legenda");
t("pagina comum", detectarVideo("https://exemplo.com/noticia").tipo === "pagina");

// --- extração de objeto balanceado (o JSON do YouTube tem chaves dentro de strings) ---
const eo = extrairObjetoApos('var x = {"a":"}{","b":{"c":1},"d":[1,2]};', "var x =");
t("objeto balanceado", Boolean(eo) && eo.b.c === 1 && eo.a === "}{" && eo.d.length === 2);

// --- VTT ---
const vtt =
  "WEBVTT\n\n1\n00:00:05.237 --> 00:00:08.043\n<i>Ola, mundo.</i>\n\n2\n00:00:08.043 --> 00:00:11.022\nSegunda fala aqui.\n";
const cv = converterVtt(vtt);
t("vtt: cues e blocos", cv.cues === 2 && cv.blocos.length === 2, `cues=${cv.cues} blocos=${cv.blocos.length}`);
t("vtt: limpa marcação", cv.blocos.every((b) => !b.texto.includes("<i>")) && cv.blocos[0].texto === "Ola, mundo.");

// --- SRT (vírgula decimal, sem cabeçalho) ---
const srt = "1\n00:00:01,000 --> 00:00:02,500\nPrimeira.\n\n2\n00:00:03,000 --> 00:00:04,000\nSegunda.\n";
const cs = converterLegenda(srt);
t("srt converte", cs.cues === 2 && cs.blocos.length === 2);

// --- json3 ---
const json3 = JSON.stringify({
  events: [
    { tStartMs: 0, segs: [{ utf8: "Bom dia.\n" }] },
    { tStartMs: 1000, segs: [{ utf8: "Tudo bem?" }] },
    { tStartMs: 3000, segs: [{ utf8: "Terceira fala." }] },
  ],
});
const cj = converterJson3(json3);
t(
  "json3 converte",
  cj.cues === 3 && cj.blocos.length === 3,
  cj.blocos.map((b) => `${b.seg}:${b.texto}`).join(" | ")
);

// --- escolha de faixa por idioma ---
const tracks = [
  { lang: "en", kind: "asr", nome: "EN auto", url: "u1" },
  { lang: "en", kind: "manual", nome: "EN", url: "u2" },
  { lang: "pt-BR", kind: "manual", nome: "PT", url: "u3" },
];
t("prefere pt-BR", escolherTrack(tracks, ["pt-br", "pt", "en"])?.url === "u3");
t("manual ganha da automática", escolherTrack(tracks.slice(0, 2), ["en"])?.url === "u2");
t("idioma pedido manda", escolherTrack(tracks, ["en"])?.url === "u2");
t("sem tracks devolve null", escolherTrack([], ["pt"]) === null);

// --- durações e formatação ---
t("duração ISO 8601", segundosDeDuracao("PT4M13S") === 253);
t("duração numérica", segundosDeDuracao(213) === 213);
t("tempo com horas", formatarTempo(3725) === "1:02:05");
t("tempo sem horas", formatarTempo(62) === "1:02");
t("número com pontos", formatarNumero(1828046215) === "1.828.046.215");

// --- embeds ---
const eb1 = procurarEmbedDeVideo('<iframe width="560" src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="x"></iframe>');
t("embed youtube", eb1?.tipo === "youtube" && eb1.id === "dQw4w9WgXcQ");
const eb2 = procurarEmbedDeVideo('<iframe src="https://player.vimeo.com/video/76979871?h=abc"></iframe>');
t("embed vimeo", eb2?.tipo === "vimeo" && eb2.id === "76979871");
t("sem embed", procurarEmbedDeVideo("<p>nada</p>") === null);

// --- metadados YouTube (payload sintético no formato real) ---
const player = {
  videoDetails: {
    videoId: "dQw4w9WgXcQ",
    title: "Video de teste",
    author: "Canal",
    lengthSeconds: "213",
    viewCount: "1828046215",
    shortDescription: "Descricao do video",
    keywords: ["a", "b"],
    thumbnail: { thumbnails: [{ url: "https://img/capa.jpg" }] },
  },
  microformat: {
    playerMicroformatRenderer: {
      publishDate: "2009-10-24T23:57:33-07:00",
      category: "Music",
      ownerChannelName: "Canal",
    },
  },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          languageCode: "pt-BR",
          baseUrl: "https://www.youtube.com/api/timedtext?v=x",
          name: { simpleText: "Portugues" },
        },
      ],
    },
  },
  playabilityStatus: { status: "OK" },
};
const my = metadadosYouTube(player);
t(
  "metadados youtube",
  my.titulo === "Video de teste" &&
    my.canal === "Canal" &&
    my.duracaoSeg === 213 &&
    my.views === 1828046215 &&
    my.capa === "https://img/capa.jpg"
);
t("tracks do youtube", my.tracks.length === 1 && my.tracks[0].lang === "pt-BR" && my.tracks[0].kind === "manual");

// --- metadados Vimeo ---
const mv = metadadosVimeo({
  video: { title: "V", duration: 62, owner: { name: "Dono" }, thumbnail_url: "c.jpg" },
  request: {
    text_tracks: [
      { lang: "en", kind: "subtitles", label: "English", url: "https://captions.vimeo.com/captions/1.vtt" },
    ],
  },
});
t(
  "metadados vimeo",
  mv.titulo === "V" &&
    mv.canal === "Dono" &&
    mv.duracaoSeg === 62 &&
    mv.tracks.length === 1 &&
    mv.tracks[0].url.includes("captions.vimeo.com")
);

// --- metadados de página genérica (og + track) ---
const htmlPagina =
  '<html><head><meta property="og:title" content="Filme"><meta property="og:description" content="Sinopse">' +
  '<meta property="og:type" content="video.other"></head><body><video poster="p.jpg">' +
  '<track kind="subtitles" src="/sub.vtt" srclang="pt" label="Portugues"></video></body></html>';
const mp = metadadosPagina(htmlPagina, "https://exemplo.com/pagina");
t(
  "metadados pagina",
  mp.titulo === "Filme" && mp.temVideo === true && mp.tracks.length === 1 && mp.tracks[0].url === "https://exemplo.com/sub.vtt"
);

const htmlSem = "<html><head><title>Só texto</title></head><body><p>noticia</p></body></html>";
t("pagina sem video", metadadosPagina(htmlSem, "https://exemplo.com/x").temVideo === false);

// --- schema e despacho ---
const schemaVideo = TOOLS.find((x) => x.name === "read_video");
t("schema expõe read_video", Boolean(schemaVideo) && schemaVideo.inputSchema.required.includes("url"));
t("onze ferramentas no schema", TOOLS.length === 11, `total=${TOOLS.length}`);

try {
  await callTool("nao-existe", {});
  t("despacho: ferramenta desconhecida lança", false);
} catch (err) {
  t("despacho: ferramenta desconhecida lança", /desconhecida/i.test(err.message), err.message);
}

console.log(`\n${ok} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
