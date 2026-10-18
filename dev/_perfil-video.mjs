#!/usr/bin/env node
/**
 * _perfil-video.mjs — o retrato do "antes" da otimizacao do read_video.
 *
 * Tudo local e deterministico:
 *  A) o custo das etapas da analise de um video do YouTube num HTML do
 *     tamanho de uma pagina /watch real (~1,3 MB): extracao do
 *     ytInitialPlayerResponse, extracao do ytInitialData, varredura de
 *     capitulos e a "analise completa" (como o codigo faz hoje);
 *  B) o custo do caminho "pagina recusada com 429": retries padrao (como hoje)
 *     contra um servidor local que sempre recusa — o mesmo caminho de codigo
 *     que o Render encontra no YouTube — vs retries: 0 (a proposta).
 *
 * Uso: node dev/_perfil-video.mjs   (com ALLOW_PRIVATE_HOSTS=1 no ambiente)
 */
import http from "node:http";
import {
  extrairPlayerResponse,
  extrairObjetoApos,
  capitulosDe,
  converterJson3,
} from "../src/video.mjs";
import { fetchTextCached } from "../src/fetch.mjs";

/* ---------------- geradores (deterministicos) ---------------- */

function enchimento(n, semente) {
  const partes = [];
  for (let i = 0; i < n; i++) {
    partes.push(`${semente} ${i}: texto de enchimento com tamanho proximo do texto real da pagina.`);
  }
  return partes.join(" ");
}

function gerarPlayer() {
  return {
    playabilityStatus: { status: "OK", playableInEmbed: true },
    streamingData: {
      formats: Array.from({ length: 24 }, (_, i) => ({
        itag: 130 + i,
        url: `https://rr1---sn-googlevideo.googlevideo.com/videoplayback?expire=123&itag=${130 + i}&${enchimento(3, "fmt" + i)}`,
        mimeType: 'video/mp4; codecs="avc1.4d401f"',
        bitrate: 100000 + i * 50000,
        width: 640,
        height: 360,
      })),
      adaptiveFormats: Array.from({ length: 40 }, (_, i) => ({
        itag: 140 + i,
        url: `https://rr2---sn-googlevideo.googlevideo.com/videoplayback?itag=${140 + i}&${enchimento(3, "adp" + i)}`,
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 64000 + i * 1000,
      })),
    },
    videoDetails: {
      videoId: "dQw4w9WgXcQ",
      title: "Video de perfil sintetico para medir a analise",
      shortDescription: enchimento(80, "descricao"),
      lengthSeconds: "213",
      viewCount: "123456789",
      author: "Canal de Perfil",
      keywords: Array.from({ length: 30 }, (_, i) => `palavra-chave-${i}`),
      thumbnail: {
        thumbnails: Array.from({ length: 6 }, (_, i) => ({
          url: `https://i.ytimg.com/vi/dQw4w9WgXcQ/hq${i}.jpg`,
          width: 480,
          height: 360,
        })),
      },
    },
    microformat: {
      playerMicroformatRenderer: {
        publishDate: "2009-10-25",
        category: "Music",
        ownerChannelName: "Canal de Perfil",
        thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", width: 480, height: 360 }] },
      },
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: Array.from({ length: 6 }, (_, i) => ({
          languageCode: ["pt-BR", "pt", "en", "es", "fr", "de"][i],
          kind: i >= 4 ? "asr" : "",
          baseUrl: `https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=lang${i}`,
          name: { simpleText: `Legenda ${i}` },
        })),
      },
    },
  };
}

function gerarInicial(comCapitulos, resultados = 220) {
  const itens = Array.from({ length: resultados }, (_, i) => ({
    itemSectionRenderer: {
      sectionIdentifier: "secondary-items",
      contents: [
        {
          videoRenderer: {
            videoId: `vid${String(i).padStart(8, "0")}`,
            title: { runs: [{ text: `Video relacionado numero ${i}` }] },
            descriptionSnippet: { runs: [{ text: enchimento(4, `relacionado${i}`) }] },
            longBylineText: { runs: [{ text: `Canal ${i}` }] },
            viewCountText: { simpleText: "1.234.567 visualizacoes" },
            lengthText: { simpleText: "12:34" },
            channelThumbnailSupportedRenderers: {
              channelThumbnailWithLinkRenderer: {
                thumbnail: { thumbnails: [{ url: "https://yt3.ggpht.com/abc", width: 68, height: 68 }] },
              },
            },
          },
        },
      ],
    },
  }));

  const markers = [
    { key: "HEATMAP", value: { heatmap: Array.from({ length: 400 }, (_, i) => ({ startTimeMillis: i * 1000 })) } },
  ];
  if (comCapitulos) {
    markers.push({
      key: "AUTO_CHAPTERS",
      value: {
        chapters: Array.from({ length: 12 }, (_, i) => ({
          chapterRenderer: { timeRangeStartMillis: i * 15000, title: { simpleText: `Capitulo ${i}` } },
        })),
      },
    });
  }

  return {
    responseContext: { visitorData: "CgtzaW50ZXRpY28t", serviceTrackingParams: [] },
    playerOverlays: {
      playerOverlayRenderer: {
        decoratedPlayerBarRenderer: {
          playerBar: { multiMarkersPlayerBarRenderer: { markersMap: markers } },
        },
      },
    },
    contents: {
      twoColumnWatchNextResults: {
        results: { results: { contents: itens.slice(0, 1) } },
        secondaryResults: { secondaryResults: { results: itens } },
      },
    },
  };
}

