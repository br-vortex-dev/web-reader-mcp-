// Regressoes da rodada de campo: cada teste aqui eh um bug REAL encontrado
// na bateria de 70 casos na web real (RELATORIO-CAMPO.md). Nenhum deles
// passava antes das correcoes — por isso este arquivo comeca vermelho.
//
// Mapa bug -> teste:
//   BUG-1 texto puro/XML volta com as quebras de linha   -> "BUG-1: ..."
//   BUG-2 feed Atom volta cru / CDATA em HTML nao vaza   -> "BUG-2: ..."
//   BUG-3 read_dynamic_page nao troca SSR rico por JSON  -> "BUG-3: ..."
//   BUG-5 pagina sem conteudo estatico avisa             -> "BUG-5: ..."
//   BUG-4 erro de rede expoe a causa                     -> "BUG-4: ..."
//   BUG-6 403 definitivo nao eh retentado                -> "BUG-6: ..."
//   BUG-7 aria-hidden nao vaza pro texto                 -> "BUG-7: ..."
//   BUG-7 (regressao) <img aria-hidden> void nao engole  -> "BUG-7: <img aria-hidden..."
//   BUG-8 linha de codigo em <pre> nao explode           -> "BUG-8: ..."
//   BUG-9 <script/> self-closing nao engole os links     -> "BUG-9: ..."
//   BUG-10 crawl_site em texto puro nao quebra           -> "BUG-10: ..."
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { startFixture, startMcp, blocosDeCodigo } from "./helpers.mjs";

let fixture;
let mcp;

before(async () => {
  fixture = await startFixture();
  // Fixture local (127.0.0.1): bloqueio de hosts privados desligado.
  mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
});

after(async () => {
  mcp?.close();
  await fixture?.close();
});

// ------------------------------- BUG-1 --------------------------------- //
// robots.txt, sitemap.xml e .md cru perdiam TODAS as quebras de linha:
// "Disallow: /" do Yandex passava a valer para todo mundo.

test("BUG-1: robots.txt volta com os grupos de agente intactos", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/robots`, maxChars: 5000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /User-agent: \*\nDisallow: \/busca/);
  assert.match(r.text, /User-agent: Yandex\nDisallow: \//);
  assert.match(r.text, /Sitemap: https:\/\/exemplo\.org\/sitemap\.xml/);
});

test("BUG-1: sitemap.xml volta com o XML intacto (tags e linhas)", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/sitemap-fixture`, maxChars: 5000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /<loc>https:\/\/exemplo\.org\/<\/loc>/);
  // cada <url> na sua linha, com lastmod junto (como no arquivo original)
  assert.match(
    r.text,
    /\n {2}<url><loc>https:\/\/exemplo\.org\/sobre<\/loc><lastmod>2026-10-13<\/lastmod><\/url>\n/
  );
  assert.match(r.text, /<\/url>\n {2}<url>/);
  // a declaracao do XML tambem tem de sobreviver
  assert.match(r.text, /<\?xml version="1\.0"/);
});

test("BUG-1: markdown cru servido como texto puro mantem os paragrafos", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/md-fixture`, maxChars: 5000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /# Titulo\n\nPrimeiro paragrafo\./);
  assert.match(r.text, /- item um\n- item dois/);
});

// ------------------------------- BUG-2 --------------------------------- //
// Feeds (XML com CDATA) passavam pelo pipeline de HTML: ]]> vazava como
// texto e os titulos dos itens viravam markdown.

test("BUG-2: feed Atom volta cru, com CDATA e newlines preservados", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/atom`, maxChars: 5000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /<title>Primeira noticia<\/title>/);
  assert.match(r.text, /<!\[CDATA\[<p>Texto com <b>negrito<\/b> dentro\]\]>/);
  assert.match(r.text, /\n {2}<entry>/);
});

test("BUG-2: CDATA dentro de HTML nao vaza ]]> nem perde conteudo", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/cdata`, maxChars: 5000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Texto com <marcacao> dentro/);
  assert.doesNotMatch(r.text, /\]\]>/);
});

// ------------------------------- BUG-3 --------------------------------- //
// read_dynamic_page trocava o markdown SSR completo (react.dev: 18 cercas)
// por um dump de __NEXT_DATA__ (4 cercas).

test("BUG-3: read_dynamic_page nao substitui SSR rico por JSON", async () => {
  const r = await mcp.call("read_dynamic_page", { url: `${fixture.url}/ssr-rico`, maxChars: 8000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /# Documentacao/);
  assert.doesNotMatch(r.text, /__NEXT_DATA__/);
  const bloco = blocosDeCodigo(r.text).find((b) => b.includes("def soma"));
  assert.ok(bloco, `bloco de codigo perdido: ${r.text.slice(0, 400)}`);
  assert.equal(bloco, "def soma(a, b):\n    return a + b\n");
});

// ------------------------------- BUG-5 --------------------------------- //
// SPA pura devolvia "Conteudo: 0 caracteres" com cara de sucesso.

test("BUG-5: pagina sem conteudo estatico avisa o que fazer", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/vazia`, maxChars: 4000 });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Conteudo: 0 caracteres/);
  // a pista de que a pagina depende de JavaScript
  assert.match(r.text, /read_dynamic_page/);
  // a meta description continua sendo entregue
  assert.match(r.text, /Um app/);
});

// ------------------------------- BUG-4 --------------------------------- //
// Falha de rede devolvia so "Erro: fetch failed" (18 caracteres), sem a
// causa real (DNS, conexao, certificado).

