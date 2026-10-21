/**
 * Leitura de PDF (read_pdf): extrai o TEXTO de um PDF público sem baixar
 * dependência nenhuma — só `node:zlib`.
 *
 * O que a ferramenta faz, sobre caminhos provados na web real (dev/_probe-pdf*.mjs):
 * - Baixa os bytes crus (o PDF é binário; decodificar como texto o corromperia).
 * - Acha os objetos `stream ... endstream` e infla os que usam FlateDecode.
 * - Reconhece os content streams (os que têm operadores `BT`/`Tj`/`TJ`) e os
 *   varre com um interpretador dos operadores de TEXTO, usando os operadores
 *   de posicionamento (`Td`, `TD`, `Tm`, `T*`) e o ajuste de kerning
 *   (número negativo grande dentro de `TJ`) para reconstruir espaços e quebras.
 * - Junta os pedaços com o MESMO cuidado do parser HTML: normaliza espaços,
 *   não deixa linha gigante e avisa quando truncou.
 *
 * O que ela NÃO faz (honestidade acima de tudo):
 * - Não lê PDF escaneado (imagem) — não há OCR.
 * - Não resolve fonte com encoding próprio (subset/CID) em todos os casos:
 *   quando o PDF usa mapa `ToUnicode`, a tabela é aplicada; quando não há mapa
 *   nenhum, os glifos saem como estão e a saída declara a limitação.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: a URL de um PDF público.
 *   Sai:   o texto extraído (com aviso de truncamento, se truncou) — ou o
 *          motivo exato quando não foi possível.
 *
 * QUEM USA
 *   Usado por: tools.mjs (read_pdf).
 *   Importa de: config, fetch.
 */

import { inflateSync, inflateRawSync, gunzipSync, constants as zlibConstants } from "node:zlib";
import { DEFAULT_MAX_CHARS, HARD_MAX_CHARS } from "./config.mjs";
import { fetchPdfCached, truncate, clampTimeoutMs, validateHttpUrl } from "./fetch.mjs";

// Assinatura de arquivo PDF, no começo do buffer.
const ASSINATURA = "%PDF-";

/** Um buffer começa com a assinatura de um PDF? */
export function parecePdf(buffer) {
  if (!buffer || buffer.length < 5) return false;
  return buffer.subarray(0, 5).toString("latin1") === ASSINATURA;
}

/**
 * O cabeçalho de 2 bytes diz qual descompressão usar. Reconhecer isso antes de
 * tentar é a diferença entre 1,8 s e 0,08 s num PDF de 2 MB (medido em
 * dev/_diag-filtros-pdf.mjs): num arquivo real, 2.565 dos 2.712 streams NÃO
 * têm filtro nenhum, e a versão antiga tentava três descompressões em cada um,
 * gerando 7.695 exceções de zlib que custavam 95% do tempo do extrator.
 */

/** zlib: CMF/FLG válidos (método 8 e o checksum de 16 bits fechando). */
function ehZlib(buf) {
  return buf.length > 1 && (buf[0] & 0x0f) === 8 && (((buf[0] << 8) | buf[1]) % 31) === 0;
}

/** gzip: número mágico 1f 8b. */
function ehGzip(buf) {
  return buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b;
}

