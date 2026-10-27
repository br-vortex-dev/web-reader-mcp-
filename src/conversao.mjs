/**
 * conversao.mjs — a camada memoizada de HTML → markdown e links.
 *
 * O QUE É
 *   O único lugar que converte o payload baixado em texto para as ferramentas.
 *   O WeakMap é chaveado pelo PRÓPRIO payload do cache: o primeiro toque
 *   converte, os seguintes só consultam. Conteúdo novo (TTL vencido,
 *   revalidação do SWR) = objeto novo = conversão nova; a invalidação é a
 *   identidade do objeto, e nada fica preso sem referência.
 *
 * POR QUE É UM MÓDULO
 *   tools.mjs tinha 1.566 linhas e esta era a parte mais quente e mais
 *   reutilizada (read_page, find_on_page, diff_page, read_multiple_pages,
 *   crawl_site, extract_links). Separada, ela tem um dono claro, um teste
 *   próprio (memo.test.mjs) e o /health não precisa importar o arquivo das 12
 *   ferramentas só para ler um contador.
 *
 * O QUE ENTRA / O QUE SAI
 *   Entra: o payload (text, finalUrl) devolvido por fetch.mjs.
 *   Sai:  metadados, markdown, lista de links — sempre do mesmo objeto,
 *         convertido uma vez só.
 *
 * QUEM USA
 *   Usado por: tools.mjs e http-transport.mjs (/health).
 *   Importa de: config (teto e chave de desligamento) e html-parser.
 */

import { HARD_MAX_CHARS, MEMO_CONVERSAO } from "./config.mjs";
import { htmlToMarkdown, htmlToMarkdownComLinks, extractMeta, extractLinks } from "./html-parser.mjs";

/**
 * Converter HTML é a parte CARA da leitura (tokenize + htmlToMarkdown ≈ 3 ms
 * por página pequena, mais em páginas grandes). O payload do cache é estável
 * entre acertos — o MESMO objeto é devolvido — então memoizamos meta, markdown
 * e links num WeakMap chaveado por ele.
 *
 * `conversoesMemo` é exposto no /health: `realizadas` são conversões de fato
 * executadas; `caronas` são consultas que acharam o resultado pronto.
 */
const memoConversao = new WeakMap();
export const conversoesMemo = { realizadas: 0, caronas: 0 };

// Exportado para o embeddedMemo de tools.mjs usar a MESMA entrada do payload
// (o conteúdo embutido de páginas dinâmicas é caro e também fica memoizado).
export function memoDoPayload(payload) {
  if (!MEMO_CONVERSAO) return null;
  let entrada = memoConversao.get(payload);
  if (!entrada) {
    entrada = {};
    memoConversao.set(payload, entrada);
  }
  return entrada;
}

export function metaMemo(payload) {
  const memo = memoDoPayload(payload);
  if (!memo) {
    conversoesMemo.realizadas++;
    return extractMeta(payload.text);
  }
  if (!("meta" in memo)) {
    memo.meta = extractMeta(payload.text);
    conversoesMemo.realizadas++;
  } else {
    conversoesMemo.caronas++;
  }
  return memo.meta;
}

/**
 * Opções da conversão para exibição. `minCharsEntregaveis = HARD_MAX_CHARS`
 * liga a PARADA ANTECIPADA do parser: nenhuma leitura entrega mais que o teto
 * (clampMaxChars limita a HARD_MAX_CHARS), então páginas gigantes param de ser
 * convertidas assim que os caracteres entregáveis estão garantidos. O prefixo
 * exibido continua byte a byte idêntico ao da conversão completa — o que deixa
 * de ser feito é o parse do rabo que nunca sairia daqui (chega a 97% do custo
 * em páginas de 1 MB). A memoização compartilha UMA conversão entre todos os
 * usos do payload, então as opções são fixas aqui e valem para todos.
 */
const OPCOES_MARKDOWN_EXIBIVEL = { minCharsEntregaveis: HARD_MAX_CHARS };

// A parada antecipada pode interromper a conversão de páginas gigantes no teto
// de saída. O texto entregue continua idêntico (prefixo byte a byte), mas o
// número `Conteudo: N caracteres` não pode subnotificar a página: quando a
// conversão foi interrompida, ele sai como `N+` (havia mais além do teto).
const conversaoInterrompidaDe = new WeakMap();

export function markdownInterrompida(payload) {
  return conversaoInterrompidaDe.get(payload) === true;
}

