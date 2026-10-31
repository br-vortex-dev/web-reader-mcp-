/**
 * documentos.mjs — DOCX, PPTX e EPUB (read_document).
 *
 * O QUE É
 *   As três famílias são ZIP com XML dentro. Em vez de uma biblioteca (o
 *   projeto não tem dependências), este módulo lê o índice do ZIP, infla só as
 *   partes que importam e extrai o texto:
 *
 *     DOCX  word/document.xml            (parágrafos, tabelas)
 *     PPTX  ppt/slides/slideN.xml        (na ordem da apresentação)
 *     EPUB  META-INF/container.xml → OPF  (spine = ordem dos capítulos)
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: a URL do arquivo + maxChars.
 *   Sai:   o texto em markdown, com título/autor/data quando o arquivo declara.
 *
 * LIMITAÇÕES HONESTAS
 *   - .doc antigo (Word 97-2003) é binário OLE, não ZIP: não é lido aqui.
 *   - XLSX não é lido (planilha exige outra interpretação; leia como tabela).
 *   - PDF tem ferramenta própria (read_pdf).
 *   - ZIP64 (arquivos acima de 4 GB) não é suportado; o teto de download de
 *     24 MB já barra esse tamanho bem antes.
 *   - Formatação, imagem e comentário não viram texto: só o que está escrito.
 *
 * QUEM USA
 *   Usado por: tools.mjs.
 *   Importa de: config, fetch, html-parser, pdf (só a assinatura).
 */

import { inflateRawSync } from "node:zlib";
import { MAX_RESPONSE_BYTES_DOCUMENTO, DEFAULT_MAX_CHARS, HARD_MAX_CHARS } from "./config.mjs";
import { fetchBinarioCached, validateHttpUrl, clampTimeoutMs, truncate } from "./fetch.mjs";
import { htmlToMarkdown, decodeEntities } from "./html-parser.mjs";
import { parecePdf } from "./pdf.mjs";

// Tetos de segurança do ZIP. Um DOCX normal tem poucos MB; um "zip bomb"
// declara um arquivo pequeno e infla para gigabytes. O teto por entrada e o
// teto total param a inflação antes que ela consuma a memória do servidor.
const MAX_ENTRADAS = 5000;
const MAX_ENTRADA_BYTES = 16 * 1024 * 1024;
const MAX_SAIDA_BYTES = 40 * 1024 * 1024;
// O servidor entrega no máximo 25 mil caracteres; guardar 500 mil no cache já
// sobra para qualquer leitura e mantém a entrada leve.
const LIMITE_TEXTO = 500_000;
const MAX_CAPITULOS_EPUB = 100;

/* ===================================================================== *
 * ZIP                                                                     *
 * ===================================================================== */