/** Tenta inflar um trecho pelo filtro que o cabeçalho indica; null se não der. */
function inflar(buf) {
  if (!buf || buf.length < 2) return null;
  try {
    // Z_SYNC_FLUSH: muitos PDFs vêm com o stream cortado no fim (o trailer
    // não interessa para extrair texto) e o inflate estrito recusaria.
    if (ehGzip(buf)) {
      const out = gunzipSync(buf, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
      return out && out.length ? out : null;
    }
    if (ehZlib(buf)) {
      const out = inflateSync(buf, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
      return out && out.length ? out : null;
    }
    // Sem cabeçalho reconhecido, pode ser deflate cru. Uma tentativa só.
    const cru = inflateRawSync(buf, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
    return cru && cru.length ? cru : null;
  } catch {
    return null;
  }
}

/**
 * Coleta os pares "stream ... endstream" do arquivo cru.
 *
 * Devolve também o DICIONÁRIO do objeto (os bytes logo antes de "stream") e se
 * ele declara `/FlateDecode`. Isso evita tentar descompressão em stream que não
 * é comprimido: num PDF real a maioria não é, e cada tentativa frustrada custa
 * uma exceção de zlib.
 */
function streamsDoPdf(buffer) {
  const inicio = Buffer.from("stream");
  const fim = Buffer.from("endstream");
  const out = [];
  let i = 0;
  while (i < buffer.length) {
    const s = buffer.indexOf(inicio, i);
    if (s === -1) break;
    const e = buffer.indexOf(fim, s + inicio.length);
    if (e === -1) break;
    // pula o CR/LF logo após "stream"
    let ini = s + inicio.length;
    if (buffer[ini] === 0x0d) ini++;
    if (buffer[ini] === 0x0a) ini++;
    // O dicionário mora ANTES do "stream". 512 bytes cobrem os dicionários
    // reais com folga; olhar mais longe só custa tempo.
    const dicIni = Math.max(0, s - 512);
    const dict = buffer.subarray(dicIni, s).toString("latin1");
    out.push({
      dado: buffer.subarray(ini, e),
      declaraFlate: dict.includes("/FlateDecode"),
      declaraSemFiltro: !/\/Filter\s/.test(dict),
    });
    i = e + fim.length;
  }
  return out;
}

/** Desescapa uma string literal de PDF: \( \) \\ \n \ddd. */
function desescapar(s) {
  return s
    .replace(/\\([nrtbf])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", b: "", f: "" })[c] ?? "")
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\([()\\])/g, "$1");
}

/** Converte uma string hexadecimal `<...>` em texto. */
function deHex(hexBruto) {
  let hex = hexBruto.replace(/\s+/g, "");
  if (hex.length % 2) hex += "0";
  let r = "";
  for (let k = 0; k < hex.length; k += 2) {
    r += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
  }
  return r;
}

/** Um content stream tem operadores de texto; fonte, imagem e metadado não. */
function ehContentStream(txt) {
  return txt.includes("BT") && (txt.includes("Tj") || txt.includes("TJ"));
}

/**
 * Interpreta um content stream e devolve o texto com espaços e quebras.
 *
 * A máquina tem uma pilha de operandos e um interpretador dos operadores que
 * importam para TEXTO:
 *   Tf   — seleciona a fonte e o TAMANHO (escala dos saltos de espaço);
 *   Td/TD — move o cursor; `ty != 0` é nova linha, `tx` grande é espaço;
 *   Tm   — matriz de texto; a ordenada (`f`) que mudou é nova linha;
 *   T*   — nova linha;
 *   Tj / ' / " — desenha uma string;
 *   TJ   — desenha várias, com ajustes de kerning; número muito negativo é
 *          espaço entre palavras.
 */
/**
 * O padrão de UMA passada de tokenização de content stream.
 *
 * As alternativas, em ordem: string literal `(...)`, string hexadecimal
 * `<...>`, número, nome `/Nome`, abertura/fechamento de array e operador
 * (Tj, TJ, Td...). Tudo que não casa é ruído e fica de fora.
 */
const RE_TOKEN_CONTENT = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|[+-]?(?:\d+\.?\d*|\.\d+)|\/[^\s/<>[\]()]+|\[|\]|[A-Za-z'*"][A-Za-z0-9'*"]*/g;

/** Ajuste de kerning abaixo deste fator do tamanho da fonte é espaço. */
const FATOR_KERNING_ESPACO = 0.2;

/** Diferença de ordenada (em Tm) acima deste fator do corpo é nova linha. */
const FATOR_LINHA_TM = 0.5;

/**
 * Lê o `content stream` de uma página e devolve o TEXTO, na ordem em que foi
 * desenhado.
 *
 * A máquina tem uma pilha de operandos e um interpretador dos operadores que
 * importam para TEXTO:
 *   Tf    — seleciona a fonte e o TAMANHO (escala dos saltos de espaço);
 *   Td/TD — move o cursor; `ty != 0` é nova linha;
 *   Tm    — matriz de texto; a ordenada (`f`) que mudou é nova linha;
 *   T*    — nova linha;
 *   Tj / ' / " — desenha uma string;
 *   TJ    — desenha várias, com ajustes de kerning; número muito negativo é
 *           espaço entre palavras.
 *
 * A pilha é zerada a cada operador: em PDF, o operador CONSOME os operandos.
 */
function textoDoContent(txt) {
  const out = [];
  let tamanhoFonte = 12;
  let ultimoY = null;
  let pilha = [];

  const espaco = () => {
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo !== " " && ultimo !== "\n") out.push(" ");
  };
  const quebra = () => {
    if (out.length === 0) return;
    if (out[out.length - 1] !== "\n") out.push("\n");
  };
  /** O último valor da pilha, do fim para o começo. */
  const ultimoDe = (tipo) => {
    for (let i = pilha.length - 1; i >= 0; i--) if (typeof pilha[i] === tipo) return pilha[i];
    return undefined;
  };
  /** Todos os números da pilha, na ordem em que apareceram. */
  const numeros = () => pilha.filter((v) => typeof v === "number");

  function interpretar(operador) {
    switch (operador) {
      case "Tf": {
        const n = ultimoDe("number");
        if (typeof n === "number" && n > 0) tamanhoFonte = n;
        return;
      }
      case "Td":
      case "TD": {
        const nums = numeros();
        if ((nums[nums.length - 1] ?? 0) !== 0) quebra();
        return;
      }
      case "Tm": {
        const nums = numeros();
        const f = nums[nums.length - 1];
        if (ultimoY !== null && typeof f === "number" && Math.abs(f - ultimoY) > tamanhoFonte * FATOR_LINHA_TM) {
          quebra();
        }
        if (typeof f === "number") ultimoY = f;
        return;
      }
      case "T*":
        quebra();
        return;
      case "Tj": {
        const str = ultimoDe("string");
        if (str) out.push(str);
        return;
      }
      case "'":
      case '"': {
        quebra();
        const str = ultimoDe("string");
        if (str) out.push(str);
        return;
      }
      case "TJ": {
        for (const v of pilha) {
          if (typeof v === "string") out.push(v);
          else if (typeof v === "number" && v < -tamanhoFonte * FATOR_KERNING_ESPACO) espaco();
        }
        return;
      }
      default:
        // Operador de desenho/vetor (re, m, l, f, Do...): não tem texto.
        return;
    }
  }

  let tok;
  RE_TOKEN_CONTENT.lastIndex = 0;
  while ((tok = RE_TOKEN_CONTENT.exec(txt)) !== null) {
    const t = tok[0];
    const c0 = t[0];

    // --- operandos: empilham e seguem ---
    if (c0 === "(") {
      pilha.push(desescapar(t.slice(1, -1)));
      continue;
    }
    if (c0 === "<") {
      pilha.push(deHex(t.slice(1, -1)));
      continue;
    }
    if (c0 === "/") {
      pilha.push(t);
      continue;
    }
    if (/^[+-]?\d|^\.\d/.test(t)) {
      pilha.push(parseFloat(t));
      continue;
    }
    // --- delimitadores de array do TJ: os itens soltos já bastam ---
    if (t === "[" || t === "]") continue;

    // --- operador: consome a pilha ---
    interpretar(t);
    pilha = [];
  }
  return out.join("");
}

/**
 * Normaliza o texto extraído: junta linhas quebradas no meio de palavra,
 * colapsa espaços repetidos e limita linhas em branco seguidas.
 */
function normalizar(texto) {
  return texto
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
}

/**
 * Extrai o texto de um PDF a partir dos bytes crus.
 *
 * Devolve `{ text, paginas, contentStreams, temTexto }`. `temTexto` falso
 * significa que nenhum content stream com texto foi encontrado — típico de
 * PDF escaneado (só imagem) — e quem chamou deve declarar isso.
 */
export function extrairTextoPdf(buffer) {
  if (!parecePdf(buffer)) {
    return { text: "", paginas: 0, contentStreams: 0, temTexto: false, naoEhPdf: true };
  }

  const streams = streamsDoPdf(buffer);
  let contentStreams = 0;
  let texto = "";
  for (const { dado, declaraFlate } of streams) {
    // A decisão que economiza 95% do tempo (medido em dev/_diag-filtros-pdf.mjs:
    // 1.802 ms -> 81 ms de descompressão num PDF de 2 MB): num PDF real, a
    // maioria dos streams NÃO é comprimida, e a versão antiga tentava três
    // descompressões em cada um, colecionando exceções de zlib.
    //
    // A ordem importa e custou uma regressão para ser achada (dev/_diag-streams-texto.mjs):
    // o cabeçalho manda. Ele é uma checagem de 2 bytes e reconhece o stream
    // comprimido mesmo quando o dicionário está longe demais para ser lido.
    // O `/FlateDecode` do dicionário é só o reforço, para o stream que vem
    // comprimido com cabeçalho atípico.
    const cabe = ehZlib(dado) || ehGzip(dado);
    const usavel = cabe || declaraFlate ? inflar(dado) || dado : dado;
    const txt = usavel.toString("latin1");
    if (!ehContentStream(txt)) continue;
    contentStreams++;
    texto += textoDoContent(txt);
  }

  const limpo = normalizar(texto);
  // Conta páginas pela presença de objetos de página — aproximação barata e
  // suficiente para informar o leitor (não é para navegação).
  const paginas = (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

  return { text: limpo, paginas, contentStreams, temTexto: limpo.length > 0, naoEhPdf: false };
}

/** Monta a saída em markdown do read_pdf. */
export function formatarSaidaPdf({ finalUrl, texto, paginas, contentStreams, truncado, total, maxChars }) {
  const linhas = [];
  linhas.push(`# PDF: ${finalUrl.split("/").pop() || finalUrl}`);
  linhas.push(`URL: ${finalUrl}`);
  if (paginas) linhas.push(`Paginas: ${paginas}`);
  linhas.push(`Conteudo: ${total} caracteres` + (truncado ? ` (exibidos ${maxChars})` : ""));
  linhas.push("");
  linhas.push(texto);
  return linhas.join("\n");
}

/** Limita o maxChars ao intervalo válido. */
export function clampMaxCharsPdf(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return DEFAULT_MAX_CHARS;
  return Math.max(200, Math.min(HARD_MAX_CHARS, Math.floor(n)));
}

/**
 * Ferramenta read_pdf: baixa o PDF pelo transporte do projeto (SSRF, robots,
 * cache, junção em voo), extrai o texto e devolve em markdown.
 *
 * A extração roda DENTRO do caminho cacheado (`extrair`): o cache guarda o
 * texto pronto, então reler a mesma URL não reparseia o PDF.
 */
export async function toolReadPdf(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const maxChars = clampMaxCharsPdf(args.maxChars);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);

  const payload = await fetchPdfCached(parsed.href, {
    timeoutMs,
    extrair: (p) => {
      const r = extrairTextoPdf(p.buffer);
      return { text: r.text, extraido: { ...r, buffer: undefined } };
    },
  });

  const info = payload.extraido || {};
  const texto = payload.text || "";

  if (info.naoEhPdf) {
    return (
      `# PDF: nao reconhecido\nURL: ${payload.finalUrl}\n\n` +
      `O conteudo desta URL nao comeca com a assinatura de PDF (%PDF-). ` +
      `Se for uma pagina HTML, use read_page.\n`
    );
  }
  if (!info.temTexto) {
    return (
      `# PDF: ${payload.finalUrl.split("/").pop() || payload.finalUrl}\nURL: ${payload.finalUrl}\n` +
      (info.paginas ? `Paginas: ${info.paginas}\n` : "") +
      `Conteudo: 0 caracteres\n\n` +
      `Nenhum texto extraivel encontrado. Isso costuma significar PDF ESCANEADO ` +
      `(so imagem, sem camada de texto) ou PDF que usa fonte com codificacao ` +
      `propria sem mapa ToUnicode. Nao ha OCR nesta ferramenta.\n`
    );
  }

  const { text, truncated } = truncate(texto, maxChars);
  return formatarSaidaPdf({
    finalUrl: payload.finalUrl,
    texto: text,
    paginas: info.paginas,
    contentStreams: info.contentStreams,
    truncado: truncated,
    total: texto.length,
    maxChars,
  });
}