function montarHtml(jsonPlayer, jsonInicial) {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Video - YouTube</title></head><body>` +
    `<script nonce="abc">var ytInitialPlayerResponse = ${jsonPlayer};</script>` +
    `<script nonce="abc">var ytInitialData = ${jsonInicial};</script>` +
    `</body></html>`
  );
}

/* ---------------- medidor ---------------- */

function medir(rotulo, fn, iteracoes = 15) {
  fn(); // aquecimento (JIT)
  const inicio = performance.now();
  for (let i = 0; i < iteracoes; i++) fn();
  const ms = (performance.now() - inicio) / iteracoes;
  console.log(`${rotulo.padEnd(58)} ${ms.toFixed(2).padStart(9)} ms`);
  return ms;
}

/* ---------------- A) analise local ---------------- */

const jsonPlayer = JSON.stringify(gerarPlayer());
const jsonSem = JSON.stringify(gerarInicial(false));
const jsonCom = JSON.stringify(gerarInicial(true));
const htmlSem = montarHtml(jsonPlayer, jsonSem);
const htmlCom = montarHtml(jsonPlayer, jsonCom);

console.log("== tamanhos (HTML sintetico no tamanho de uma /watch real) ==");
console.log(`html: ${(htmlCom.length / 1024 / 1024).toFixed(2)} MB | player ${(jsonPlayer.length / 1024).toFixed(0)} KB | ytInitialData ${(jsonCom.length / 1024 / 1024).toFixed(2)} MB`);
console.log("");

console.log("== etapas de UMA leitura ==");
const tPlayer = medir("extrairPlayerResponse(html)", () => extrairPlayerResponse(htmlCom));
const tInicial = medir("extrairObjetoApos(html, ytInitialData)", () => extrairObjetoApos(htmlCom, "ytInitialData"));
medir("  (referencia) JSON.parse so do ytInitialData", () => JSON.parse(jsonCom));
const inicialComExtraido = extrairObjetoApos(htmlCom, "ytInitialData");
const inicialSemExtraido = extrairObjetoApos(htmlSem, "ytInitialData");
medir("capitulosDe(inicial com 12 capitulos)", () => capitulosDe(inicialComExtraido));
medir("capitulosDe(inicial sem capitulos)", () => capitulosDe(inicialSemExtraido));
medir("sentinela: html.includes('chapterRenderer')", () => htmlCom.includes("chapterRenderer"));

console.log("");
console.log("== analise completa (o que UMA leitura faz hoje vs proposta) ==");
const tHoje = medir(
  "hoje: player + ytInitialData + capitulos",
  () => {
    const p = extrairPlayerResponse(htmlCom);
    const i = extrairObjetoApos(htmlCom, "ytInitialData");
    capitulosDe(i);
  },
  10
);
const tSentinela = medir(
  "proposto: sentinela antes (caso comum: sem capitulos)",
  () => {
    if (htmlSem.includes("chapterRenderer")) {
      const i = extrairObjetoApos(htmlSem, "ytInitialData");
      capitulosDe(i);
    }
  },
  50
);
console.log(`=> economia por leitura (sem capitulos): ${(tHoje - tSentinela).toFixed(2)} ms (${(tHoje / Math.max(tSentinela, 0.001)).toFixed(0)}x)`);

console.log("");
console.log("== legenda (conversao json3) ==");
const eventos = Array.from({ length: 800 }, (_, i) => ({
  tStartMs: i * 1500,
  segs: [{ utf8: `Fala numero ${i} do video, com um tamanho parecido com o real.` }],
}));
const legenda = JSON.stringify({ events: eventos });
medir(`converterJson3 (800 eventos, ${Math.round(legenda.length / 1024)} KB)`, () => converterJson3(legenda), 20);

/* ---------------- B) caminho 429 ---------------- */

console.log("");
console.log("== pagina recusada (429): o caminho do Render ==");

const servidor = http.createServer((req, res) => {
  if (req.url.startsWith("/robots.txt")) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const headers = { "content-type": "text/html; charset=utf-8" };
  if (req.url.includes("com-retry")) headers["retry-after"] = "1";
  res.writeHead(429, headers);
  res.end("<html><body>Too Many Requests</body></html>");
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const porta = servidor.address().port;

async function medir429(rotulo, caminho, opcoes) {
  const url = `http://127.0.0.1:${porta}${caminho}`;
  const inicio = performance.now();
  try {
    await fetchTextCached(url, { timeoutMs: 5000, ...opcoes });
  } catch {
    // esperado: HTTP 429
  }
  const ms = performance.now() - inicio;
  console.log(`${rotulo.padEnd(58)} ${ms.toFixed(0).padStart(9)} ms`);
  return ms;
}

await medir429("hoje: retries padrao (2), sem Retry-After", "/watch-sem-retry", {});
await medir429("hoje: retries padrao (2), Retry-After: 1", "/watch-com-retry", {});
await medir429("proposto: retries 0 (cai no fallback na hora)", "/watch-retries0", { retries: 0 });

servidor.close();
process.exit(0);