function pareceZip(buffer) {
  return Boolean(buffer) && buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

/**
 * O End Of Central Directory fica no fim do arquivo, depois dos comentários.
 * O padrão permite um comentário de até 65.535 bytes, então a assinatura é
 * procurada nessa janela final, de trás para frente.
 */
function acharFimDoIndice(buffer) {
  if (buffer.length < 22) return -1;
  const minimo = Math.max(0, buffer.length - 65_557);
  for (let pos = buffer.length - 22; pos >= minimo; pos--) {
    if (buffer.readUInt32LE(pos) === 0x06054b50) return pos;
  }
  return -1;
}

/**
 * Lê o índice central: nome, método e localização de cada entrada. É dele que
 * saem os tamanhos REAIS (o cabeçalho local pode vir com zero quando o
 * arquivo usa data descriptor).
 */
function lerIndiceZip(buffer) {
  const fim = acharFimDoIndice(buffer);
  if (fim === -1) throw new Error("arquivo ZIP sem indice central");

  const total = buffer.readUInt16LE(fim + 10);
  const inicio = buffer.readUInt32LE(fim + 16);
  if (total === 0xffff || inicio === 0xffffffff) {
    throw new Error("ZIP64 nao e suportado (arquivo grande demais para este leitor)");
  }
  if (total > MAX_ENTRADAS) {
    throw new Error(`ZIP com ${total} entradas (maximo ${MAX_ENTRADAS})`);
  }
  if (inicio >= buffer.length) throw new Error("indice ZIP aponta para fora do arquivo");

  const entradas = new Map();
  let pos = inicio;
  for (let i = 0; i < total; i++) {
    if (pos + 46 > buffer.length) throw new Error("indice ZIP truncado");
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("entrada do indice ZIP invalida");
    const flags = buffer.readUInt16LE(pos + 8);
    const metodo = buffer.readUInt16LE(pos + 10);
    const comprimido = buffer.readUInt32LE(pos + 20);
    const original = buffer.readUInt32LE(pos + 24);
    const nomeLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const comentarioLen = buffer.readUInt16LE(pos + 32);
    const local = buffer.readUInt32LE(pos + 42);
    if (comprimido === 0xffffffff || original === 0xffffffff || local === 0xffffffff) {
      throw new Error("ZIP64 nao e suportado (arquivo grande demais para este leitor)");
    }
    const fimNome = pos + 46 + nomeLen;
    if (fimNome > buffer.length) throw new Error("nome de entrada ZIP truncado");
    const nome = buffer.toString("utf8", pos + 46, fimNome);
    entradas.set(nome, { flags, metodo, comprimido, original, local });
    pos = fimNome + extraLen + comentarioLen;
  }
  return entradas;
}

/** Infla uma entrada, com o orçamento compartilhado de saída. */
function lerEntradaZip(buffer, entrada, estado) {
  if (entrada.flags & 1) throw new Error("arquivo protegido por senha");
  if (entrada.original > MAX_ENTRADA_BYTES) {
    throw new Error("parte interna do documento grande demais");
  }
  if (entrada.local + 30 > buffer.length) throw new Error("cabecalho local ZIP truncado");
  if (buffer.readUInt32LE(entrada.local) !== 0x04034b50) throw new Error("cabecalho local ZIP invalido");
  const nomeLen = buffer.readUInt16LE(entrada.local + 26);
  const extraLen = buffer.readUInt16LE(entrada.local + 28);
  const inicio = entrada.local + 30 + nomeLen + extraLen;
  const fim = inicio + entrada.comprimido;
  if (fim > buffer.length) throw new Error("conteudo ZIP truncado");
  const bruto = buffer.subarray(inicio, fim);

  let dados;
  if (entrada.metodo === 0) {
    dados = bruto;
  } else if (entrada.metodo === 8) {
    // maxOutputLength é a proteção contra zip bomb: o zlib para ao passar do
    // teto em vez de inflar o arquivo inteiro na memória.
    dados = inflateRawSync(bruto, { maxOutputLength: MAX_ENTRADA_BYTES });
  } else {
    throw new Error(`metodo de compressao ${entrada.metodo} nao suportado`);
  }

  estado.total += dados.length;
  if (estado.total > MAX_SAIDA_BYTES) throw new Error("conteudo descomprimido grande demais (zip bomb?)");
  return dados;
}

function lerTextoZip(buffer, entradas, nome, estado) {
  const entrada = entradas.get(nome);
  if (!entrada) return null;
  return lerEntradaZip(buffer, entrada, estado).toString("utf8");
}

/* ===================================================================== *
 * XML                                                                     *
 * ===================================================================== */

/** Primeira tag XML com esse nome (sem namespace no nome pedido). */
function primeiraTagXml(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const achado = re.exec(xml || "");
  if (!achado) return "";
  return decodeEntities(achado[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function atributoXml(tag, nome) {
  const re = new RegExp(`\\b${nome}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const achado = re.exec(tag);
  return achado ? decodeEntities(achado[2] ?? achado[3] ?? "").trim() : "";
}

/**
 * Percorre o XML em uma passada e devolve só o texto de conteúdo, usando as
 * tags de estrutura para separar parágrafo, célula e linha. Tudo que não é
 * `<tagTexto>` (propriedade, comentário, revisão) fica de fora.
 */
function textoDeXml(xml, { tagTexto, tagParagrafo }) {
  let saida = "";
  let profundidade = 0;
  const re = /<[^>]+>|[^<]+/g;
  let achado;
  while ((achado = re.exec(xml)) !== null) {
    const parte = achado[0];
    if (parte.charCodeAt(0) !== 60) {
      if (profundidade > 0) saida += decodeEntities(parte);
      continue;
    }
    // A fronteira do nome importa: `<w:t` também é prefixo de `<w:tbl>` e
    // `<w:tab>`; sem ela, abrir uma tabela "abria" um bloco de texto que nunca
    // fechava e o conteúdo seguinte era engolido.
    const aberturaDeTexto =
      parte.startsWith(`<${tagTexto}`) &&
      /^[\s>]/.test(parte.charAt(tagTexto.length + 1)) &&
      !parte.endsWith("/>");
    if (aberturaDeTexto) {
      profundidade++;
    } else if (parte === `</${tagTexto}>`) {
      if (profundidade > 0) profundidade--;
    } else if (parte === `</${tagParagrafo}>`) {
      saida += "\n\n";
    } else if (parte === "</w:tc>") {
      saida += " | ";
    } else if (parte === "</w:tr>") {
      saida += "\n";
    } else if (parte === "<w:tab/>" || parte === "<w:tab />") {
      saida += "\t";
    } else if (parte === "<w:br/>" || parte === "<w:br />" || parte === "<a:br/>" || parte === "<a:br />") {
      saida += "\n";
    }
  }
  return saida;
}

/** Normalização final: sem CRLF, sem linha gigante de espaços, sem vazio triplo. */
function normalizarTexto(texto) {
  return String(texto || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ===================================================================== *
 * DOCX                                                                    *
 * ===================================================================== */

function extrairDocx(buffer, entradas, estado) {
  const xml = lerTextoZip(buffer, entradas, "word/document.xml", estado);
  if (!xml) return { erro: "o DOCX nao tem word/document.xml (arquivo corrompido?)" };

  const texto = normalizarTexto(textoDeXml(xml, { tagTexto: "w:t", tagParagrafo: "w:p" }));
  const props = lerTextoZip(buffer, entradas, "docProps/core.xml", estado) || "";

  return {
    texto,
    titulo: primeiraTagXml(props, "dc:title"),
    autor: primeiraTagXml(props, "dc:creator"),
    modificado: primeiraTagXml(props, "dcterms:modified"),
  };
}

/* ===================================================================== *
 * PPTX                                                                    *
 * ===================================================================== */

/** Ordem dos slides pela apresentação; se as relações falharem, pela numeração. */
function slidesEmOrdem(buffer, entradas, estado) {
  const porNome = [...entradas.keys()]
    .filter((nome) => /^ppt\/slides\/slide\d+\.xml$/.test(nome))
    .sort((a, b) => {
      const na = Number((/slide(\d+)\.xml$/.exec(a) || [])[1] || 0);
      const nb = Number((/slide(\d+)\.xml$/.exec(b) || [])[1] || 0);
      return na - nb;
    });

  const rels = lerTextoZip(buffer, entradas, "ppt/_rels/presentation.xml.rels", estado);
  const apresentacao = lerTextoZip(buffer, entradas, "ppt/presentation.xml", estado);
  if (!rels || !apresentacao) return porNome;

  const destinos = new Map();
  const reRel = /<Relationship\b[^>]*>/gi;
  let rel;
  while ((rel = reRel.exec(rels)) !== null) {
    const id = atributoXml(rel[0], "Id");
    const alvo = atributoXml(rel[0], "Target");
    if (!id || !alvo) continue;
    const caminho = alvo.startsWith("/") ? alvo.slice(1) : juntarCaminho("ppt/presentation.xml", alvo);
    destinos.set(id, caminho);
  }

  const ordem = [];
  const reSlide = /<p:sldId\b[^>]*>/gi;
  let slide;
  while ((slide = reSlide.exec(apresentacao)) !== null) {
    const id = /\br:id\s*=\s*("([^"]*)"|'([^']*)')/i.exec(slide[0]);
    const caminho = id ? destinos.get(id[2] ?? id[3]) : null;
    if (caminho && entradas.has(caminho)) ordem.push(caminho);
  }
  return ordem.length > 0 ? ordem : porNome;
}

function extrairPptx(buffer, entradas, estado) {
  const slides = slidesEmOrdem(buffer, entradas, estado);
  if (slides.length === 0) return { erro: "o PPTX nao tem slides legiveis" };

  const partes = [];
  slides.forEach((nome, i) => {
    const xml = lerTextoZip(buffer, entradas, nome, estado);
    if (!xml) return;
    const texto = normalizarTexto(textoDeXml(xml, { tagTexto: "a:t", tagParagrafo: "a:p" }));
    if (texto) partes.push(`## Slide ${i + 1}\n\n${texto}`);
  });

  const props = lerTextoZip(buffer, entradas, "docProps/core.xml", estado) || "";
  return {
    texto: partes.join("\n\n"),
    titulo: primeiraTagXml(props, "dc:title"),
    autor: primeiraTagXml(props, "dc:creator"),
    modificado: primeiraTagXml(props, "dcterms:modified"),
    unidades: slides.length,
  };
}

/* ===================================================================== *
 * EPUB                                                                    *
 * ===================================================================== */

/** Junta dois caminhos dentro do ZIP, resolvendo "." e "..". */
function juntarCaminho(base, href) {
  const partes = (base ? base.split("/").slice(0, -1) : []).concat(href.split("/"));
  const saida = [];
  for (const parte of partes) {
    if (!parte || parte === ".") continue;
    if (parte === "..") saida.pop();
    else saida.push(parte);
  }
  return saida.join("/");
}

/** Texto de XHTML sem os links internos do livro, que só poluem a leitura. */
function xhtmlParaTexto(xhtml, caminho) {
  const markdown = htmlToMarkdown(xhtml, "https://epub.invalid/" + caminho);
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

function extrairEpub(buffer, entradas, estado) {
  const container = lerTextoZip(buffer, entradas, "META-INF/container.xml", estado);
  if (!container) return { erro: "o EPUB nao tem META-INF/container.xml" };

  const achado = /<rootfile\b[^>]*>/.exec(container);
  const caminhoOpf = achado ? atributoXml(achado[0], "full-path") : "";
  if (!caminhoOpf) return { erro: "o EPUB nao aponta o arquivo OPF no container" };

  const opf = lerTextoZip(buffer, entradas, caminhoOpf, estado);
  if (!opf) return { erro: `o OPF do EPUB nao foi encontrado (${caminhoOpf})` };

  // Manifesto: id → href. Só os documentos XHTML interessam.
  const manifesto = new Map();
  const reItem = /<item\b[^>]*>/gi;
  let item;
  while ((item = reItem.exec(opf)) !== null) {
    const id = atributoXml(item[0], "id");
    const href = atributoXml(item[0], "href");
    const tipo = atributoXml(item[0], "media-type");
    if (!id || !href) continue;
    if (tipo && !/xhtml|html/i.test(tipo)) continue;
    manifesto.set(id, href);
  }

  const ordem = [];
  const reRef = /<itemref\b[^>]*>/gi;
  let ref;
  while ((ref = reRef.exec(opf)) !== null) {
    const id = atributoXml(ref[0], "idref");
    if (id && manifesto.has(id)) ordem.push(manifesto.get(id));
  }

  const capitulos = [];
  for (const href of ordem.slice(0, MAX_CAPITULOS_EPUB)) {
    const caminho = juntarCaminho(caminhoOpf, decodeURIComponentSeguro(href));
    const xhtml = lerTextoZip(buffer, entradas, caminho, estado);
    if (!xhtml) continue;
    const texto = normalizarTexto(xhtmlParaTexto(xhtml, caminho));
    if (texto) capitulos.push(texto);
  }

  return {
    texto: capitulos.join("\n\n---\n\n"),
    titulo: primeiraTagXml(opf, "dc:title"),
    autor: primeiraTagXml(opf, "dc:creator"),
    modificado: primeiraTagXml(opf, "dc:date") || primeiraTagXml(opf, "dc:modified"),
    unidades: capitulos.length,
  };
}

function decodeURIComponentSeguro(valor) {
  try {
    return decodeURIComponent(valor);
  } catch {
    return valor;
  }
}

/* ===================================================================== *
 * Extração principal                                                      *
 * ===================================================================== */

function detectarFormato(entradas) {
  if (entradas.has("word/document.xml")) return "DOCX";
  if ([...entradas.keys()].some((nome) => /^ppt\/slides\/slide\d+\.xml$/.test(nome))) return "PPTX";
  if (entradas.has("META-INF/container.xml")) return "EPUB";
  return "";
}

/**
 * Extrai texto e metadados dos bytes do arquivo. Devolve `{erro}` para os
 * casos previstos (formato não suportado, arquivo protegido) — quem chamou
 * transforma isso numa resposta clara, não numa exceção.
 */
export function extrairDocumento(buffer) {
  if (parecePdf(buffer)) {
    return { formato: "PDF", erro: "este arquivo e um PDF; use read_pdf" };
  }
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0xd0cf11e0) {
    return {
      formato: "DOC/XLS/PPT antigo",
      erro:
        "formato binario antigo do Office (97-2003). Converta para DOCX/PPTX ou use " +
        "read_pdf se for um PDF renomeado",
    };
  }
  if (!pareceZip(buffer)) {
    return { formato: "desconhecido", erro: "nao e DOCX, PPTX nem EPUB (nao comeca com assinatura ZIP)" };
  }

  let entradas;
  try {
    entradas = lerIndiceZip(buffer);
  } catch (err) {
    return { formato: "ZIP", erro: err.message };
  }

  const formato = detectarFormato(entradas);
  if (!formato) {
    return {
      formato: "ZIP",
      erro: "ZIP comum: nao tem DOCX, PPTX nem EPUB dentro",
    };
  }

  const estado = { total: 0 };
  let resultado;
  try {
    if (formato === "DOCX") resultado = extrairDocx(buffer, entradas, estado);
    else if (formato === "PPTX") resultado = extrairPptx(buffer, entradas, estado);
    else resultado = extrairEpub(buffer, entradas, estado);
  } catch (err) {
    return { formato, erro: err.message };
  }

  if (resultado.erro) return { formato, erro: resultado.erro };

  const texto = normalizarTexto(resultado.texto);
  return {
    formato,
    texto: texto.slice(0, LIMITE_TEXTO),
    caracteres: texto.length,
    truncado: texto.length > LIMITE_TEXTO,
    titulo: resultado.titulo || "",
    autor: resultado.autor || "",
    modificado: resultado.modificado || "",
    unidades: resultado.unidades || 0,
  };
}

function nomeDoArquivo(url) {
  try {
    const caminho = new URL(url).pathname;
    return decodeURIComponentSeguro(caminho.split("/").filter(Boolean).pop() || url);
  } catch {
    return url;
  }
}

function formatarData(valor) {
  const texto = String(valor || "").trim();
  return texto.length > 40 ? texto.slice(0, 40) : texto;
}

/**
 * Ferramenta read_document.
 */
export async function toolReadDocument(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const pedido = Number(args.maxChars);
  const maxChars = Number.isFinite(pedido)
    ? Math.max(200, Math.min(HARD_MAX_CHARS, Math.floor(pedido)))
    : DEFAULT_MAX_CHARS;

  const payload = await fetchBinarioCached(parsed.href, {
    timeoutMs,
    sufixo: "#doc",
    maxBytes: MAX_RESPONSE_BYTES_DOCUMENTO,
    extrair: (p) => {
      const resultado = extrairDocumento(p.buffer);
      return { text: resultado.texto || "", extraido: resultado };
    },
  });

  const info = payload.extraido || {};
  const nome = nomeDoArquivo(payload.finalUrl);

  if (info.erro) {
    return (
      `# Documento: ${nome}\nURL: ${payload.finalUrl}\n` +
      (info.formato ? `Formato detectado: ${info.formato}\n` : "") +
      `\nNao foi possivel extrair o texto: ${info.erro}.\n`
    );
  }

  if (!info.texto) {
    return (
      `# Documento: ${nome}\nURL: ${payload.finalUrl}\nFormato: ${info.formato}\n\n` +
      `O arquivo foi lido, mas nao tem texto extraivel (pode ser so imagem/formatacao).\n`
    );
  }

  const { text, truncated } = truncate(info.texto, maxChars);
  const linhas = [
    `# Documento: ${nome}`,
    `URL: ${payload.finalUrl}`,
    `Formato: ${info.formato}`,
  ];
  if (info.titulo) linhas.push(`Titulo: ${info.titulo}`);
  if (info.autor) linhas.push(`Autor: ${info.autor}`);
  if (info.modificado) linhas.push(`Modificado: ${formatarData(info.modificado)}`);
  if (info.formato === "PPTX") linhas.push(`Slides: ${info.unidades}`);
  if (info.formato === "EPUB") linhas.push(`Capitulos: ${info.unidades}`);
  linhas.push(
    `Conteudo: ${info.caracteres}` +
      (info.truncado ? "+" : "") +
      ` caracteres` +
      (truncated ? ` (exibidos ${text.length})` : "")
  );
  linhas.push("");
  linhas.push(text);
  return linhas.join("\n");
}
