/**
 * Leitura de vídeo (read_video): metadados e transcrição.
 *
 * O que a ferramenta faz — sobre caminhos provados na web real (dev/_probe-*):
 * - YouTube: extrai o ytInitialPlayerResponse da página /watch (título, canal,
 *   duração, visualizações, descrição, capas) e lista as faixas de legenda.
 *   O download da legenda mora em /api/timedtext — bloqueado pelo robots.txt
 *   do próprio YouTube ("Disallow: /api/") e servido vazio para acesso
 *   anônimo. A ferramenta TENTA e devolve o motivo exato quando não consegue;
 *   nunca finge que leu.
 * - Vimeo: lê o config público do player (metadados + text_tracks) e baixa a
 *   legenda VTT de captions.vimeo.com (provado acessível).
 * - Qualquer outra plataforma: og tags + JSON-LD (VideoObject) + <video>/
 *   <track>. Se a página publica a legenda como VTT/SRT acessível, ela vem
 *   transcrita; se não, vêm só os metadados — com aviso claro.
 * - Link direto de legenda (.vtt/.srt): baixa e converte.
 *
 * O que NÃO faz (por escolha de projeto): não baixa o vídeo, não decodifica
 * quadros e não adiciona dependência nenhuma. O que a plataforma não publica
 * como texto acessível, não entra — e o resultado diz isso.
 *
 * Toda URL tocada por este módulo passa pelo fetchTextCached: SSRF, robots,
 * cache, junção de buscas em voo e teto por host valem igual às outras
 * ferramentas.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: a URL de uma página de vídeo (ou de uma legenda .vtt/.srt).
 *   Sai:   metadados + transcrição quando a plataforma publica; só metadados
 *          com aviso claro quando não publica.
 *
 * QUEM USA
 *   Usado por: tools.mjs (read_video) e http-transport.mjs.
 *   Importa de: config, errors, fetch, html-parser.
 */
import {
  fetchTextCached,
  validateHttpUrl,
  clampMaxChars,
  clampTimeoutMs,
  truncate,
} from "./fetch.mjs";
import { decodeEntities } from "./html-parser.mjs";
import { RobotsBloqueadoError } from "./errors.mjs";
import { MEMO_CONVERSAO } from "./config.mjs";

/* ===================================================================== *
 * Memoização da análise por conteúdo baixado                              *
 * ===================================================================== */

/**
 * O custo alto da leitura de vídeo — extrair o ytInitialPlayerResponse,
 * varrer o ytInitialData atrás de capítulos, converter a legenda — depende
 * só do CONTEÚDO baixado. E o cache de páginas devolve o MESMO objeto de
 * payload enquanto a entrada vale. Então a análise fica presa ao payload
 * (WeakMap): releitura do mesmo vídeo (cache quente, rajada, várias
 * ferramentas no mesmo conteúdo) não paga de novo. Os contadores
 * `analisesVideo` aparecem no /health como `video: N (reaproveitadas M)`;
 * MEMO_CONVERSAO=0 desliga, para depurar o módulo sem memo.
 *
 * Medido em dev/_perfil-video.mjs: uma análise fria de página /watch custa
 * ~22 ms; a releitura com payload em cache reaproveita a análise inteira
 * (reaproveitadas sobem, realizadas não).
 */
export const analisesVideo = { realizadas: 0, caronas: 0 };
const memoDoConteudo = new WeakMap();

function comMemoDeAnalise(payload, chave, calcular) {
  if (!MEMO_CONVERSAO || !payload || typeof payload !== "object") {
    analisesVideo.realizadas++;
    return calcular();
  }
  let memo = memoDoConteudo.get(payload);
  if (!memo) {
    memo = new Map();
    memoDoConteudo.set(payload, memo);
  }
  if (memo.has(chave)) {
    analisesVideo.caronas++;
    return memo.get(chave);
  }
  analisesVideo.realizadas++;
  const valor = calcular();
  memo.set(chave, valor);
  return valor;
}

/**
 * Capítulos a partir do HTML da página. A varredura do ytInitialData só roda
 * quando a string "chapterRenderer" aparece no HTML: capítulo SÓ existe como
 * chapterRenderer dentro do JSON, então sem a sentinela é impossível haver
 * capítulo — e a extração do JSON gigante é pulada. Medido em
 * dev/_perfil-video.mjs: o trecho que isto substitui — extrair o ytInitialData
 * e varrê-lo — custa ~22 ms; no caso comum (sem capítulos) o custo vira um
 * `includes` de ~0,05 ms. Paridade com a varredura direta é provada em
 * tests/video.test.mjs.
 */
export function capitulosDeHtml(html) {
  const texto = typeof html === "string" ? html : "";
  if (!texto.includes("chapterRenderer")) return [];
  const inicial = extrairObjetoApos(texto, "ytInitialData");
  return inicial ? capitulosDe(inicial) : [];
}

/** Análise do payload de uma página /watch: player + capítulos (memoizada). */
export function analiseYouTube(payload) {
  return comMemoDeAnalise(payload, "youtube", () => ({
    player: extrairPlayerResponse(payload.text),
    capitulos: capitulosDeHtml(payload.text),
  }));
}

/** Embed de vídeo de uma página comum (memoizado por payload). */
export function embedDePagina(payload) {
  return comMemoDeAnalise(payload, "embed", () => procurarEmbedDeVideo(payload.text));
}

/** Metadados de uma página comum (memoizados por payload). */
export function metaDePagina(payload) {
  return comMemoDeAnalise(payload, "meta", () => metadadosPagina(payload.text, payload.finalUrl));
}

