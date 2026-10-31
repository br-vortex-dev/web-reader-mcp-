/**
 * faq.mjs — perguntas frequentes (extract_faq).
 *
 * O QUE É
 *   Extrai pares pergunta/resposta de duas fontes: os dados estruturados
 *   (JSON-LD FAQPage) e a seção visível com título de FAQ. A primeira é
 *   precisa; a segunda cobre site que não publica JSON-LD.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: a URL + limite de perguntas e caracteres.
 *   Sai:   perguntas numeradas com a resposta inteira (recortada), sem
 *          repetir a mesma pergunta quando as duas fontes concordam.
 *
 * QUEM USA
 *   Usado por: tools.mjs.
 *   Importa de: conversao, fetch, json-ld, relevancia.
 */

import {
  fetchTextDocumentoCached,
  validateHttpUrl,
  clampTimeoutMs,
  clampMaxChars,
  ensureHtml,
  truncate,
} from "./fetch.mjs";
import { markdownCompleto } from "./conversao.mjs";
import { normalizarTexto, recortarTrecho } from "./relevancia.mjs";
import { extrairJsonLd, tiposDe, textoDe } from "./json-ld.mjs";

const LIMITE_RESPOSTA = 1200;
const TAMANHO_MAXIMO_PERGUNTA = 300;

// Títulos que anunciam uma seção de FAQ, nas línguas que o servidor mais vê.
const TITULO_DE_FAQ =
  /(^|\b)(faq|perguntas frequentes|duvidas frequentes|questoes frequentes|frequently asked questions|common questions|preguntas frecuentes|questions frequentes)(\b|$)/;