test("BUG-4: erro de rede expoe a causa (conexao recusada)", async () => {
  // porta que aceitou conexao e foi fechada: garere ECONNREFUSED
  const srv = createServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  const r = await mcp.call("read_page", { url: `http://127.0.0.1:${port}/`, maxChars: 500 });
  assert.equal(r.isError, true);
  assert.match(r.text, /ECONNREFUSED|connect/i, `mensagem fraca demais: ${r.text}`);
  assert.doesNotMatch(r.text, /^Erro: fetch failed$/);
});

// ------------------------------- BUG-6 --------------------------------- //
// 403 (erro definitivo) era retentado 2 vezes: 3,8 s de latencia a toa.

test("BUG-6: 403 definitivo nao eh retentado (uma requisicao so)", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/negado`, maxChars: 500 });
  assert.equal(r.isError, true);
  assert.match(r.text, /403/);
  assert.equal(fixture.contagemDe("/negado"), 1);
});

// ------------------------------- BUG-7 --------------------------------- //
// Chrome de pagina (numeros de linha, estatistica duplicada marcada como
// aria-hidden) vazava para o texto extraido.

test("BUG-7: aria-hidden nao vaza pro texto (estilo GitHub)", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/github-like`, maxChars: 5000 });
  assert.equal(r.isError, false, r.text);
  // a estatistica duplicada: uma copia eh enfeite, sobra uma so
  assert.equal((r.text.match(/17 lines \(17 loc\)/g) || []).length, 1);
  // os numeros de linha das celulas nao podem virar cabecalho de tabela
  assert.doesNotMatch(r.text, /\| 1 \|/);
  // o codigo de verdade continua
  assert.match(r.text, /const a = 1;/);
  assert.match(r.text, /const b = 2;/);
});

// Regressao da propria correcao, pega na Wikipedia (pt.wikipedia.org/wiki/
// Node.js): <img aria-hidden="true"> do logo eh tag VOID — nao tem fecho.
// Contar skipDepth sem contar o fecho travou o contador acima de zero e o
// artigo INTEIRO desapareceu (sobrou so o JSON-LD, 914 caracteres).
test("BUG-7: <img aria-hidden> (tag void) nao engole o resto da pagina", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/aria-void`, maxChars: 5000 });
  assert.equal(r.isError, false, r.text);
  // o que vem DEPOIS do logo decorativo tem de sobreviver
  assert.match(r.text, /Manual do produto/);
  assert.match(r.text, /Primeiro paragrafo depois do logo/);
  assert.match(r.text, /Segundo paragrafo/);
  // com o bug o markdown ficava VAZIO (0 caracteres) — so o logo existia
  assert.match(r.text, /Conteudo: [1-9]\d* caracteres/);
});

// ------------------------------- BUG-8 --------------------------------- //
// <pre> com cada linha embrulhada no proprio elemento (estilo react.dev)
// explodia em linhas em branco entre as linhas de codigo.

test("BUG-8: linha de codigo em <pre> nao explode em branco", async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/react-like`, maxChars: 5000 });
  assert.equal(r.isError, false, r.text);
  const bloco = blocosDeCodigo(r.text).find((b) => b.includes("function Soma"));
  assert.ok(bloco, `bloco nao encontrado: ${r.text}`);
  assert.equal(bloco, "function Soma() {\n  return 1 + 1;\n}\n");
});

// ------------------------------- BUG-9 --------------------------------- //
// Achado na analise de codigo (14/10 a noite): a guarda de selfClosing que o
// BUG-7 pos em htmlToMarkdown (tag void nao mexe no skipDepth) NAO existe no
// extractLinks. Tag de skip self-closing (<script .../>, <svg/>) sobe o
// skipDepth e nao gera token de fecho — o resto da pagina inteiro desaparece
// da lista de links.
test("BUG-9: <script .../> self-closing nao engole os links seguintes", async () => {
  const r = await mcp.call("extract_links", { url: `${fixture.url}/skip-self` });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /2 encontrados/, `links perdidos: ${r.text}`);
  assert.match(r.text, /alvo-1/);
  assert.match(r.text, /alvo-2/);
});

test("BUG-9: <svg .../> self-closing nao engole os links seguintes", async () => {
  const r = await mcp.call("extract_links", { url: `${fixture.url}/skip-svg` });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /2 encontrados/, `links perdidos: ${r.text}`);
  assert.match(r.text, /alvo-1/);
  assert.match(r.text, /alvo-2/);
});

// Controle: <script></script> fechado do jeito normal — sempre funcionou e
// tem de continuar funcionando (protege a correcao de quebrar o caso comum).
test("BUG-9 (controle): <script></script> fechado continua listando os links", async () => {
  const r = await mcp.call("extract_links", { url: `${fixture.url}/skip-open` });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /2 encontrados/, `links perdidos: ${r.text}`);
  assert.match(r.text, /alvo-1/);
  assert.match(r.text, /alvo-2/);
});

// ------------------------------- BUG-10 --------------------------------- //
// crawlOnePage no ramo cru (texto puro/XML) devolvia { linksInternos }, mas
// toolCrawlSite le .links — crawl em robots.txt ou sitemap quebrava com
// TypeError "primeira.links is not iterable" vestido de erro de crawl.
test("BUG-10: crawl_site comecando em texto puro nao quebra", async () => {
  const r = await mcp.call("crawl_site", { url: `${fixture.url}/robots`, maxPages: 3 });
  assert.equal(r.isError, false, r.text);
  assert.doesNotMatch(r.text, /is not iterable/);
  // o conteudo cru da pagina inicial tem de entrar no resultado
  assert.match(r.text, /User-agent: \*/);
});
