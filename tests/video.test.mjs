// Testes do read_video (metadados + transcricao) com fixtures locais.
//
// O que se quer garantir:
// - pagina com <track> acessivel -> metadados + transcricao com timestamps;
// - legenda bloqueada pelo robots -> metadados + motivo EXPLICITO (nunca
//   fingir que leu, nunca erro opaco);
// - legenda direta (.vtt) -> transcricao;
// - pagina sem video -> resposta que aponta o caminho certo (read_page).
//
// Uso: node --test tests/video.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp } from "./helpers.mjs";
import {
  montarSaidaVideo,
  motivoCurtoDeErro,
  capitulosDe,
  capitulosDeHtml,
  analiseYouTube,
  legendaConvertida,
  quarentenaDaPagina,
  analisesVideo,
  converterVtt,
  extrairObjetoApos,
} from "../src/video.mjs";

let fixture;
let mcp;

before(async () => {
  fixture = await startFixture();
  mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
});

after(async () => {
  mcp?.close();
  await fixture?.close();
});

test("pagina com <track>: metadados + transcricao com timestamps", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/com-track`, maxChars: 8000 });
  assert.equal(r.isError, false, r.text);

  assert.match(r.text, /Documentario de teste/, "titulo (og:title) deve aparecer");
  assert.match(r.text, /Um video de fixture/, "descricao deve aparecer");
  assert.match(r.text, /Legendas na plataforma: pt/, "a faixa de legenda deve ser listada");
  assert.match(r.text, /Transcricao: 3 blocos/, "a transcricao deve ter 3 blocos");
  assert.match(r.text, /\[0:01\] Bem-vindo ao video de teste\./, "primeira fala com timestamp");
  assert.match(r.text, /\[0:03\] Esta e a segunda fala da legenda\./, "segunda fala com timestamp");
  assert.match(r.text, /\[0:06\] Terceira e ultima fala do fixture\./, "terceira fala com timestamp");
  assert.match(r.text, /legenda publicada pela plataforma/, "aviso de origem da transcricao");
});

test("legenda bloqueada pelo robots: metadados + motivo explicito", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/legenda-bloqueada`, maxChars: 8000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Video com legenda bloqueada/, "os metadados devem vir mesmo sem transcricao");
  assert.match(r.text, /Transcricao: indisponivel/, "a ausencia deve ser declarada");
  assert.match(r.text, /robots\.txt/, "o motivo deve citar o robots.txt");
});

test("legenda direta (.vtt): baixa e converte", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/legenda.vtt`, maxChars: 8000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Legenda: legenda\.vtt/, "o titulo deve citar o arquivo");
  assert.match(r.text, /Transcricao: 3 blocos/, "a transcricao deve ter os 3 blocos");
  assert.match(r.text, /\[0:01\]/, "timestamps devem aparecer");
});

test("pagina sem video: resposta clara, sem inventar leitura", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/sem-video`, maxChars: 8000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /sem v[ií]deo identificado/i, "deve dizer que nao ha video");
  assert.match(r.text, /read_page/, "deve apontar a ferramenta certa");
});