/** Uma linha é pergunta quando termina em "?" ou vem rotulada (Q:, P1:). */
function parecePergunta(texto) {
  const limpo = String(texto || "")
    .replace(/[*_`]/g, "")
    .trim();
  if (!limpo || limpo.length > TAMANHO_MAXIMO_PERGUNTA) return false;
  return /\?\s*$/.test(limpo) || /^(pergunta|question|q)\s*\d*\s*[:\-.]/i.test(limpo);
}

/**
 * Pergunta escrita em PARÁGRAFO (não em título). Aqui o crivo é mais duro de
 * propósito: no fim de páginas de FAQ mora o rodapé, e uma linha como
 * "Last updated ... [Found a bug](...?)" termina em "?" sem ser pergunta.
 * Link na própria linha e cauda longa são marcas de navegação/rodapé — o
 * título, que é estrutura, continua aceitando qualquer "?".
 */
function parecePerguntaDeParagrafo(texto) {
  if (!parecePergunta(texto)) return false;
  const limpo = String(texto || "").trim();
  if (/\]\(/.test(limpo)) return false;
  return limpo.split(/\s+/).length <= 25;
}

function limparPergunta(texto) {
  return String(texto || "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Perguntas do JSON-LD FAQPage (mainEntity[s]). */
function perguntasDoJsonLd(itens) {
  const perguntas = [];
  for (const item of itens) {
    if (!tiposDe(item).some((tipo) => tipo.toLowerCase() === "faqpage")) continue;
    const entidades = Array.isArray(item.mainEntity) ? item.mainEntity : item.mainEntity ? [item.mainEntity] : [];
    for (const entidade of entidades) {
      const pergunta = textoDe(entidade && entidade.name);
      const resposta = textoDe(entidade && (entidade.acceptedAnswer || entidade.suggestedAnswer));
      if (!pergunta || !resposta) continue;
      perguntas.push({
        pergunta: limparPergunta(pergunta),
        resposta: resposta.replace(/\s+/g, " ").trim().slice(0, LIMITE_RESPOSTA),
        origem: "dados estruturados",
      });
    }
  }
  return perguntas;
}

/**
 * Perguntas da seção visível.
 *
 * Percorre o markdown com uma pilha simples de títulos: o nível do título que
 * abriu a seção de FAQ é a fronteira; o que está abaixo dele é conteúdo da
 * seção. Dentro da seção, uma pergunta pode ser um subtítulo (padrão de
 * documentação) ou um parágrafo que termina em "?" (padrão de <details>).
 * A resposta é tudo até a próxima pergunta ou o fim da seção.
 */
function perguntasDaSecao(markdown) {
  const linhas = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const perguntas = [];
  let nivelFaq = 0;
  let pergunta = null;
  let resposta = [];
  let dentroDeCerca = false;
  let origem = "";

  const guardar = () => {
    if (!pergunta) return;
    const texto = resposta.join("\n").trim();
    if (texto) {
      perguntas.push({
        pergunta,
        resposta: texto.replace(/\n{3,}/g, "\n\n").slice(0, LIMITE_RESPOSTA),
        origem,
      });
    }
    pergunta = null;
    resposta = [];
  };

  for (const linha of linhas) {
    if (linha.trimStart().startsWith("```")) {
      dentroDeCerca = !dentroDeCerca;
      if (pergunta) resposta.push(linha);
      continue;
    }
    if (dentroDeCerca) {
      if (pergunta) resposta.push(linha);
      continue;
    }

    const titulo = /^(#{1,6})\s+(.+?)\s*$/.exec(linha);
    if (titulo) {
      const nivel = titulo[1].length;
      const texto = titulo[2].trim();
      // Título de nível igual ou acima fecha a seção de FAQ.
      if (nivelFaq > 0 && nivel <= nivelFaq) {
        guardar();
        nivelFaq = 0;
      }
      if (nivelFaq === 0) {
        if (TITULO_DE_FAQ.test(normalizarTexto(texto))) {
          nivelFaq = nivel;
          origem = `secao "${texto}"`;
        }
        continue;
      }
      if (nivel > nivelFaq && parecePergunta(texto)) {
        guardar();
        pergunta = limparPergunta(texto);
        continue;
      }
      // Outro título dentro da FAQ (categoria, "Saiba mais") encerra a
      // resposta atual, mas o conteúdo seguinte continua na seção.
      guardar();
      continue;
    }

    if (nivelFaq === 0 || !linha.trim()) continue;

    const texto = linha.trim();
    if (parecePerguntaDeParagrafo(texto)) {
      guardar();
      pergunta = limparPergunta(texto);
      continue;
    }
    if (pergunta) resposta.push(texto);
  }
  guardar();
  return perguntas;
}

/**
 * Junta as duas fontes sem repetir pergunta. A comparação é pela forma
 * normalizada (sem acento, sem pontuação), porque o JSON-LD e o texto visível
 * raramente são idênticos caractere a caractere.
 */
function juntarPerguntas(jsonLd, visiveis) {
  const vistos = new Set();
  const todas = [];
  for (const item of [...jsonLd, ...visiveis]) {
    const chave = normalizarTexto(item.pergunta).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    todas.push(item);
  }
  return todas;
}

/**
 * A extração é presa ao payload: enumerar as perguntas percorre o markdown
 * inteiro, e a página quente é servida do cache repetidas vezes.
 */
const memoDePerguntas = new WeakMap();

function perguntasDaPagina(payload) {
  const guardadas = memoDePerguntas.get(payload);
  if (guardadas) return guardadas;
  const itens = extrairJsonLd(payload.text);
  const perguntas = juntarPerguntas(perguntasDoJsonLd(itens), perguntasDaSecao(markdownCompleto(payload)));
  memoDePerguntas.set(payload, perguntas);
  return perguntas;
}

function inteiroOuPadrao(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(minimo, Math.min(maximo, Math.floor(numero)));
}

/**
 * Ferramenta extract_faq.
 */
export async function toolExtractFaq(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const maxChars = clampMaxChars(args.maxChars);
  const maxPerguntas = inteiroOuPadrao(args.maxPerguntas, 15, 1, 50);

  const payload = await fetchTextDocumentoCached(parsed.href, { timeoutMs });
  ensureHtml(payload.contentType, payload.text, payload.finalUrl);

  const todas = perguntasDaPagina(payload);
  if (todas.length === 0) {
    return (
      `# FAQ: ${payload.finalUrl}\nURL: ${payload.finalUrl}\n\n` +
      `Nenhuma pergunta frequente encontrada. Procurei em dados estruturados (FAQPage) ` +
      `e em secoes com titulo de FAQ.\n` +
      (payload.cortado ? `AVISO: o documento foi cortado no teto de download; pode haver FAQ depois do corte.\n` : "")
    );
  }

  const exibidas = todas.slice(0, maxPerguntas);
  const linhas = [
    `# FAQ: ${payload.finalUrl}`,
    `URL: ${payload.finalUrl}`,
    `Perguntas: ${exibidas.length} de ${todas.length}`,
  ];
  if (payload.cortado) {
    linhas.push(`AVISO: documento cortado no teto de download; a pagina pode ter mais perguntas.`);
  }
  linhas.push("");

  exibidas.forEach((item, i) => {
    linhas.push(`## ${i + 1}. ${item.pergunta}`);
    linhas.push(recortarTrecho(item.resposta, 900));
    linhas.push("");
  });

  return truncate(linhas.join("\n").trimEnd(), maxChars).text;
}
