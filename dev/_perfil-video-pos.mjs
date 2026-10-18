#!/usr/bin/env node
/**
 * _perfil-video-pos.mjs — o "depois" da otimizacao do read_video.
 *
 * Mede os mesmos caminhos do _perfil-video.mjs, mas pelo codigo novo
 * (capitulosDeHtml com sentinela + analise memoizada):
 *  A) analise de uma leitura YouTube: antes vs depois, com e sem capitulos;
 *  B) leitura repetida do mesmo payload (memo da analise).
 *
 * Uso: node dev/_perfil-video-pos.mjs
 */
import {
  extrairPlayerResponse,
  extrairObjetoApos,
  capitulosDe,
  capitulosDeHtml,
  analiseYouTube,
} from "../src/video.mjs";

function enchimento(n, semente) {
  const partes = [];
  for (let i = 0; i < n; i++) {
    partes.push(`${semente} ${i}: texto de enchimento com tamanho proximo do texto real da pagina.`);
  }
  return partes.join(" ");
}

function gerarPlayer() {
  return {
    playabilityStatus: { status: "OK" },
    videoDetails: {
      videoId: "dQw4w9WgXcQ",
      title: "Video de perfil sintetico",
      shortDescription: enchimento(80, "descricao"),
      lengthSeconds: "213",
      viewCount: "123456789",
      author: "Canal de Perfil",
      keywords: Array.from({ length: 30 }, (_, i) => `palavra-chave-${i}`),
      thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg", width: 480, height: 360 }] },
    },
  };
}

function gerarInicial(comCapitulos, resultados = 220) {
  const itens = Array.from({ length: resultados }, (_, i) => ({
    itemSectionRenderer: {
      contents: [
        {
          videoRenderer: {
            videoId: `vid${String(i).padStart(8, "0")}`,
            title: { runs: [{ text: `Video relacionado numero ${i}` }] },
            descriptionSnippet: { runs: [{ text: enchimento(4, `relacionado${i}`) }] },
            viewCountText: { simpleText: "1.234.567 visualizacoes" },
          },
        },
      ],
    },
  }));
  const markers = [{ key: "HEATMAP", value: { heatmap: Array.from({ length: 400 }, (_, i) => ({ startTimeMillis: i * 1000 })) } }];
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
    playerOverlays: {
      playerOverlayRenderer: {
        decoratedPlayerBarRenderer: {
          playerBar: { multiMarkersPlayerBarRenderer: { markersMap: markers } },
        },
      },
    },
    contents: { twoColumnWatchNextResults: { secondaryResults: { secondaryResults: { results: itens } } } },
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

function medir(rotulo, fn, iteracoes = 15) {
  fn();
  const inicio = performance.now();
  for (let i = 0; i < iteracoes; i++) fn();
  const ms = (performance.now() - inicio) / iteracoes;
  console.log(`${rotulo.padEnd(58)} ${ms.toFixed(2).padStart(9)} ms`);
  return ms;
}

const jsonPlayer = JSON.stringify(gerarPlayer());
const htmlSem = montarHtml(jsonPlayer, JSON.stringify(gerarInicial(false)));
const htmlCom = montarHtml(jsonPlayer, JSON.stringify(gerarInicial(true)));
console.log(`html: ${(htmlCom.length / 1024 / 1024).toFixed(2)} MB (sem capitulos: ${(htmlSem.length / 1024 / 1024).toFixed(2)} MB)\n`);

console.log("== caso comum (sem capitulos): antes vs depois ==");
const tAntes = medir("antes: player + extrair ytInitialData + capitulosDe", () => {
  const p = extrairPlayerResponse(htmlSem);
  const i = extrairObjetoApos(htmlSem, "ytInitialData");
  capitulosDe(i);
});
const tDepois = medir(
  "depois: analiseYouTube fria (payload novo, sentinela pula)",
  () => analiseYouTube({ text: htmlSem, finalUrl: "x" }),
  50
);
console.log(`=> ${(tAntes - tDepois).toFixed(2)} ms mais rapido (${(tAntes / Math.max(tDepois, 0.001)).toFixed(0)}x)\n`);

console.log("== caso com capitulos: antes vs depois (frio) ==");
const tComAntes = medir("antes: player + extrair ytInitialData + capitulosDe", () => {
  extrairPlayerResponse(htmlCom);
  const i = extrairObjetoApos(htmlCom, "ytInitialData");
  capitulosDe(i);
});
const tComDepois = medir(
  "depois: analiseYouTube fria (sentinela abre o caminho)",
  () => analiseYouTube({ text: htmlCom, finalUrl: "x" }),
  30
);
console.log(`=> mesmo trabalho quando HA capitulos (${tComDepois.toFixed(2)} ms); os capitulos saem identicos\n`);

console.log("== releitura do mesmo payload (memo da analise) ==");
const payloadReuso = { text: htmlCom, finalUrl: "x" };
analiseYouTube(payloadReuso); // 1a analise: fria (enche a memo)
const tMorno = medir(
  "releitura: MESMO payload (memo)",
  () => analiseYouTube(payloadReuso),
  500
);
const tFrio = medir(
  "controle: payload novo a cada chamada (frio)",
  () => analiseYouTube({ text: htmlCom, finalUrl: "x" }),
  30
);
console.log(`=> reler o mesmo video: ${tFrio.toFixed(2)} ms -> ${tMorno.toFixed(4)} ms (${(tFrio / Math.max(tMorno, 0.0001)).toFixed(0)}x)\n`);

console.log(`contadores: realizadas ${(await import("../src/video.mjs")).analisesVideo.realizadas}, reaproveitadas ${(await import("../src/video.mjs")).analisesVideo.caronas}`);
process.exit(0);
