/**
 * relevancia.mjs — a busca por TRECHOS RELEVANTES dentro do texto de uma página.
 *
 * O QUE É
 *   A IA manda um assunto ("localização dos baús") em vez de uma frase exata, e
 *   o servidor devolve os parágrafos/tabelas que mais casam, com nota. É o que
 *   o `find_on_page` não faz: ele procura o termo linha a linha e não tolera
 *   plural nem acento.
 *
 * COMO CASA
 *   1. normaliza (maiúsculas e acentos fora) e reduz singular/plural;
 *   2. joga fora palavras vazias ("onde", "fica", "dos") que não descrevem o
 *      assunto e ficariam casando com a página inteira;
 *   3. corta o markdown em blocos (parágrafo, tabela, cerca de código), com a
 *      seção (título mais próximo) anotada;
 *   4. pontua cada bloco: termo no texto vale 1 (repetição até +2), termo só
 *      no título da seção vale 1,5, cobrir vários termos soma bônus e seções
 *      de apêndice (referências, ligações externas) perdem peso. Ordena por
 *      nota e devolve os melhores.
 *
 * LIMITES (de propósito)
 *   Não é sinônimo nem IA: "baú" não acha "caixa". O plural regular (-s) e os
 *   plurais em -ões/-ais/-éis/-óis/-ns/-zes/-res são tratados; exceções
 *   irregulares (pão/pães, país/países) continuam sem casar.
 *
 * QUEM USA
 *   Usado por: tools.mjs (find_relevant). Não importa nada do projeto.
 */

// Teto de termos considerados por consulta. Query longa demais vira ruído:
// cada termo extra dilui a nota e o casamento de todos é improvável.
const MAX_TERMOS = 12;

// Acima disso o bloco é dividido; senão uma tabela de 3000 linhas vira um
// "trecho" só e o recorte de exibição cortaria justamente o que casou.
const MAX_BLOCO_CHARS = 3000;

const MAX_TRECHO_CHARS = 2000;

// Palavras que aparecem em QUALQUER página e não descrevem assunto. Sem esta
// lista, "onde ficam os baús" casaria com toda seção que tem "onde".
const PALAVRAS_VAZIAS = new Set([
  // português
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
  "em", "no", "na", "nos", "nas", "num", "numa", "por", "para", "pra", "pro", "com",
  "sem", "que", "quem", "qual", "quais", "quando", "onde", "como", "porque", "sobre",
  "entre", "ate", "apos", "ante", "contra", "desde", "essa", "esse", "esta", "este",
  "isso", "isto", "aquela", "aquele", "aquilo", "seu", "sua", "seus", "suas", "meu",
  "minha", "meus", "minhas", "ele", "ela", "eles", "elas", "voce", "voces", "eu",
  "ja", "nao", "sim", "mais", "menos", "muito", "muita", "muitos", "muitas", "pouco",
  "pouca", "tem", "ter", "ha", "foi", "ser", "sao", "era", "estao", "estou",
  "fica", "ficam", "ficou", "ficar", "encontra", "encontram", "encontrar", "localiza",
  "localizam", "localizar", "localizado", "localizada", "acha", "achar", "ache",
  "busca", "buscar", "procura", "procurar", "quero", "quer", "saber", "saiba", "me",
  "te", "lhe", "aqui", "ali", "la", "ai",
  // inglês (a IA pode perguntar em inglês mesmo com a página em português)
  "the", "an", "of", "in", "on", "at", "to", "for", "with", "and", "or", "is", "are",
  "was", "were", "be", "been", "being", "where", "find", "how", "what", "which",
  "who", "does", "do", "did", "can", "could", "would", "should", "i", "you", "it",
  "this", "that", "these", "those", "from", "into", "near", "about", "please",
  "tell", "show", "locate", "there", "their", "they",
]);