test("legenda pedida em idioma especifico nao quebra a escolha", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/com-track`, lang: "en", maxChars: 8000 });
  assert.equal(r.isError, false, r.text);
  // So ha faixa "pt" no fixture: sem correspondencia em "en", a unica faixa vale.
  assert.match(r.text, /\[0:01\]/, "a transcricao deve vir mesmo pedindo outro idioma");
});

test("maxChars corta a saida com o aviso de truncamento", { timeout: 60000 }, async () => {
  const r = await mcp.call("read_video", { url: `${fixture.url}/video/com-track`, maxChars: 200 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /conteudo truncado em 200 caracteres/, "o corte deve ser avisado");
});

test("metadados parciais (fallback) saem com o aviso visivel na saida", () => {
  // Cenario real: a pagina do YouTube recusa (429 em IP de datacenter) e o
  // oEmbed responde. A saida tem de trazer os metadados que existem E o aviso
  // declarando o bloqueio — nunca parecer leitura completa nem vazio.
  const saida = montarSaidaVideo({
    urlFinal: "https://www.youtube.com/watch?v=abc",
    plataforma: "YouTube",
    titulo: "Titulo via oEmbed",
    canal: "Canal",
    capa: "https://img/capa.jpg",
    aviso: "metadados parciais (via oEmbed): a página completa do vídeo não abriu para este servidor — HTTP 429 Too Many Requests",
    transcricao: { indisponivel: "sem acesso às faixas de legenda" },
    maxChars: 8000,
  });
  assert.match(saida, /^# Titulo via oEmbed/m);
  assert.match(saida, /\nCanal: Canal/);
  assert.match(saida, /\nAviso: metadados parciais \(via oEmbed\)/);
  assert.match(saida, /HTTP 429/);
  assert.match(saida, /Transcricao: indisponivel — sem acesso às faixas de legenda/);
});

test("motivoCurtoDeErro tira a URL do rabo da mensagem", () => {
  const motivo = motivoCurtoDeErro(
    new Error("HTTP 429 Too Many Requests ao acessar https://www.youtube.com/watch?v=x")
  );
  assert.equal(motivo, "HTTP 429 Too Many Requests");
  assert.ok(!motivo.includes("http"), "a URL nao pode sobrar no motivo");
});

/* ---------- capitulos (ytInitialData) ---------- */

// Estrutura real do YouTube (conferida em dev/_probe-video6.mjs): o markersMap
// fica em playerOverlays ... multiMarkersPlayerBarRenderer, e cada item e um
// chapterRenderer com timeRangeStartMillis. A varredura e por profundidade
// (o caminho ja mudou entre versoes), entao o teste cobre tambem um formato
// achatado alternativo.
const inicialComCapitulos = {
  playerOverlays: {
    playerOverlayRenderer: {
      decoratedPlayerBarRenderer: {
        playerBar: {
          multiMarkersPlayerBarRenderer: {
            markersMap: [
              {
                key: "AUTO_CHAPTERS",
                value: {
                  chapters: [
                    { chapterRenderer: { timeRangeStartMillis: 0, title: { simpleText: "Introduction example" } } },
                    {
                      chapterRenderer: {
                        timeRangeStartMillis: 67000,
                        title: { runs: [{ text: "Series " }, { text: "preview" }] },
                      },
                    },
                    { chapterRenderer: { timeRangeStartMillis: 162000, title: { simpleText: "What are neurons?" } } },
                  ],
                },
              },
              { key: "HEATMAP", value: { heatmap: [{}, {}] } },
            ],
          },
        },
      },
    },
  },
};

test("capitulosDe: extrai titulo e minutagem do ytInitialData real", () => {
  const caps = capitulosDe(inicialComCapitulos);
  assert.equal(caps.length, 3);
  assert.deepEqual(caps[0], { seg: 0, titulo: "Introduction example" });
  assert.deepEqual(caps[1], { seg: 67, titulo: "Series preview" }, "runs devem ser concatenados");
  assert.deepEqual(caps[2], { seg: 162, titulo: "What are neurons?" });
});

test("capitulosDe: sem capitulos publicados devolve lista vazia", () => {
  assert.deepEqual(capitulosDe(null), []);
  assert.deepEqual(capitulosDe({}), []);
  assert.deepEqual(capitulosDe({ playerOverlays: { playerOverlayRenderer: {} } }), []);
  assert.deepEqual(capitulosDe("texto solto"), []);
});

test("capitulosDe: deduplica e ordena por tempo", () => {
  const j = {
    a: {
      chapters: [
        { chapterRenderer: { timeRangeStartMillis: 90000, title: { simpleText: "Tarde" } } },
        { chapterRenderer: { timeRangeStartMillis: 0, title: { simpleText: "Cedo" } } },
      ],
    },
    b: {
      chapters: [{ chapterRenderer: { timeRangeStartMillis: 0, title: { simpleText: "Cedo" } } }],
    },
  };
  const caps = capitulosDe(j);
  assert.deepEqual(caps, [
    { seg: 0, titulo: "Cedo" },
    { seg: 90, titulo: "Tarde" },
  ]);
});

test("montarSaidaVideo: secao Capitulos aparece com minutagem formatada", () => {
  const saida = montarSaidaVideo({
    urlFinal: "https://www.youtube.com/watch?v=x",
    plataforma: "YouTube",
    titulo: "Video com capitulos",
    duracaoSeg: 3725,
    capitulos: [
      { seg: 0, titulo: "Intro" },
      { seg: 3725, titulo: "Fim" },
    ],
    transcricao: { indisponivel: "teste" },
    maxChars: 8000,
  });
  assert.match(saida, /\nCapitulos: 2\n/, "a contagem entra no cabecalho");
  assert.match(saida, /## Capitulos\n\[0:00\] Intro\n\[1:02:05\] Fim\n/, "a secao lista cada capitulo");
});

test("montarSaidaVideo: sem capitulos, nenhuma secao e adicionada", () => {
  const saida = montarSaidaVideo({
    urlFinal: "https://www.youtube.com/watch?v=x",
    plataforma: "YouTube",
    titulo: "Video curto",
    transcricao: { indisponivel: "teste" },
    maxChars: 8000,
  });
  assert.ok(!saida.includes("Capitulos"), "video sem capitulos nao pode ganhar a secao");
  assert.ok(!saida.includes("## "), "nenhum cabecalho extra");
});

/* ---------- otimizacao: sentinela, memo e quarentena (rodada 10) ---------- */

// A sentinela de capítulos pula a extração do ytInitialData quando o HTML não
// tem "chapterRenderer". A paridade com a varredura direta é o que garante que
// o atalho não inventa nem perde capítulo — nos dois sentidos.
test("capitulosDeHtml: paridade com a varredura direta do ytInitialData", () => {
  const inicial = {
    playerOverlays: {
      playerOverlayRenderer: {
        decoratedPlayerBarRenderer: {
          playerBar: {
            multiMarkersPlayerBarRenderer: {
              markersMap: [
                {
                  key: "AUTO_CHAPTERS",
                  value: {
                    chapters: [
                      { chapterRenderer: { timeRangeStartMillis: 0, title: { simpleText: "Intro" } } },
                      { chapterRenderer: { timeRangeStartMillis: 90000, title: { runs: [{ text: "Meio" }] } } },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
  };
  const com = `<!DOCTYPE html><html><body><script>var ytInitialData = ${JSON.stringify(inicial)};</script></body></html>`;
  assert.deepEqual(capitulosDeHtml(com), capitulosDe(extrairObjetoApos(com, "ytInitialData")));
  assert.deepEqual(capitulosDeHtml(com), [
    { seg: 0, titulo: "Intro" },
    { seg: 90, titulo: "Meio" },
  ]);

  // Sem a sentinela no HTML: nem toca no JSON (e o resultado é vazio, como a
  // varredura daria num ytInitialData sem capítulos).
  const sem = `<!DOCTYPE html><html><body><script>var ytInitialData = ${JSON.stringify({
    contents: { x: 1 },
  })};</script></body></html>`;
  assert.deepEqual(capitulosDeHtml(sem), []);
  assert.deepEqual(capitulosDeHtml(""), []);
  assert.deepEqual(capitulosDeHtml(null), []);

  // HTML que CONTÉM marcadores de capítulo válidos nunca é pulado.
  const outro = `<!DOCTYPE html><html><body><script>var ytInitialData = ${JSON.stringify({
    a: { chapters: [{ chapterRenderer: { timeRangeStartMillis: 5000, title: { simpleText: "Unico" } } }] },
  })};</script></body></html>`;
  assert.deepEqual(capitulosDeHtml(outro), [{ seg: 5, titulo: "Unico" }]);
});

test("memo da análise: releitura do MESMO payload não repete a análise", () => {
  const payload = {
    text: `<!DOCTYPE html><html><body><script>var ytInitialPlayerResponse = ${JSON.stringify({
      videoDetails: { videoId: "abc", title: "T", lengthSeconds: "10" },
    })};</script><script>var ytInitialData = ${JSON.stringify({
      a: { chapters: [{ chapterRenderer: { timeRangeStartMillis: 3, title: { simpleText: "Cap" } } }] },
    })};</script></body></html>`,
    finalUrl: "https://www.youtube.com/watch?v=abc",
  };
  const antes = { ...analisesVideo };
  const a1 = analiseYouTube(payload);
  const b1 = analiseYouTube(payload);
  assert.deepEqual(a1, b1, "o resultado memoizado é o mesmo");
  assert.equal(a1.capitulos.length, 1);
  assert.equal(analisesVideo.realizadas, antes.realizadas + 1, "uma análise real");
  assert.equal(analisesVideo.caronas, antes.caronas + 1, "a releitura foi carona");

  // Payload NOVO (conteúdo novo) analisa de novo.
  const a2 = analiseYouTube({ ...payload });
  assert.equal(a2.capitulos.length, 1);
  assert.equal(analisesVideo.realizadas, antes.realizadas + 2, "payload novo analisa de novo");

  // Conversão de legenda também memoiza por payload (e o formato participa da chave).
  const legenda = { text: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOla.\n", finalUrl: "x" };
  const r1 = legendaConvertida(legenda, "vtt");
  const r2 = legendaConvertida(legenda, "vtt");
  assert.deepEqual(r1, r2);
  assert.equal(r1.blocos.length, 1);
  assert.deepEqual(legendaConvertida(legenda, null), converterVtt(legenda.text), "chave sem formato é outro caminho");
});

test("quarentena da página: só 429 marca; a janela expira e o motivo fica declarado", () => {
  quarentenaDaPagina.limpar();
  assert.equal(quarentenaDaPagina.emQuarentena(), false, "limpa não quarentena");

  // Recusa que não é 429 (ex.: erro de rede) não entra em quarentena.
  assert.equal(quarentenaDaPagina.marcar({ message: "ECONNRESET" }), false);
  assert.equal(quarentenaDaPagina.emQuarentena(), false);

  // 429 marca com o motivo; dentro do TTL está em quarentena; depois, não.
  const agora = Date.now();
  assert.equal(quarentenaDaPagina.marcar({ status: 429, message: "HTTP 429 Too Many Requests" }, agora), true);
  assert.equal(quarentenaDaPagina.emQuarentena(agora), true);
  assert.equal(quarentenaDaPagina.motivo, "HTTP 429 Too Many Requests");
  assert.equal(quarentenaDaPagina.emQuarentena(agora + quarentenaDaPagina.ttlMs - 1), true);
  assert.equal(quarentenaDaPagina.emQuarentena(agora + quarentenaDaPagina.ttlMs + 1), false);

  quarentenaDaPagina.limpar();
  assert.equal(quarentenaDaPagina.emQuarentena(), false, "limpar libera de novo");
});

// O efeito da memoização precisa ser visível DE FORA (é assim que se prova em
// produção, pelo /health): a releitura do mesmo vídeo não analisa de novo;
// ela conta como carona.
test("contador de video no /health: releitura vira reaproveitada", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const url = `${fixture.url}/video/com-track`;

    const r1 = await mcp.call("read_video", { url, maxChars: 8000 });
    assert.equal(r1.isError, false, r1.text);
    const h1 = await (await fetch(`${mcp.base}/health`)).text();
    const m1 = h1.match(/video: (\d+) \(reaproveitadas (\d+)\)/);
    assert.ok(m1, `o /health deveria trazer o contador de video: ${h1}`);
    const realizadas1 = Number(m1[1]);
    const caronas1 = Number(m1[2]);
    assert.ok(realizadas1 >= 1, "a 1a leitura analisou de verdade");

    const r2 = await mcp.call("read_video", { url, maxChars: 8000 });
    assert.equal(r2.isError, false, r2.text);
    const h2 = await (await fetch(`${mcp.base}/health`)).text();
    const m2 = h2.match(/video: (\d+) \(reaproveitadas (\d+)\)/);
    assert.ok(m2, `o /health deveria trazer o contador de video: ${h2}`);
    const realizadas2 = Number(m2[1]);
    const caronas2 = Number(m2[2]);

    assert.equal(realizadas2, realizadas1, `a releitura não devia analisar de novo (${realizadas1} -> ${realizadas2})`);
    assert.ok(caronas2 > caronas1, `a releitura devia contar carona (${caronas1} -> ${caronas2})`);
  } finally {
    mcp.close();
  }
});