/** Conversão do payload de uma legenda (memoizada por formato). */
export function legendaConvertida(payload, formato = null) {
  return comMemoDeAnalise(payload, `legenda:${formato || "auto"}`, () =>
    converterLegenda(payload.text, formato)
  );
}

/* ===================================================================== *
 * Quarentena da página do YouTube                                         *
 * ===================================================================== */

/**
 * Quando a página /watch recusa com 429 (o caso real em IP de datacenter,
 * como o Render), insistir custa a rodada de retries inteira — ~1,6 a 2 s
 * medidos em dev/_perfil-video.mjs — para receber a mesma recusa. Com retries
 * desligados na página e quarentena curta, as leituras seguintes vão direto
 * ao oEmbed (que responde) e o motivo continua declarado na saída; o caminho
 * local (página abre) não é afetado.
 */
const RECUSA_PAGINA_TTL_MS = 60 * 1000;

/**
 * Quarentena da página /watch do YouTube. Exportada para os testes do
 * mecanismo: `marcar` só age em recusa 429, `emQuarentena` aceita o relógio
 * como parâmetro (teste não espera tempo real).
 */
export const quarentenaDaPagina = {
  ttlMs: RECUSA_PAGINA_TTL_MS,
  ate: 0,
  motivo: null,
  emQuarentena(agora = Date.now()) {
    return agora < this.ate;
  },
  marcar(err, agora = Date.now()) {
    if (!err || err.status !== 429) return false;
    this.ate = agora + this.ttlMs;
    this.motivo = err.message || "HTTP 429";
    return true;
  },
  limpar() {
    this.ate = 0;
    this.motivo = null;
  },
};

/* ===================================================================== *
 * Detecção da plataforma                                                  *
 * ===================================================================== */

const RE_ID_YOUTUBE = /^[\w-]{11}$/;

/** Extrai o ID de um vídeo do YouTube de qualquer forma de URL aceita. */
export function youtubeIdDe(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(?:www|m|music)\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return RE_ID_YOUTUBE.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") {
      const id = u.searchParams.get("v") || "";
      return RE_ID_YOUTUBE.test(id) ? id : null;
    }
    const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})(?:[/?]|$)/);
    if (m) return m[1];
  }
  return null;
}

/** Extrai { id, hash } de uma URL do Vimeo (inclusive player e link privado). */
export function vimeoDe(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "vimeo.com") {
    const m = u.pathname.match(/^\/(\d+)(?:\/([\w-]+))?/);
    if (!m) return null;
    return { id: m[1], hash: m[2] || u.searchParams.get("h") || null };
  }
  if (host === "player.vimeo.com") {
    const m = u.pathname.match(/^\/video\/(\d+)/);
    if (!m) return null;
    return { id: m[1], hash: u.searchParams.get("h") || null };
  }
  return null;
}

const RE_EXTENSAO_LEGENDA = /\.(vtt|srt|webvtt)$/i;

/** Classifica a URL de entrada: youtube | vimeo | legenda | pagina. */
export function detectarVideo(url) {
  const idYt = youtubeIdDe(url);
  if (idYt) return { tipo: "youtube", id: idYt };
  const v = vimeoDe(url);
  if (v) return { tipo: "vimeo", id: v.id, hash: v.hash };
  let u;
  try {
    u = new URL(url);
  } catch {
    return { tipo: "pagina" };
  }
  if (RE_EXTENSAO_LEGENDA.test(u.pathname)) return { tipo: "legenda" };
  return { tipo: "pagina" };
}

/**
 * Procura um iframe de YouTube/Vimeo embutido no HTML — o caso clássico de
 * blog/notícia com vídeo incorporado. Devolve { tipo, id, hash } ou null.
 */
export function procurarEmbedDeVideo(html) {
  for (const tag of varrerTags(html, "iframe")) {
    const src = valorDoAtributo(tag, "src");
    if (!src) continue;
    const idYt = youtubeIdDe(src);
    if (idYt) return { tipo: "youtube", id: idYt };
    const v = vimeoDe(src);
    if (v) return { tipo: "vimeo", id: v.id, hash: v.hash };
  }
  return null;
}

/**
 * Varre as tags de abertura <nome ...> em uma passada linear.
 *
 * Substitui a família `/<tag\b[^>]*>/` usada aqui: num documento com muitas
 * tags não fechadas, cada `[^>]*` relê o resto do HTML até o fim — O(n²) num
 * documento que o cliente controla. O indexOf de ">" garante uma varredura só.
 */
function varrerTags(html, nome) {
  const tags = [];
  const re = new RegExp(`<${nome}\\b`, "gi");
  let m;
  while ((m = re.exec(html)) !== null) {
    const fim = html.indexOf(">", m.index + m[0].length);
    if (fim === -1) break;
    tags.push(html.slice(m.index, fim + 1));
    re.lastIndex = fim + 1;
  }
  return tags;
}

/** Valor decodificado de um atributo dentro da tag já recortada. */
function valorDoAtributo(tag, nome) {
  const a = tag.match(regexAtributo(nome));
  return a ? decodeEntities(a[1] ?? a[2] ?? a[3] ?? "").trim() : "";
}

/* ===================================================================== *
 * Extração de JSON embutido no HTML                                       *
 * ===================================================================== */

/**
 * Extrai o objeto balanceado que começa após um marcador (ex.:
 * "ytInitialPlayerResponse"). Feito à mão de propósito: o JSON do YouTube tem
 * urls, chaves e strings com chaves balanceadas dentro — regex não daria conta.
 */
