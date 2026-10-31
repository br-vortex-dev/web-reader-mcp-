/**
 * tabelas.mjs — tabelas como DADOS (read_tables).
 *
 * O QUE É
 *   O read_page desenha a tabela em markdown, que é bom para ler e ruim para
 *   calcular: a IA precisa repartir as barras, adivinhar a coluna e cortar o
 *   pipe escapado. Esta ferramenta devolve a mesma tabela em JSON — colunas e
 *   linhas alinhadas — pronta para comparar preço, prazo, especificação.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: a URL + limites (tabelas, linhas por tabela, caracteres).
 *   Sai:   um bloco JSON com [{colunas, linhas, linhasOmitidas}].
 *
 * LIMITAÇÕES HONESTAS
 *   - colspan/rowspan não são expandidos: cada célula ocupa uma posição, como
 *     no desenho em markdown. Tabela com célula mesclada sai com buraco na
 *     linha de baixo, e não com o valor repetido.
 *   - tabela usada só como layout (site antigo montando a página em <table>)
 *     também aparece; o filtro é o <table>, não a intenção.
 *
 * QUEM USA
 *   Usado por: tools.mjs.
 *   Importa de: fetch, html-parser, utils.
 */

import { fetchTextDocumentoCached, validateHttpUrl, clampTimeoutMs, clampMaxChars, ensureHtml } from "./fetch.mjs";
import { htmlToMarkdownComLinks } from "./html-parser.mjs";
import { inteiroOuPadrao } from "./utils.mjs";

// Célula gigante não pode comer o orçamento da tabela inteira.
const LIMITE_CELULA = 400;

/**
 * A conversão roda uma vez por payload e fica presa a ele: como o cache serve
 * o MESMO objeto enquanto a página está quente, pedir as tabelas de novo não
 * reparseia o HTML. `apenasTabelas` evita montar o markdown inteiro.
 */
const memoDeTabelas = new WeakMap();

function tabelasDaPagina(payload) {
  let tabelas = memoDeTabelas.get(payload);
  if (tabelas) return tabelas;
  tabelas = htmlToMarkdownComLinks(payload.text, payload.finalUrl, {
    coletarLinks: false,
    coletarTabelas: true,
    apenasTabelas: true,
  }).tabelas;
  memoDeTabelas.set(payload, tabelas);
  return tabelas;
}

function textoTimpo(valor, limite = LIMITE_CELULA) {
  const texto = String(valor || "").replace(/\s+/g, " ").trim();
  return texto.length > limite ? texto.slice(0, limite) + "…" : texto;
}

/**
 * Transforma as linhas cruas do parser em {colunas, linhas}.
 * A primeira linha só é cabeçalho quando TODAS as células dela vieram de
 * <th>: tabelas reais usam <th> também na primeira coluna de cada linha, e
 * tratar essa linha como cabeçalho perderia o primeiro registro.
 */
function normalizarTabela(bruta) {
  const linhas = bruta.filter((linha) => linha.some((celula) => celula.texto.trim()));
  if (linhas.length === 0) return null;

  const primeira = linhas[0];
  const temCabecalho =
    primeira.every((celula) => celula && celula.cabecalho) &&
    primeira.some((celula) => celula && celula.texto.trim());
  const corpo = temCabecalho ? linhas.slice(1) : linhas;

  // A linha de cabeçalho pode ser MAIS CURTA que as de dados (colspan no
  // cabeçalho, célula vazia no fim). O laço abaixo percorre a maior largura;
  // por isso o acesso à primeira linha precisa da guarda.
  let largura = temCabecalho ? primeira.length : 0;
  for (const linha of corpo) if (linha.length > largura) largura = linha.length;
  if (largura === 0) return null;

  const colunas = [];
  for (let i = 0; i < largura; i++) {
    const nome = temCabecalho && primeira[i] ? textoTimpo(primeira[i].texto) : "";
    colunas.push(nome || `coluna ${i + 1}`);
  }

  const linhasFinais = corpo.map((linha) => {
    const valores = [];
    for (let i = 0; i < largura; i++) valores.push(textoTimpo(linha[i] ? linha[i].texto : ""));
    return valores;
  });

  return { colunas, linhas: linhasFinais };
}

/**
 * As primeiras `quantas` linhas da saída, preservando a ordem das tabelas.
 * Tabela que fica sem linha sai do resultado; as linhas que ela perdeu entram
 * no `linhasOmitidas` dela.
 */
function comLinhas(tabelas, quantas) {
  if (quantas === 0) return [];
  const saida = [];
  let restantes = quantas;
  for (const tabela of tabelas) {
    const linhas = tabela.linhas.slice(0, restantes);
    restantes -= linhas.length;
    saida.push({
      ...tabela,
      linhas,
      linhasOmitidas: tabela.linhasOmitidas + (tabela.linhas.length - linhas.length),
    });
    if (restantes === 0) break;
  }
  return saida;
}

