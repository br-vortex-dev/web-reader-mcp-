// As seis ferramentas da rodada 1.11.0, de ponta a ponta no servidor MCP:
// busca em várias páginas, cartão da página, tabelas como dados, FAQ,
// página arquivada (só a validação; a rede do Wayback é testada ao vivo) e
// leitura de DOCX/PPTX/EPUB.
//
// Uso: node --test tests/ferramentas-novas.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp } from "./helpers.mjs";

let fixture;
let mcp;

before(async () => {
  fixture = await startFixture();
  mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
});

after(async () => {
  await mcp.close();
  await fixture.close();
});

/** O bloco ```json ... ``` da resposta, já convertido em objeto. */
function jsonDaResposta(texto) {
  const achado = /```json\n([\s\S]*?)\n```/.exec(texto);
  assert.ok(achado, `resposta sem bloco JSON:\n${texto}`);
  return JSON.parse(achado[1]);
}

/* ----------------------- find_relevant_multi --------------------------- */

test("find_relevant_multi busca o mesmo assunto em duas paginas", async () => {
  const r = await mcp.call("find_relevant_multi", {
    urls: [`${fixture.url}/multi/a`, `${fixture.url}/multi/b`],
    query: "lobo",
  });
  assert.equal(r.isError, false);
  assert.match(r.text, /# Trechos relevantes em varias paginas/);
  assert.match(r.text, /Paginas: 2 de 2 lidas/);
  assert.match(r.text, /matas frias/);
  assert.match(r.text, /carnivoro/);
  assert.match(r.text, /## 1\. .*\/multi\//);
  assert.match(r.text, /## 2\. .*\/multi\//);
  assert.doesNotMatch(r.text, /salmao|tomates/);
});

test("find_relevant_multi: URL com erro nao derruba as outras", async () => {
  const r = await mcp.call("find_relevant_multi", {
    urls: [`${fixture.url}/multi/a`, "http://127.0.0.1:1/fora"],
    query: "lobo",
  });
  assert.equal(r.isError, false);
  assert.match(r.text, /Paginas: 1 de 2 lidas/);
  assert.match(r.text, /matas frias/);
  assert.match(r.text, /Avisos de cobertura/);
  assert.match(r.text, /\/fora: falhou/);
});

test("find_relevant_multi conta a mesma pagina uma vez so", async () => {
  const url = `${fixture.url}/multi/b`;
  const r = await mcp.call("find_relevant_multi", { urls: [url, url + "?utm_source=x"], query: "lobo" });
  assert.equal(r.isError, false);
  assert.match(r.text, /Paginas: 1 de 1 lidas/);
});

test("find_relevant_multi recusa lista vazia e lista acima do teto", async () => {
  const vazia = await mcp.call("find_relevant_multi", { urls: [], query: "lobo" });
  assert.equal(vazia.isError, true);
  assert.match(vazia.text, /urls/);

  const demais = Array.from({ length: 9 }, (_, i) => `${fixture.url}/multi/a?i=${i}`);
  const excedida = await mcp.call("find_relevant_multi", { urls: demais, query: "lobo" });
  assert.equal(excedida.isError, true);
  assert.match(excedida.text, /Máximo de 8/);
});

/* ------------------------- extract_page_info --------------------------- */

test("extract_page_info devolve o cartao completo", async () => {
  const r = await mcp.call("extract_page_info", { url: `${fixture.url}/info` });
  assert.equal(r.isError, false);
  assert.match(r.text, /^# Informacoes da pagina/);
  assert.match(r.text, /Titulo: Titulo da Meta/);
  assert.match(r.text, /Descricao: Uma descricao de teste/);
  assert.match(r.text, /Autor: Fulana de Tal/);
  assert.match(r.text, /Publicado: 2026-10-01T09:00:00Z/);
  assert.match(r.text, /Modificado: 2026-10-02T10:30:00Z/);
  assert.match(r.text, /Idioma: pt-BR/);
  assert.match(r.text, /Site: Site Fixture/);
  assert.match(r.text, new RegExp(`URL canonica: ${fixture.url}/info`));
  assert.match(r.text, /Dados estruturados: .*NewsArticle/);
  // O cartão é barato: o corpo da página não entra.
  assert.doesNotMatch(r.text, /Corpo da noticia/);
});

test("extract_page_info em URL que nao e HTML orienta a ferramenta certa", async () => {
  const r = await mcp.call("extract_page_info", { url: `${fixture.url}/info/json` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Tipo de conteudo: application\/json/);
  assert.match(r.text, /read_json/);
});

/* ----------------------------- read_tables ----------------------------- */

test("read_tables devolve tabelas como dados alinhados", async () => {
  const r = await mcp.call("read_tables", { url: `${fixture.url}/tabelas` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Tabelas: 2 encontrada\(s\), exibindo 2/);

  const tabelas = jsonDaResposta(r.text);
  assert.equal(tabelas.length, 2);
  assert.deepEqual(tabelas[0].colunas, ["Produto", "Preco"]);
  assert.deepEqual(tabelas[0].linhas, [
    ["Caneta", "2"],
    ["Caderno", "15"],
  ]);
  assert.deepEqual(tabelas[0].linhasOmitidas, 0);
  // Sem <th> na primeira linha, as colunas ganham nome posicional.
  assert.deepEqual(tabelas[1].colunas, ["coluna 1", "coluna 2"]);
  assert.deepEqual(tabelas[1].linhas, [
    ["sem", "cabecalho"],
    ["x", "y"],
  ]);
});

test("read_tables respeita maxLinhas e informa o que ficou de fora", async () => {
  const r = await mcp.call("read_tables", { url: `${fixture.url}/tabelas`, maxLinhas: 1 });
  assert.equal(r.isError, false);
  assert.match(r.text, /Linhas omitidas: 2/);
  const tabelas = jsonDaResposta(r.text);
  assert.equal(tabelas[0].linhas.length, 1);
  assert.equal(tabelas[0].linhasOmitidas, 1);
  assert.equal(tabelas[1].linhasOmitidas, 1);
});

test("read_tables aceita cabecalho mais curto que as linhas de dados", async () => {
  const r = await mcp.call("read_tables", { url: `${fixture.url}/tabela-cabecalho-curto` });
  assert.equal(r.isError, false);
  const tabelas = jsonDaResposta(r.text);
  assert.deepEqual(tabelas[0].colunas, ["Nome", "coluna 2"]);
  assert.deepEqual(tabelas[0].linhas, [["Ana", "10"]]);
});

test("read_tables em pagina sem tabela avisa em vez de devolver vazio", async () => {
  const r = await mcp.call("read_tables", { url: `${fixture.url}/pequena` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Nenhuma tabela/);
});

/* ----------------------------- extract_faq ----------------------------- */

test("extract_faq junta JSON-LD e secao visivel sem repetir pergunta", async () => {
  const r = await mcp.call("extract_faq", { url: `${fixture.url}/faq` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Perguntas: 3 de 3/);
  assert.match(r.text, /## 1\. O envio e gratuito\?/);
  assert.match(r.text, /gratuito para todo o Brasil/);
  assert.match(r.text, /## 2\. Posso trocar o produto\?/);
  assert.match(r.text, /## 3\. Qual o prazo de entrega\?/);
  assert.match(r.text, /5 dias uteis/);
  assert.doesNotMatch(r.text, /Fale com a gente/);
  // Rodapé com link terminando em "?" não vira 4ª pergunta (contagem acima
  // continua 3 de 3); ele pode sobrar no fim da última resposta.
  assert.doesNotMatch(r.text, /^## \d+\. Last updated/m);
});

test("extract_faq respeita maxPerguntas", async () => {
  const r = await mcp.call("extract_faq", { url: `${fixture.url}/faq`, maxPerguntas: 1 });
  assert.equal(r.isError, false);
  assert.match(r.text, /Perguntas: 1 de 3/);
  assert.equal((r.text.match(/^## /gm) || []).length, 1);
});

test("extract_faq em pagina sem FAQ avisa em vez de devolver vazio", async () => {
  const r = await mcp.call("extract_faq", { url: `${fixture.url}/pequena` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Nenhuma pergunta frequente/);
});

/* ----------------------------- read_archived --------------------------- */

test("read_archived recusa timestamp fora do formato antes de chamar o arquivo", async () => {
  const r = await mcp.call("read_archived", { url: `${fixture.url}/info`, timestamp: "ontem" });
  assert.equal(r.isError, true);
  assert.match(r.text, /timestamp/);
  assert.match(r.text, /4 a 14/);
});

/* ----------------------------- read_document --------------------------- */

test("read_document extrai texto, metadados e tabela de um DOCX", async () => {
  const r = await mcp.call("read_document", { url: `${fixture.url}/doc/exemplo.docx` });
  assert.equal(r.isError, false);
  assert.match(r.text, /^# Documento: exemplo\.docx/);
  assert.match(r.text, /Formato: DOCX/);
  assert.match(r.text, /Titulo: Contrato de teste/);
  assert.match(r.text, /Autor: Equipe Fixture/);
  assert.match(r.text, /Modificado: 2026-10-20T10:00:00Z/);
  assert.match(r.text, /Relatorio de teste/);
  assert.match(r.text, /Primeiro paragrafo do documento/);
  assert.match(r.text, /Celula A/);
  assert.match(r.text, /\| Celula B/);
});

test("read_document le os slides do PPTX na ordem da apresentacao", async () => {
  const r = await mcp.call("read_document", { url: `${fixture.url}/doc/exemplo.pptx` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Formato: PPTX/);
  assert.match(r.text, /Slides: 2/);
  const primeiro = r.text.indexOf("## Slide 1");
  const segundo = r.text.indexOf("## Slide 2");
  assert.ok(primeiro !== -1 && segundo !== -1);
  // As relacoes dizem que o slide 1 da apresentacao e o slide2.xml.
  assert.match(r.text.slice(primeiro, segundo), /Conteudo do slide dois/);
  assert.match(r.text.slice(segundo), /Conteudo do slide um/);
});

test("read_document le os capitulos do EPUB na ordem do spine", async () => {
  const r = await mcp.call("read_document", { url: `${fixture.url}/doc/exemplo.epub` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Formato: EPUB/);
  assert.match(r.text, /Titulo: Livro de teste/);
  assert.match(r.text, /Autor: Autora Fixture/);
  assert.match(r.text, /Capitulos: 2/);
  assert.ok(r.text.indexOf("Capitulo dois") < r.text.indexOf("Capitulo um"));
  // Links internos do livro viram texto; não poluem como markdown.
  assert.match(r.text, /Link interno/);
  assert.doesNotMatch(r.text, /\]\(/);
});

test("read_document explica quando o arquivo nao e um documento suportado", async () => {
  const r = await mcp.call("read_document", { url: `${fixture.url}/doc/falso.docx` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Nao foi possivel extrair o texto/);
  assert.match(r.text, /nao comeca com assinatura ZIP/);
});