export function extrairObjetoApos(texto, marcador) {
  const pos = String(texto).indexOf(marcador);
  if (pos === -1) return null;
  const i = String(texto).indexOf("{", pos + marcador.length);
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
  try {
    return JSON.parse(texto.slice(i, j));
  } catch {
    return null;
  }
}

/** Extrai o ytInitialPlayerResponse da página do YouTube. */
export function extrairPlayerResponse(html) {
  return extrairObjetoApos(html, "ytInitialPlayerResponse");
}

/**
 * Capítulos do vídeo (título + minutagem). Moram no ytInitialData — o mesmo
 * HTML que a leitura já baixou —, no markersMap que desenha a barra do player.
 * Varredura com profundidade limitada em vez de caminho fixo: o YouTube já
 * moveu esse caminho entre versões, e a varredura custa menos que uma segunda
 * leitura. Sem capítulos publicados, devolve [] (o normal em vídeos curtos).
 */
export function capitulosDe(inicial) {
  const saida = [];
  const vistos = new Set();
  const coletar = (no, prof) => {
    if (prof > 16 || !no || typeof no !== "object") return;
    if (Array.isArray(no)) {
      for (const x of no) coletar(x, prof + 1);
      return;
    }
    if (Array.isArray(no.chapters)) {
      for (const capitulo of no.chapters) {
        const dados = capitulo && capitulo.chapterRenderer;
        if (!dados) continue;
        const seg = Math.floor((Number(dados.timeRangeStartMillis) || 0) / 1000);
        const tituloBruto = dados.title || {};
        const titulo = String(
          tituloBruto.simpleText || (tituloBruto.runs || []).map((run) => run.text || "").join("") || ""
        ).trim();
        if (!seg && !titulo) continue;
        // A mesma marca pode aparecer em mais de um lugar da árvore do
        // ytInitialData; a chave evita o capítulo duplicado na saída.
        const chave = `${seg}|${titulo}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        saida.push({ seg, titulo });
      }
    }
    for (const valor of Object.values(no)) {
      if (valor && typeof valor === "object") coletar(valor, prof + 1);
    }
  };
  coletar(inicial, 0);
  saida.sort((a, b) => a.seg - b.seg);
  return saida;
}

/** Metadados de um playerResponse do YouTube (formato validado na web real). */
export function metadadosYouTube(player) {
  // Dois blocos de dados com nomes parecidos, de propósito separados:
  // `detalhes` é o que o player sabe do vídeo (título, autor, duração,
  // descrição) e `microformato` é o que a PÁGINA publica sobre ele (data de
  // publicação, categoria, capa). Um campo pode existir só em um dos dois.
  const detalhes = (player && player.videoDetails) || {};
  const microformato =
    (player && player.microformat && player.microformat.playerMicroformatRenderer) || {};
  const faixas =
    ((player && player.captions && player.captions.playerCaptionsTracklistRenderer) || {}).captionTracks ||
    [];
  const miniaturas =
    (detalhes.thumbnail && detalhes.thumbnail.thumbnails) ||
    (microformato.thumbnail && microformato.thumbnail.thumbnails) ||
    [];
  const capa = miniaturas.length ? miniaturas[miniaturas.length - 1].url || "" : "";
  return {
    videoId: detalhes.videoId || "",
    titulo: detalhes.title || "",
    canal: detalhes.author || microformato.ownerChannelName || "",
    duracaoSeg: Number(detalhes.lengthSeconds) || 0,
    views: detalhes.viewCount ? Number(detalhes.viewCount) : 0,
    publicado: String(microformato.publishDate || "").slice(0, 10),
    categoria: microformato.category || "",
    descricao: String(detalhes.shortDescription || ""),
    tags: Array.isArray(detalhes.keywords) ? detalhes.keywords.slice(0, 10) : [],
    capa,
    isLive: Boolean(detalhes.isLiveContent),
    playability: (player && player.playabilityStatus && player.playabilityStatus.status) || "",
    tracks: faixas.map((t) => ({
      lang: t.languageCode || "",
      kind: t.kind || "manual",
      nome:
        (t.name && (t.name.simpleText || (t.name.runs || []).map((run) => run.text).join(""))) ||
        t.languageCode ||
        "",
      url: t.baseUrl || "",
    })),
  };
}

/** Metadados do config público do player do Vimeo (estrutura validada). */
export function metadadosVimeo(config) {
  const video = (config && config.video) || {};
  const tracks = ((config && config.request && config.request.text_tracks) || []).map((t) => ({
    lang: t.lang || "",
    kind: t.kind === "captions" ? "captions" : t.kind || "subtitles",
    nome: t.label || t.lang || "",
    url: t.url || "",
  }));
  return {
    titulo: video.title || "",
    canal: (video.owner && video.owner.name) || "",
    duracaoSeg: Number(video.duration) || 0,
    descricao: String(video.description || ""),
    publicado: String(video.release_time || video.upload_date || "").slice(0, 10),
    capa: video.thumbnail_url || "",
    tracks,
  };
}

/* ===================================================================== *
 * Metadados de página genérica (og tags + JSON-LD + <video>/<track>)      *
 * ===================================================================== */

/**
 * As regex de atributo eram compiladas a cada chamada: numa página com dezenas
 * de <track>/<video>, o mesmo padrão para "src" era montado de novo dezenas de
 * vezes. O conjunto de nomes é pequeno e fixo, então memoizar não cresce sem
 * limite e corta a compilação repetida.
 */
const memoRegexAtributo = new Map();
function regexAtributo(nome) {
  let re = memoRegexAtributo.get(nome);
  if (!re) {
    re = new RegExp(`${nome}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
    memoRegexAtributo.set(nome, re);
  }
  return re;
}

/** Metas da página em um mapa property/name -> content (uma varredura só). */
function mapaDeMetas(html) {
  const mapa = new Map();
  for (const tag of varrerTags(html, "meta")) {
    const chave = (valorDoAtributo(tag, "property") || valorDoAtributo(tag, "name")).toLowerCase();
    if (!chave || mapa.has(chave)) continue;
    mapa.set(chave, valorDoAtributo(tag, "content"));
  }
  return mapa;
}

/** Todos os VideoObject de JSON-LD da página (inclusive dentro de @graph). */
export function extrairVideoObjects(html) {
  const achados = [];
  // Varredura linear: a versão com regex relia o documento inteiro a cada
  // <script> de JSON-LD sem </script> correspondente (O(n²) num HTML hostil).
  const reScript = /<script\b/gi;
  const reFecho = /<\/script\s*>/gi;
  let m;
  while ((m = reScript.exec(html)) !== null) {
    const fimTag = html.indexOf(">", m.index + m[0].length);
    if (fimTag === -1) break;
    const tag = html.slice(m.index, fimTag + 1);
    reScript.lastIndex = fimTag + 1;
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(tag)) continue;
    reFecho.lastIndex = reScript.lastIndex;
    const fecho = reFecho.exec(html);
    if (!fecho) break;
    const corpo = html.slice(reScript.lastIndex, fecho.index);
    reScript.lastIndex = fecho.index + fecho[0].length;
    let dados;
    try {
      dados = JSON.parse(corpo.trim());
    } catch {
      continue;
    }
    coletarVideoObjects(dados, achados);
  }
  return achados;
}

function coletarVideoObjects(no, saida, prof = 0) {
  if (prof > 8 || !no || typeof no !== "object") return;
  if (Array.isArray(no)) {
    for (const x of no) coletarVideoObjects(x, saida, prof + 1);
    return;
  }
  const tipo = no["@type"];
  if (tipo === "VideoObject" || (Array.isArray(tipo) && tipo.includes("VideoObject"))) {
    saida.push(no);
  }
  for (const valor of Object.values(no)) {
    if (valor && typeof valor === "object") coletarVideoObjects(valor, saida, prof + 1);
  }
}

/** Duração em segundos: aceita número puro ou ISO 8601 ("PT4M13S"). */
export function segundosDeDuracao(texto) {
  const s = String(texto || "").trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (m) return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
  return 0;
}

/** Collecta <track> de legendas (src absoluto, kind de texto). */
export function extrairTracksDeHtml(html, baseUrl) {
  const tracks = [];
  for (const tag of varrerTags(html, "track")) {
    const attr = (nome) => valorDoAtributo(tag, nome);
    const src = attr("src");
    if (!src) continue;
    const kind = (attr("kind") || "subtitles").toLowerCase();
    if (kind !== "subtitles" && kind !== "captions" && kind !== "descriptions") continue;
    let abs;
    try {
      abs = new URL(src, baseUrl).href;
    } catch {
      continue;
    }
    tracks.push({
      lang: attr("srclang") || "",
      kind: "manual",
      nome: attr("label") || attr("srclang") || "",
      url: abs,
    });
  }
  return tracks;
}

/** Metadados de uma página que talvez seja de vídeo. */
export function metadadosPagina(html, baseUrl) {
  const jsonLd = extrairVideoObjects(html);
  const vo = jsonLd[0] || {};
  const tracksHtml = extrairTracksDeHtml(html, baseUrl);
  const mVideo = varrerTags(html, "video")[0] || "";
  const metas = mapaDeMetas(html);
  const meta = (chave) => metas.get(chave) || "";
  const attrVideo = (nome) => (mVideo ? valorDoAtributo(mVideo, nome) : "");

  const autorJsonLd =
    (vo.author && (vo.author.name || vo.author)) ||
    (vo.publisher && (vo.publisher.name || vo.publisher)) ||
    "";

  return {
    titulo: meta("og:title") || meta("twitter:title") || String(vo.name || ""),
    descricao: meta("og:description") || meta("twitter:description") || String(vo.description || ""),
    site: meta("og:site_name"),
    canal: String(autorJsonLd || ""),
    publicado: String(vo.uploadDate || "").slice(0, 10) || meta("article:published_time").slice(0, 10),
    duracaoSeg:
      segundosDeDuracao(meta("video:duration")) ||
      segundosDeDuracao(meta("og:video:duration")) ||
      segundosDeDuracao(vo.duration),
    capa:
      meta("og:image") ||
      meta("twitter:image") ||
      String(vo.thumbnailUrl || "") ||
      attrVideo("poster"),
    tracks: tracksHtml,
    temVideo: Boolean(
      mVideo ||
        tracksHtml.length > 0 ||
        jsonLd.length > 0 ||
        /^video/i.test(meta("og:type")) ||
        meta("og:video") ||
        meta("twitter:player")
    ),
  };
}

/* ===================================================================== *
 * Conversão de legendas (VTT/SRT) e do json3 do YouTube                   *
 * ===================================================================== */

const CHARS_POR_BLOCO_LEGENDA = 180;

/** "00:01:05.200" (ou SRT "00:01:05,200") -> 65 segundos. */
export function segundosDeTempo(ts) {
  const partes = String(ts)
    .trim()
    .replace(",", ".")
    .split(":")
    .map((p) => parseFloat(p) || 0);
  let s = 0;
  for (const p of partes) s = s * 60 + p;
  return Math.floor(s);
}

/** Remove marcação de uma legenda em uma passada (sem regex de `[^>]*`). */
function removerTagsDeLegenda(texto) {
  let saida = "";
  let i = 0;
  for (;;) {
    const abre = texto.indexOf("<", i);
    if (abre === -1) {
      saida += texto.slice(i);
      break;
    }
    const fecha = texto.indexOf(">", abre + 1);
    if (fecha === -1) {
      saida += texto.slice(i);
      break;
    }
    saida += texto.slice(i, abre) + " ";
    i = fecha + 1;
  }
  return saida;
}

/** Limpa marcação das legendas: <i>, <c.cor>, <v Nome>, {\an8}, entidades. */
function limparTextoDeLegenda(s) {
  return decodeEntities(
    removerTagsDeLegenda(String(s || "")).replace(/\{\\[^}]*\}/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Junta cues curtas em blocos legíveis: fim de frase ou ~180 caracteres. */
function acumularBlocos(cues) {
  const blocos = [];
  let buffer = "";
  let segInicio = null;
  const fechar = () => {
    const texto = buffer.trim();
    if (texto) blocos.push({ seg: segInicio ?? 0, texto });
    buffer = "";
    segInicio = null;
  };
  for (const cue of cues) {
    const texto = String(cue.texto || "").trim();
    if (!texto) continue;
    if (segInicio === null) segInicio = cue.seg;
    buffer += (buffer ? " " : "") + texto;
    if (cue.quebra || /[.!?]$/.test(texto) || buffer.length >= CHARS_POR_BLOCO_LEGENDA) fechar();
  }
  fechar();
  return blocos;
}

/**
 * Converte uma legenda WebVTT (ou SRT — o formato é o mesmo a menos do
 * separador decimal) em blocos com timestamp.
 */
export function converterVtt(texto) {
  const normalizado = String(texto || "").replace(/\r\n?/g, "\n").trim();
  if (!normalizado) return { blocos: [], cues: 0, caracteres: 0 };
  const blocosBrutos = normalizado.split(/\n{2,}/);
  const cues = [];
  for (const bruto of blocosBrutos) {
    const linhas = bruto.split("\n");
    let idxTempo = -1;
    for (let i = 0; i < linhas.length; i++) {
      if (linhas[i].includes("-->")) {
        idxTempo = i;
        break;
      }
    }
    if (idxTempo === -1) continue; // WEBVTT, NOTE, STYLE, REGION, número solto
    const seg = segundosDeTempo(linhas[idxTempo].split("-->")[0].trim());
    const textoLimpo = limparTextoDeLegenda(linhas.slice(idxTempo + 1).join(" "));
    if (textoLimpo) cues.push({ seg, texto: textoLimpo });
  }
  const blocos = acumularBlocos(cues);
  return { blocos, cues: cues.length, caracteres: blocos.reduce((n, b) => n + b.texto.length, 0) };
}

/** Converte o formato json3 (timedtext do YouTube), com quebras de linha. */
export function converterJson3(corpo) {
  let dados;
  try {
    dados = JSON.parse(String(corpo || ""));
  } catch {
    return { blocos: [], cues: 0, caracteres: 0 };
  }
  // `dados` pode ser null/lista/número (JSON válido que não é o objeto
  // esperado) — acessar `.events` num null derrubava a ferramenta inteira.
  const eventos = dados && Array.isArray(dados.events) ? dados.events : [];
  const cues = [];
  for (const ev of eventos) {
    if (!ev || !Array.isArray(ev.segs)) continue;
    const t = Math.max(0, Math.floor((Number(ev.tStartMs) || 0) / 1000));
    const texto = ev.segs.map((s) => (s && s.utf8) || "").join("");
    if (!texto) continue;
    if (texto.includes("\n")) {
      const partes = texto.split(/\n+/).filter(Boolean);
      partes.forEach((p, i) => {
        if (p.trim()) cues.push({ seg: t, texto: p.trim(), quebra: i < partes.length - 1 });
      });
      continue;
    }
    cues.push({ seg: t, texto });
  }
  const blocos = acumularBlocos(cues);
  return { blocos, cues: cues.length, caracteres: blocos.reduce((n, b) => n + b.texto.length, 0) };
}

/**
 * Despacha pelo formato (ou pela cara do texto): json3, vtt/srt ou texto puro.
 */
export function converterLegenda(texto, formato = null) {
  const amostra = String(texto || "").trim();
  let fmt = formato;
  if (!fmt) {
    if (/^WEBVTT/mi.test(amostra)) fmt = "vtt";
    else if (/^\{/.test(amostra)) fmt = "json3";
    else if (amostra.includes("-->")) fmt = "srt";
    else fmt = "texto";
  }
  if (fmt === "json3") return converterJson3(amostra);
  if (fmt === "texto") {
    const textoLimpo = limparTextoDeLegenda(amostra);
    const blocos = textoLimpo ? [{ seg: 0, texto: textoLimpo }] : [];
    return { blocos, cues: blocos.length, caracteres: textoLimpo.length };
  }
  return converterVtt(amostra);
}

/** "213" -> "3:33"; "3725" -> "1:02:05". */
export function formatarTempo(seg) {
  const s = Math.max(0, Math.floor(Number(seg) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const resto = s % 60;
  const dois = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(resto)}` : `${m}:${dois(resto)}`;
}

/** "1828046215" -> "1.828.046.215". */
export function formatarNumero(n) {
  const s = String(Math.floor(Number(n) || 0));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/* ===================================================================== *
 * Escolha de faixa por idioma                                             *
 * ===================================================================== */

/** Preferências de idioma: o pedido pela pessoa primeiro, depois pt-BR, pt, en. */
export function preferenciasDeIdioma(lang) {
  const base = [];
  if (lang) base.push(String(lang));
  for (const p of ["pt-BR", "pt", "en"]) {
    if (!base.some((b) => b.toLowerCase() === p.toLowerCase())) base.push(p);
  }
  return base.map((p) => p.toLowerCase());
}

/** Escolhe a melhor faixa de legenda para as preferências (manual ganha de ASR). */
export function escolherTrack(tracks, preferencias = []) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const pontuar = (t) => {
    const lang = String(t.lang || "").toLowerCase();
    const baseLang = lang.split("-")[0];
    let score = 0;
    preferencias.forEach((p, i) => {
      const pl = String(p).toLowerCase();
      const pBase = pl.split("-")[0];
      if (lang === pl) score = Math.max(score, 1000 - i * 100);
      else if (pBase && baseLang === pBase) score = Math.max(score, 500 - i * 50);
    });
    if (t.kind !== "asr" && t.kind !== "automatica") score += 20;
    return score;
  };
  let melhor = tracks[0];
  let melhorScore = -Infinity;
  for (const t of tracks) {
    const s = pontuar(t);
    if (s > melhorScore) {
      melhorScore = s;
      melhor = t;
    }
  }
  return melhor;
}

/* ===================================================================== *
 * Download da legenda                                                     *
 * ===================================================================== */

function comFormato(url, fmt) {
  try {
    const u = new URL(url);
    u.searchParams.set("fmt", fmt);
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Baixa uma legenda e converte. Devolve { blocos, caracteres, lang } em caso
 * de sucesso ou { indisponivel: motivo } — nunca lança: a ferramenta de vídeo
 * devolve metadados mesmo quando a transcrição não vem.
 */
async function baixarTranscricao(track, { timeoutMs, forcarFormato = null } = {}) {
  if (!track || !track.url) return { indisponivel: "esta plataforma não lista legendas para o vídeo" };
  const alvo = forcarFormato ? comFormato(track.url, forcarFormato) : track.url;
  try {
    const payload = await fetchTextCached(alvo, { timeoutMs, retries: 0 });
    if (!String(payload.text || "").trim()) {
      return {
        indisponivel:
          "a plataforma respondeu com corpo vazio (legenda não servida para acesso anônimo)",
      };
    }
    const fmt = forcarFormato === "json3" ? "json3" : /json/i.test(payload.contentType || "") ? "json3" : null;
    const convertido = legendaConvertida(payload, fmt);
    if (!convertido.blocos.length) {
      return { indisponivel: "a legenda veio, mas sem falas legíveis" };
    }
    return { ...convertido, lang: track.lang || "" };
  } catch (err) {
    if (err instanceof RobotsBloqueadoError) {
      return {
        indisponivel: `bloqueado pelo robots.txt do site (o caminho da legenda está em Disallow)`,
      };
    }
    return { indisponivel: `falha ao baixar a legenda (${err.message})` };
  }
}

/* ===================================================================== *
 * Saída                                                                   *
 * ===================================================================== */

const MAX_CHARS_DESCRICAO = 600;

function encurtarDescricao(texto) {
  const limpo = String(texto || "")
    .replace(/\s+/g, " ")
    .trim();
  if (limpo.length <= MAX_CHARS_DESCRICAO) return limpo;
  return `${limpo.slice(0, MAX_CHARS_DESCRICAO).replace(/\s+\S*$/, "")}...`;
}

/**
 * Monta a saída final em markdown: cabeçalho de metadados + transcrição com
 * timestamps, respeitando o teto de caracteres.
 */
export function montarSaidaVideo({
  urlFinal,
  plataforma,
  titulo,
  canal,
  duracaoSeg,
  publicado,
  views,
  capa,
  descricao,
  aviso,
  tags,
  tracks,
  capitulos,
  transcricao,
  maxChars,
}) {
  const linhas = [];
  linhas.push(`# ${titulo || "(sem título)"}`);
  linhas.push(`URL: ${urlFinal}`);
  linhas.push(`Plataforma: ${plataforma}`);
  if (canal) linhas.push(`Canal: ${canal}`);
  if (duracaoSeg) linhas.push(`Duracao: ${formatarTempo(duracaoSeg)}`);
  if (publicado) linhas.push(`Publicado: ${publicado}`);
  if (views) linhas.push(`Visualizacoes: ${formatarNumero(views)}`);
  if (capa) linhas.push(`Capa: ${capa}`);
  if (Array.isArray(tags) && tags.length) linhas.push(`Tags: ${tags.join(", ")}`);
  const descricaoCurta = encurtarDescricao(descricao);
  if (descricaoCurta) linhas.push(`Descricao: ${descricaoCurta}`);
  if (aviso) linhas.push(`Aviso: ${aviso}`);
  if (Array.isArray(tracks) && tracks.length) {
    const listadas = tracks
      .slice(0, 12)
      .map((t) => `${t.lang}${t.kind === "asr" || t.kind === "automatica" ? " (automatica)" : " (manual)"}`)
      .join(", ");
    linhas.push(`Legendas na plataforma: ${listadas}`);
  }
  if (Array.isArray(capitulos) && capitulos.length) {
    linhas.push(`Capitulos: ${capitulos.length}`);
  }
  if (transcricao && transcricao.blocos && transcricao.blocos.length) {
    linhas.push(
      `Transcricao: ${transcricao.blocos.length} blocos em ${transcricao.lang || "(idioma não informado)"} (~${transcricao.caracteres} caracteres)`
    );
  } else if (transcricao && transcricao.indisponivel) {
    linhas.push(`Transcricao: indisponivel — ${transcricao.indisponivel}`);
  }
  linhas.push("");
  if (Array.isArray(capitulos) && capitulos.length) {
    linhas.push("## Capitulos");
    for (const c of capitulos) {
      linhas.push(`[${formatarTempo(c.seg)}] ${c.titulo || "(sem título)"}`);
    }
    linhas.push("");
  }
  if (transcricao && transcricao.blocos && transcricao.blocos.length) {
    for (const b of transcricao.blocos) {
      linhas.push(`[${formatarTempo(b.seg)}] ${b.texto}`);
    }
    linhas.push("");
    linhas.push("(Transcrição vinda da legenda publicada pela plataforma; não descreve as imagens do vídeo.)");
  } else {
    linhas.push("(Esta ferramenta extrai metadados e transcrição textual; não baixa o vídeo nem gera quadros.)");
  }
  const montado = linhas.join("\n");
  const { text } = truncate(montado, maxChars);
  return text;
}

/* ===================================================================== *
 * Orquestração por plataforma                                             *
 * ===================================================================== */

async function metadadosYouTubeViaOembed(id, { timeoutMs }) {
  const alvo = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${id}`
  )}&format=json`;
  try {
    const { text } = await fetchTextCached(alvo, { timeoutMs, retries: 0 });
    const j = JSON.parse(text);
    return { titulo: j.title || "", canal: j.author_name || "", capa: j.thumbnail_url || "" };
  } catch {
    return null;
  }
}

/** Mensagem curta de um erro, sem a URL no rabo (para caber num aviso). */
export function motivoCurtoDeErro(err) {
  return String((err && err.message) || err || "")
    .replace(/\s*ao acessar\s+\S+.*$/i, "")
    .trim();
}

async function lerYouTube(id, { timeoutMs, maxChars, lang }) {
  const urlPagina = `https://www.youtube.com/watch?v=${id}`;
  let payload = null;
  let finalUrl = urlPagina;
  let erroPagina = null;
  if (quarentenaDaPagina.emQuarentena()) {
    // A página foi recusada há pouco (tipicamente 429 em IP de datacenter,
    // como o do Render). Insistir custa a rodada de retries inteira para
    // receber a mesma recusa — ~1,6 s medidos em dev/_perfil-video.mjs.
    // Nesta janela a leitura vai direto ao oEmbed (que responde) e o motivo
    // continua declarado na saída.
    erroPagina = { message: quarentenaDaPagina.motivo || "HTTP 429 (pagina recusada ha pouco)" };
  } else {
    try {
      // retries: 0 — a página do YouTube não melhora com insistência deste
      // lado; a insistência só atrasa o fallback. No acesso local, onde a
      // página abre, a primeira (e única) tentativa é a que vale.
      payload = await fetchTextCached(urlPagina, { timeoutMs, retries: 0 });
      finalUrl = payload.finalUrl;
    } catch (err) {
      // IP de datacenter (Render incluso) costuma levar HTTP 429 na página
      // /watch. Falhar inteiro perderia o que dá para ler: o oEmbed segue
      // acessível e entrega os metadados básicos — com o bloqueio declarado.
      erroPagina = err;
      quarentenaDaPagina.marcar(err);
    }
  }
  const analise = payload ? analiseYouTube(payload) : null;
  const player = analise ? analise.player : null;

  if (!player || !(player.videoDetails && player.videoDetails.title)) {
    const oembed = await metadadosYouTubeViaOembed(id, { timeoutMs });
    if (oembed && oembed.titulo) {
      return montarSaidaVideo({
        urlFinal: finalUrl,
        plataforma: "YouTube",
        titulo: oembed.titulo,
        canal: oembed.canal,
        capa: oembed.capa,
        aviso: erroPagina
          ? `metadados parciais (via oEmbed): a página completa do vídeo não abriu para este servidor — ${motivoCurtoDeErro(erroPagina)}`
          : undefined,
        transcricao: {
          indisponivel: erroPagina
            ? "sem acesso às faixas de legenda (a página do vídeo foi recusada para este servidor)"
            : "metadados mínimos (oEmbed) — a página não entregou os dados completos do player",
        },
        maxChars,
      });
    }
    if (erroPagina) {
      throw new Error(
        `Não foi possível ler este vídeo do YouTube: a página do vídeo não abriu (${motivoCurtoDeErro(erroPagina)}) e o oEmbed não respondeu.`
      );
    }
    const status = player && player.playabilityStatus ? player.playabilityStatus.status : "";
    return montarSaidaVideo({
      urlFinal: finalUrl,
      plataforma: "YouTube",
      titulo: "(vídeo não acessível)",
      transcricao: {
        indisponivel: status
          ? `o YouTube não liberou este vídeo para acesso anônimo (status: ${status})`
          : "o YouTube não entregou os dados do vídeo nesta leitura (consentimento, idade ou bloqueio temporário)",
      },
      maxChars,
    });
  }

  const meta = metadadosYouTube(player);
  const capitulos = analise.capitulos;
  const track = escolherTrack(meta.tracks, preferenciasDeIdioma(lang));
  const transcricao = track
    ? await baixarTranscricao(track, { timeoutMs, forcarFormato: "json3" })
    : { indisponivel: "este vídeo não lista legendas na página" };
  if (transcricao && transcricao.blocos && track) transcricao.lang = track.lang;

  return montarSaidaVideo({
    urlFinal: finalUrl,
    plataforma: "YouTube",
    titulo: meta.titulo,
    canal: meta.canal,
    duracaoSeg: meta.duracaoSeg,
    publicado: meta.publicado,
    views: meta.views,
    capa: meta.capa,
    descricao: meta.descricao,
    tags: meta.tags,
    tracks: meta.tracks,
    capitulos,
    transcricao,
    maxChars,
  });
}

async function lerVimeo(id, hash, { timeoutMs, maxChars, lang }) {
  const urlConfig = `https://player.vimeo.com/video/${id}/config${hash ? `?h=${encodeURIComponent(hash)}` : ""}`;
  const preferencias = preferenciasDeIdioma(lang);

  try {
    const { text } = await fetchTextCached(urlConfig, { timeoutMs });
    const config = JSON.parse(text);
    const meta = metadadosVimeo(config);
    const track = escolherTrack(meta.tracks, preferencias);
    let transcricao = track
      ? await baixarTranscricao(track, { timeoutMs })
      : { indisponivel: "este vídeo não lista legendas no player" };
    if (transcricao && transcricao.blocos && track) transcricao.lang = track.lang;
    return montarSaidaVideo({
      urlFinal: `https://vimeo.com/${id}`,
      plataforma: "Vimeo",
      titulo: meta.titulo,
      canal: meta.canal,
      duracaoSeg: meta.duracaoSeg,
      publicado: meta.publicado,
      capa: meta.capa,
      descricao: meta.descricao,
      tracks: meta.tracks,
      transcricao,
      maxChars,
    });
  } catch (err) {
    // Fallback: página pública (og tags) — sem transcrição, mas com metadados.
    try {
      const payload = await fetchTextCached(`https://vimeo.com/${id}`, { timeoutMs });
      const meta = metaDePagina(payload);
      return montarSaidaVideo({
        urlFinal: payload.finalUrl,
        plataforma: "Vimeo",
        titulo: meta.titulo,
        canal: meta.canal,
        duracaoSeg: meta.duracaoSeg,
        capa: meta.capa,
        descricao: meta.descricao,
        tracks: meta.tracks,
        transcricao: {
          indisponivel: `o config do player não respondeu (${err.message}); sem acesso às faixas de legenda`,
        },
        maxChars,
      });
    } catch {
      throw err;
    }
  }
}

async function lerLegendaDireta(url, { timeoutMs, maxChars }) {
  const payload = await fetchTextCached(url, { timeoutMs });
  const { finalUrl } = payload;
  const transcricao = legendaConvertida(payload, /json/i.test(payload.contentType || "") ? "json3" : null);
  const nome = (() => {
    try {
      return new URL(finalUrl).pathname.split("/").pop() || "legenda";
    } catch {
      return "legenda";
    }
  })();
  if (!transcricao.blocos.length) {
    return montarSaidaVideo({
      urlFinal: finalUrl,
      plataforma: "Arquivo de legenda",
      titulo: `Legenda: ${nome}`,
      transcricao: { indisponivel: "o arquivo não tinha falas legíveis no formato VTT/SRT/json3" },
      maxChars,
    });
  }
  return montarSaidaVideo({
    urlFinal: finalUrl,
    plataforma: "Arquivo de legenda",
    titulo: `Legenda: ${nome}`,
    tracks: [{ lang: "", kind: "manual", nome, url: finalUrl }],
    transcricao: { ...transcricao, lang: "" },
    maxChars,
  });
}

async function lerPaginaGenerica(url, { timeoutMs, maxChars, lang }) {
  const payload = await fetchTextCached(url, { timeoutMs });
  const { finalUrl } = payload;

  // Página que incorpora um vídeo conhecido (blog com embed): segue o vídeo.
  const embed = embedDePagina(payload);
  if (embed && embed.tipo === "youtube") return lerYouTube(embed.id, { timeoutMs, maxChars, lang });
  if (embed && embed.tipo === "vimeo") return lerVimeo(embed.id, embed.hash, { timeoutMs, maxChars, lang });

  const meta = metaDePagina(payload);
  if (!meta.temVideo) {
    return [
      "# (sem vídeo identificado)",
      `URL: ${finalUrl}`,
      "",
      "Não identifiquei um vídeo nesta página (sem og:video, JSON-LD VideoObject ou <video>).",
      "Use read_page para ler o conteúdo da página, ou passe a URL direta do vídeo.",
    ].join("\n");
  }

  const track = escolherTrack(meta.tracks, preferenciasDeIdioma(lang));
  const transcricao = track
    ? await baixarTranscricao(track, { timeoutMs })
    : { indisponivel: "a página não publica legenda em formato acessível (<track> ausente)" };
  if (transcricao && transcricao.blocos && track) transcricao.lang = track.lang;

  return montarSaidaVideo({
    urlFinal: finalUrl,
    plataforma: meta.site || "Página com vídeo",
    titulo: meta.titulo,
    canal: meta.canal,
    duracaoSeg: meta.duracaoSeg,
    publicado: meta.publicado,
    capa: meta.capa,
    descricao: meta.descricao,
    tracks: meta.tracks,
    transcricao,
    maxChars,
  });
}

/* ===================================================================== *
 * Ferramenta                                                              *
 * ===================================================================== */

/**
 * Lê um vídeo (YouTube, Vimeo ou página com vídeo): metadados publicados e a
 * transcrição da legenda, quando acessível. Nunca baixa mídia.
 */
export async function toolReadVideo(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxChars(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const lang = args.lang ? String(args.lang) : null;

  const deteccao = detectarVideo(parsed.href);
  if (deteccao.tipo === "youtube") return lerYouTube(deteccao.id, { timeoutMs, maxChars, lang });
  if (deteccao.tipo === "vimeo") return lerVimeo(deteccao.id, deteccao.hash, { timeoutMs, maxChars, lang });
  if (deteccao.tipo === "legenda") return lerLegendaDireta(parsed.href, { timeoutMs, maxChars });
  return lerPaginaGenerica(parsed.href, { timeoutMs, maxChars, lang });
}