/**
 * Corta o JSON por LINHAS inteiras quando ele passa do teto de caracteres.
 *
 * O corte tira as últimas linhas primeiro. A busca binária existe porque o
 * laço de uma linha por vez reserializava o JSON inteiro a cada descarte —
 * O(n²): numa página com 10 tabelas de 200 linhas, o corte levava 26 s. A
 * busca acha o mesmo ponto em ~log2(n) tentativas.
 */
function limitarPorCaracteres(tabelas, maxChars) {
  const totalLinhas = tabelas.reduce((soma, tabela) => soma + tabela.linhas.length, 0);
  let formatado = JSON.stringify(tabelas, null, 2);
  if (formatado.length <= maxChars) return { tabelas, formatado, linhasCortadas: 0 };

  let baixo = 0;
  let alto = totalLinhas;
  while (baixo < alto) {
    const meio = Math.ceil((baixo + alto) / 2);
    if (JSON.stringify(comLinhas(tabelas, meio), null, 2).length <= maxChars) baixo = meio;
    else alto = meio - 1;
  }

  let recortadas = comLinhas(tabelas, baixo);
  formatado = JSON.stringify(recortadas, null, 2);
  // O contador de linhas omitidas muda de tamanho no JSON (9 → 10); o ajuste
  // garante que o teto vale mesmo no degrau.
  while (formatado.length > maxChars && baixo > 0) {
    baixo--;
    recortadas = comLinhas(tabelas, baixo);
    formatado = JSON.stringify(recortadas, null, 2);
  }
  return { tabelas: recortadas, formatado, linhasCortadas: totalLinhas - baixo };
}

/**
 * Ferramenta read_tables.
 */
export async function toolReadTables(args = {}) {
  const parsed = validateHttpUrl(args.url);
  const timeoutMs = clampTimeoutMs(args.timeoutMs);
  const maxChars = clampMaxChars(args.maxChars);
  const maxTabelas = inteiroOuPadrao(args.maxTabelas, 10, 1, 30);
  const maxLinhas = inteiroOuPadrao(args.maxLinhas, 50, 1, 200);

  const payload = await fetchTextDocumentoCached(parsed.href, { timeoutMs });
  ensureHtml(payload.contentType, payload.text, payload.finalUrl);

  const brutas = tabelasDaPagina(payload);
  if (brutas.length === 0) {
    return (
      `# Tabelas: ${payload.finalUrl}\nURL: ${payload.finalUrl}\n\n` +
      `Nenhuma tabela (<table>) encontrada na pagina.` +
      (payload.cortado ? `\nAVISO: o documento foi cortado no teto de download; pode haver tabela depois do corte.` : "")
    );
  }

  const normalizadas = [];
  for (const bruta of brutas) {
    if (normalizadas.length >= maxTabelas) break;
    const tabela = normalizarTabela(bruta);
    if (tabela) normalizadas.push(tabela);
  }

  const completas = normalizadas.map((tabela, i) => ({
    indice: i + 1,
    colunas: tabela.colunas,
    linhas: tabela.linhas.slice(0, maxLinhas),
    linhasOmitidas: Math.max(0, tabela.linhas.length - maxLinhas),
  }));
  const omitidasPorLinhas = completas.reduce((soma, tabela) => soma + tabela.linhasOmitidas, 0);

  // O teto de caracteres corta por TABELA/linha inteira, nunca no meio do
  // JSON: um JSON quebrado é pior que um JSON menor.
  const recorte = limitarPorCaracteres(completas, maxChars);
  const linhasOmitidas = omitidasPorLinhas + recorte.linhasCortadas;

  const linhas = [
    `# Tabelas: ${payload.finalUrl}`,
    `URL: ${payload.finalUrl}`,
    `Tabelas: ${brutas.length} encontrada(s), exibindo ${recorte.tabelas.length}`,
  ];
  if (normalizadas.length < brutas.length) {
    linhas.push(`Tabelas nao exibidas: ${brutas.length - normalizadas.length} (limite de ${maxTabelas} por chamada)`);
  }
  if (recorte.tabelas.length < normalizadas.length) {
    linhas.push(`Tabelas cortadas pelo limite de caracteres: ${normalizadas.length - recorte.tabelas.length}`);
  }
  if (linhasOmitidas > 0) {
    linhas.push(`Linhas omitidas: ${linhasOmitidas} (aumente maxLinhas ou maxChars para ver mais)`);
  }
  if (payload.cortado) {
    linhas.push(`AVISO: documento cortado no teto de download; tabelas depois do corte nao foram vistas.`);
  }
  linhas.push("", "```json", recorte.formatado, "```");
  return linhas.join("\n");
}
