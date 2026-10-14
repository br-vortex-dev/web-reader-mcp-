// Testes do relato de erro das ferramentas de varredura.
//
// Regra: falha nunca pode parecer "pagina vazia". Se a URL inicial nao puder
// ser lida, a ferramenta devolve isError. Se uma pagina do meio do crawl
// falhar, o crawl continua, mas o resumo diz que o resultado e parcial e
// agrupa os motivos.
//
// Uso: node --test tests/...
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp } from "./helpers.mjs";

let fixture;
let mcpBloqueando; // padrao de producao
let mcpLocal; // ALLOW_PRIVATE_HOSTS=1 (fixture local)

before(async () => {
  fixture = await startFixture();
  mcpBloqueando = await startMcp();
  mcpLocal = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
});

after(async () => {
  mcpBloqueando?.close();
  mcpLocal?.close();
  await fixture?.close();
});

/* ----------------------- URL inicial bloqueada -------------------------- */

test("crawl_site com a URL inicial bloqueada devolve isError", { timeout: 60000 }, async () => {
  const r = await mcpBloqueando.call("crawl_site", { url: `${fixture.url}/`, maxPages: 3, timeoutMs: 3000 });
  assert.equal(r.isError, true, `crawl_site deveria ser erro: ${r.text}`);
  assert.match(r.text, /Nao foi possivel iniciar o crawl/);
  assert.match(r.text, /Host bloqueado: endereco privado\/interno/);
  assert.doesNotMatch(r.text, /0 paginas lidas/);
});

test("discover_urls com a URL inicial bloqueada devolve isError", { timeout: 60000 }, async () => {
  const r = await mcpBloqueando.call("discover_urls", { url: `${fixture.url}/`, limit: 5, timeoutMs: 3000 });
  assert.equal(r.isError, true, `discover_urls deveria ser erro: ${r.text}`);
  assert.match(r.text, /Host bloqueado: endereco privado\/interno/);
});

test("extract_links com a URL inicial bloqueada devolve isError", { timeout: 60000 }, async () => {
  const r = await mcpBloqueando.call("extract_links", { url: `${fixture.url}/`, timeoutMs: 3000 });
  assert.equal(r.isError, true, `extract_links deveria ser erro: ${r.text}`);
  assert.match(r.text, /Host bloqueado: endereco privado\/interno/);
});

test("crawl_site com erro de DNS devolve isError", { timeout: 60000 }, async () => {
  const r = await mcpBloqueando.call("crawl_site", {
    url: "https://dominio-que-nao-existe-mesmo.invalid/",
    maxPages: 2,
    timeoutMs: 5000,
  });
  assert.equal(r.isError, true, `deveria ser erro: ${r.text}`);
  assert.match(r.text, /Nao foi possivel iniciar o crawl/);
});

/* --------------------------- crawl parcial ------------------------------ */

test("crawl com falhas parciais continua e resume os motivos", { timeout: 60000 }, async () => {
  const r = await mcpLocal.call("crawl_site", {
    url: `${fixture.url}/crawl/start`,
    maxPages: 10,
    maxChars: 300,
    timeoutMs: 1500,
  });
  assert.equal(r.isError, false, `o crawl deveria concluir: ${r.text}`);

  const cabecalho = r.text.split("\n\n")[0];
  // 3 leem (start, ok1, ok2) e 3 falham (404, timeout, nao-HTML).
  assert.match(cabecalho, /3 pagina\(s\) lida\(s\)/, cabecalho);
  assert.match(cabecalho, /RESULTADO PARCIAL: 3 pagina\(s\) falharam/, cabecalho);
  assert.match(cabecalho, /1 com HTTP 404/, cabecalho);
  assert.match(cabecalho, /1 com timeout/, cabecalho);
  assert.match(cabecalho, /1 com conteudo nao-HTML/, cabecalho);

  // Cada falha isolada aparece rotulada, com a URL.
  assert.match(r.text, /# Erro ao ler .*\/crawl\/erro404/);
  assert.match(r.text, /# Erro ao ler .*\/crawl\/trava/);
  assert.match(r.text, /# Erro ao ler .*\/crawl\/naohtml/);

  // E as paginas que leem continuam no resultado.
  assert.match(r.text, /conteudo ok/);
});

test("crawl sem falhas nao fala em resultado parcial", { timeout: 60000 }, async () => {
  const r = await mcpLocal.call("crawl_site", {
    url: `${fixture.url}/crawl/ok1`,
    maxPages: 3,
    maxChars: 300,
    timeoutMs: 5000,
  });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Crawl de .*: 1 pagina\(s\) lida\(s\)/);
  assert.doesNotMatch(r.text, /RESULTADO PARCIAL/);
});

/* --------------------- filtro de navegacao por segmento ---------------- */
// Os padroes de navegacao casavam contra a URL INTEIRA: /\/about/i filtrava
// /blog/about-cookies e a pagina de blog desaparecia do crawl.

test("filtro de navegacao casa por segmento, nao por substring da URL", { timeout: 60000 }, async () => {
  const r = await mcpLocal.call("crawl_site", {
    url: `${fixture.url}/nav/start`,
    maxPages: 6,
    maxChars: 300,
    timeoutMs: 5000,
  });
  assert.equal(r.isError, false, r.text);
  // segmento puro = descartado (nem entra na fila, nao gera falha)
  assert.doesNotMatch(r.text, /MARCADO-ABOUT-PURO/);
  // substring em segmento maior = TEM de ser lida
  assert.match(r.text, /MARCADO-ABOUT-COOKIES/, `about-cookies sumiu: ${r.text}`);
  // paginas normais e paginacao: /arquivo entra, /arquivo/page/2 nao
  assert.match(r.text, /MARCADO-ARQUIVO/);
  // 3 lidas (start, about-cookies, arquivo), nenhuma falha
  assert.match(r.text, /3 pagina\(s\) lida\(s\)/, r.text.slice(0, 200));
  assert.doesNotMatch(r.text, /RESULTADO PARCIAL/);
});

/* --------------------- read_multiple_pages (nao mudou) ------------------ */

test("read_multiple_pages rotula cada falha individual sem derrubar a chamada", { timeout: 60000 }, async () => {
  const r = await mcpBloqueando.call("read_multiple_pages", {
    urls: [`${fixture.url}/`, "https://example.invalid/", `${fixture.url}/outra`],
    maxChars: 100,
    timeoutMs: 3000,
  });
  // O isolamento por URL e o comportamento desejado: a chamada nao e erro.
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /0\/3 paginas OK/);
  // Mas cada falha aparece rotulada como erro.
  const marcadores = r.text.match(/# Erro ao ler /g) || [];
  assert.equal(marcadores.length, 3, `cada falha deveria estar rotulada: ${r.text}`);
  assert.match(r.text, /Host bloqueado: endereco privado\/interno/);
});