export function normalizarTexto(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Redução de plural por sufixo. Não é stemming de verdade: cobre os plurais
 * regulares do português e deixa o resto intacto (melhor não casar do que
 * casar errado e poluir o resultado).
 */
export function radicalDe(palavra) {
  return radicalDeNormalizado(normalizarTexto(palavra));
}

function radicalDeNormalizado(p) {
  if (p.length < 4) return p;
  if (p.endsWith("oes") && p.length >= 5) return p.slice(0, -3) + "ao";
  if (p.endsWith("ais") && p.length >= 5) return p.slice(0, -3) + "al";
  if (p.endsWith("eis") && p.length >= 5) return p.slice(0, -3) + "el";
  if (p.endsWith("ois") && p.length >= 5) return p.slice(0, -3) + "ol";
  if (p.endsWith("ns") && p.length >= 5) return p.slice(0, -2) + "m";
  if (p.endsWith("zes") && p.length >= 5) return p.slice(0, -3) + "z";
  if (p.endsWith("res") && p.length >= 5) return p.slice(0, -3) + "r";
  if (p.endsWith("us")) return p.slice(0, -1);
  if (p.endsWith("s") && !p.endsWith("ss")) return p.slice(0, -1);
  return p;
}

/**
 * Termos úteis da consulta, na ordem em que a IA escreveu, sem repetição de
 * radical. `palavra` é para exibir; `radical` é para casar.
 */
export function termosDaConsulta(consulta) {
  const termos = [];
  const vistos = new Set();
  const palavras = String(consulta ?? "").match(/[\p{L}\p{N}]+/gu) || [];
  for (const palavra of palavras) {
    const normalizada = normalizarTexto(palavra);
    if (normalizada.length < 2) continue;
    if (PALAVRAS_VAZIAS.has(normalizada)) continue;
    const radical = radicalDeNormalizado(normalizada);
    if (vistos.has(radical)) continue;
    vistos.add(radical);
    termos.push({ palavra, radical });
    if (termos.length === MAX_TERMOS) break;
  }
  return termos;
}

function dividirBloco(texto) {
  if (texto.length <= MAX_BLOCO_CHARS) return [texto];
  const partes = [];
  let atual = [];
  let tamanho = 0;
  for (const linha of texto.split("\n")) {
    const peso = linha.length + 1;
    if (atual.length > 0 && tamanho + peso > MAX_BLOCO_CHARS) {
      partes.push(atual.join("\n"));
      atual = [];
      tamanho = 0;
    }
    atual.push(linha);
    tamanho += peso;
  }
  if (atual.length > 0) partes.push(atual.join("\n"));
  return partes;
}

// A Wikipédia deixa um bloco "[editar | editar código]" no topo de cada seção.
// Sem esta poda ele entrava como trecho relevante (visto no ar, na página do
// Node.js): são links de navegação, não conteúdo.
const PALAVRAS_DE_EDICAO = new Set(["editar", "edit", "codigo", "code", "fonte", "source", "wikitexto"]);

function blocoDeNavegacao(texto) {
  const semLinks = texto.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const palavras = normalizarTexto(semLinks).match(/[\p{L}\p{N}]+/gu) || [];
  if (palavras.length === 0 || palavras.length > 4) return false;
  return palavras.every((p) => PALAVRAS_DE_EDICAO.has(p));
}

/**
 * Corta o markdown em blocos legíveis. Título de seção NÃO entra no texto do
 * bloco: ele vira a etiqueta `secao` e pontua à parte — assim o título não é
 * contado duas vezes nem aparece duplicado no trecho.
 */
export function blocosDoMarkdown(markdown) {
  const linhas = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocos = [];
  let secao = "";
  let dentroDeCerca = false;
  let acumulado = [];

  const fechar = () => {
    if (acumulado.length === 0) return;
    const texto = acumulado.join("\n").trim();
    acumulado = [];
    if (!texto) return;
    if (blocoDeNavegacao(texto)) return;
    for (const parte of dividirBloco(texto)) blocos.push({ secao, texto: parte });
  };

  for (const linha of linhas) {
    if (linha.trimStart().startsWith("```")) {
      dentroDeCerca = !dentroDeCerca;
      acumulado.push(linha);
      continue;
    }
    if (dentroDeCerca) {
      acumulado.push(linha);
      continue;
    }
    const titulo = /^#{1,6}\s+(.+?)\s*$/.exec(linha);
    if (titulo) {
      fechar();
      secao = titulo[1].replace(/\s+/g, " ").trim();
      continue;
    }
    if (linha.trim() === "") {
      fechar();
      continue;
    }
    acumulado.push(linha);
  }
  fechar();
  return blocos;
}

function radicaisDosTokens(texto) {
  const palavras = normalizarTexto(texto).match(/[\p{L}\p{N}]+/gu);
  if (!palavras) return [];
  return palavras.map(radicalDeNormalizado);
}

// Prefixo de 6 letras: "localização"/"localizado" casam; "capital"/"capitão"
// não (só compartilham 5). Curto demais para semear falso positivo em raízes
// de 4 letras, longo o bastante para flexão de verdade.
const PREFIXO_DE_FLEXAO = 6;

// Seções de apêndice repetem o nome do assunto em links e citações e venciam
// a seção que RESPONDE à pergunta (medido na página do Node.js na Wikipédia:
// "Referências" era o primeiro trecho para "história do node"). Não somem:
// perdem peso.
const SECOES_DE_APOIO =
  /^(referencias|bibliografia|ligacoes externas|ver tambem|leitura adicional|external links|references|see also|further reading|bibliography)(\b|$)/;

function casaRadical(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length >= 4 && a.startsWith(b)) return true;
  if (a.length >= 4 && b.startsWith(a)) return true;
  return (
    a.length >= PREFIXO_DE_FLEXAO &&
    b.length >= PREFIXO_DE_FLEXAO &&
    a.slice(0, PREFIXO_DE_FLEXAO) === b.slice(0, PREFIXO_DE_FLEXAO)
  );
}