/**
 * Valor do campo `Conteudo:` — com `+` quando havia MAIS do que o número
 * informado. Dois motivos, a mesma marca: a conversão foi interrompida no teto
 * de saída, ou o download parou no teto de bytes. Nos dois casos o número é o
 * do texto que se tem, e o `+` diz que não é a página inteira.
 */
export function fullLengthDe(payload, markdown) {
  if (markdownInterrompida(payload) || payload?.cortado) return `${markdown.length}+`;
  return markdown.length;
}

export function markdownMemo(payload) {
  const memo = memoDoPayload(payload);
  if (!memo) {
    conversoesMemo.realizadas++;
    const diagnostico = { interrompida: false };
    const markdown = htmlToMarkdown(payload.text, payload.finalUrl, {
      ...OPCOES_MARKDOWN_EXIBIVEL,
      diagnostico,
    });
    conversaoInterrompidaDe.set(payload, Boolean(diagnostico.interrompida));
    return markdown;
  }
  if (!("markdown" in memo)) {
    const diagnostico = { interrompida: false };
    // Markdown SEM links: read_page/find_on_page/diff_page não devolvem a
    // lista, e a conversão combinada continuava varrendo o documento inteiro
    // só para montá-la — mesmo depois da parada antecipada. A lista é
    // extraída sob demanda por extract_links/discover_urls (linksMemo) ou
    // junto do markdown quando quem lê precisa dos dois (markdownELinksMemo,
    // usado por read_multiple_pages e crawl_site).
    memo.markdown = htmlToMarkdown(payload.text, payload.finalUrl, {
      ...OPCOES_MARKDOWN_EXIBIVEL,
      diagnostico,
    });
    conversaoInterrompidaDe.set(payload, Boolean(diagnostico.interrompida));
    conversoesMemo.realizadas++;
  } else {
    conversoesMemo.caronas++;
  }
  return memo.markdown;
}

// Conversão SEM parada antecipada, para o find_on_page conferir o rabo quando
// a frente coberta não teve nenhum acerto. Memoizada no payload: a segunda
// busca na mesma página não paga a conversão de novo.
const markdownCompletoMemo = new WeakMap();

export function markdownCompleto(payload) {
  let markdown = markdownCompletoMemo.get(payload);
  if (markdown === undefined) {
    markdown = htmlToMarkdown(payload.text, payload.finalUrl, {});
    markdownCompletoMemo.set(payload, markdown);
  }
  return markdown;
}

export function linksMemo(payload) {
  const memo = memoDoPayload(payload);
  if (!memo) {
    conversoesMemo.realizadas++;
    return extractLinks(payload.text, payload.finalUrl);
  }
  if (!("links" in memo)) {
    memo.links = extractLinks(payload.text, payload.finalUrl);
    conversoesMemo.realizadas++;
  } else {
    conversoesMemo.caronas++;
  }
  return memo.links;
}

/**
 * Markdown E links na MESMA tokenização, para quem precisa dos dois.
 *
 * read_multiple_pages e crawl_site devolvem os links internos, então pagam a
 * passada única; o resultado fica no memo e extract_links no mesmo payload
 * não custa nada depois. `markdownMemo` (read_page e companhia) não coleta
 * links: quem não pediu a lista não paga por ela.
 */
export function markdownELinksMemo(payload) {
  const memo = memoDoPayload(payload);
  if (!memo) {
    conversoesMemo.realizadas++;
    const diagnostico = { interrompida: false };
    const convertido = htmlToMarkdownComLinks(payload.text, payload.finalUrl, {
      ...OPCOES_MARKDOWN_EXIBIVEL,
      diagnostico,
    });
    conversaoInterrompidaDe.set(payload, Boolean(diagnostico.interrompida));
    return convertido;
  }
  if (!("markdown" in memo)) {
    const diagnostico = { interrompida: false };
    const convertido = htmlToMarkdownComLinks(payload.text, payload.finalUrl, {
      ...OPCOES_MARKDOWN_EXIBIVEL,
      diagnostico,
    });
    memo.markdown = convertido.markdown;
    memo.links = convertido.links;
    conversaoInterrompidaDe.set(payload, Boolean(diagnostico.interrompida));
    conversoesMemo.realizadas++;
  } else if (!("links" in memo)) {
    memo.links = extractLinks(payload.text, payload.finalUrl);
    conversoesMemo.realizadas++;
  } else {
    conversoesMemo.caronas++;
  }
  return { markdown: memo.markdown, links: memo.links };
}