/**
 * Pontua os blocos e devolve SÓ os que casaram, do maior para o menor (empate:
 * ordem do documento). A nota é relativa, não uma probabilidade: serve para a
 * IA comparar trechos da MESMA página.
 */
export function pontuarBlocos(blocos, termos) {
  const pontuados = [];
  blocos.forEach((bloco, indice) => {
    const tokens = radicaisDosTokens(bloco.texto);
    if (tokens.length === 0) return;
    const tokensDaSecao = radicaisDosTokens(bloco.secao);
    let nota = 0;
    const casados = [];
    for (const termo of termos) {
      let ocorrencias = 0;
      for (const token of tokens) {
        if (casaRadical(token, termo.radical)) ocorrencias++;
      }
      const naSecao = tokensDaSecao.some((t) => casaRadical(t, termo.radical));
      if (ocorrencias === 0) {
        // O título "Histórico" casa com a consulta "história" mesmo que o
        // parágrafo não repita a palavra: o bloco É sobre o assunto. Vale
        // menos que uma ocorrência no texto, mas conta para a cobertura.
        if (!naSecao) continue;
        casados.push(termo.palavra);
        nota += 1.5;
        continue;
      }
      casados.push(termo.palavra);
      // 1 pela primeira ocorrência + 0,5 por repetição, até +2 (3 no total):
      // um bloco que repete a palavra não pode soterrar um que cobre o assunto.
      nota += 1 + Math.min(ocorrencias - 1, 4) * 0.5;
      if (naSecao) nota += 2;
    }
    // Cobertura vale mais que repetição: um bloco que cobre dois termos da
    // consulta é mais provável de responder do que outro que repete um só.
    if (casados.length > 1) nota += (casados.length - 1) * 1.5;
    if (nota === 0) return;
    if (SECOES_DE_APOIO.test(normalizarTexto(bloco.secao).trim())) nota *= 0.35;
    pontuados.push({ secao: bloco.secao, texto: bloco.texto, nota, casados, indice });
  });
  return pontuados.sort((a, b) => b.nota - a.nota || a.indice - b.indice);
}

export function recortarTrecho(texto, limite = MAX_TRECHO_CHARS) {
  if (texto.length <= limite) return texto;
  const corte = texto.lastIndexOf("\n", limite);
  const fim = corte >= limite * 0.6 ? corte : limite;
  return texto.slice(0, fim).trimEnd() + "\n[... trecho cortado ...]";
}
