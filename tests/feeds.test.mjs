// Testes do read_feed e read_json com fixtures locais.
//
// O que se quer garantir:
// - RSS 2.0 e Atom: titulo, link, data, autor e resumo de cada item no markdown;
// - CDATA nao vaza a marcação nem perde o texto (o erro caro seria engolir o item);
// - JSON Feed tambem e reconhecido (nao so XML);
// - pagina HTML nao vira "feed vazio": recusa explicando e aponta o read_page;
// - read_json formata, declara a forma e respeita o `path`;
// - JSON invalido devolve motivo, nao stack trace.

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

test("RSS: devolve cabecalho do canal e os itens com link e data", async () => {
  const r = await mcp.call("read_feed", { url: `${fixture.url}/feed/rss.xml` });
  assert.equal(r.isError, false);
  assert.match(r.text, /# Blog de Teste/);
  assert.match(r.text, /Formato: RSS 2\.0/);
  assert.match(r.text, /Itens: 2/);
  assert.match(r.text, /Primeiro post/);
  assert.match(r.text, /Link: https:\/\/exemplo\.com\/primeiro/);
  assert.match(r.text, /Publicado: 2026-10-14T12:00:00Z/);
  assert.match(r.text, /Resumo do primeiro post\./);
});

test("RSS: CDATA entrega o texto e descarta a marcação", async () => {
  const r = await mcp.call("read_feed", { url: `${fixture.url}/feed/rss.xml` });
  assert.equal(r.isError, false);
  // O titulo vinha como CDATA com <b> dentro: a marcação some, o texto fica.
  assert.match(r.text, /Segundo post/);
  assert.doesNotMatch(r.text, /<b>/);
  assert.doesNotMatch(r.text, /CDATA/);
  // O resumo tambem vinha em CDATA com HTML.
  assert.match(r.text, /Resumo com HTML dentro\./);
});

test("Atom: usa o link do atributo href e o autor aninhado", async () => {
  const r = await mcp.call("read_feed", { url: `${fixture.url}/feed/atom.xml` });
  assert.equal(r.isError, false);
  assert.match(r.text, /# Atom de Teste/);
  assert.match(r.text, /Formato: Atom/);
  assert.match(r.text, /Link: https:\/\/exemplo\.com\/um/);
  assert.match(r.text, /Autor: Beltrano/);
  assert.match(r.text, /Resumo da entrada um\./);
});

test("JSON Feed tambem e reconhecido", async () => {
  const r = await mcp.call("read_feed", { url: `${fixture.url}/feed/jsonfeed.json` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Formato: JSON Feed/);
  assert.match(r.text, /Item do JSON Feed/);
  assert.match(r.text, /https:\/\/exemplo\.com\/j1/);
});

test("pagina HTML nao vira feed vazio: recusa e aponta o feed anunciado", async () => {
  const r = await mcp.call("read_feed", { url: `${fixture.url}/feed/pagina.html` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Feed nao reconhecido/);
  assert.match(r.text, /https:\/\/exemplo\.com\/feed\.xml/);
  assert.match(r.text, /read_feed/);
});

test("limit corta a lista de itens", async () => {
  const r = await mcp.call("read_feed", { url: `${fixture.url}/feed/rss.xml`, limit: 1 });
  assert.equal(r.isError, false);
  // O cabecalho declara o total do feed E quantos foram exibidos.
  assert.match(r.text, /Itens: 2 \(exibindo 1\)/);
  assert.match(r.text, /Primeiro post/);
  assert.doesNotMatch(r.text, /Segundo post/);
});

test("read_json devolve formatado e declara a forma", async () => {
  const r = await mcp.call("read_json", { url: `${fixture.url}/json/simples.json` });
  assert.equal(r.isError, false);
  assert.match(r.text, /Forma: objeto com 3 chave\(s\)/);
  assert.match(r.text, /```json/);
  assert.match(r.text, /"nome": "Teste"/);
});

test("read_json com path entrega so o ramo pedido", async () => {
  const r = await mcp.call("read_json", { url: `${fixture.url}/json/simples.json`, path: "data.items" });
  assert.equal(r.isError, false);
  assert.match(r.text, /Caminho: data\.items/);
  assert.match(r.text, /array de 2 item\(ns\)/);
  assert.doesNotMatch(r.text, /"nome": "Teste"/);
});

test("read_json com path inexistente explica em vez de devolver undefined", async () => {
  const r = await mcp.call("read_json", { url: `${fixture.url}/json/simples.json`, path: "nao.existe" });
  assert.equal(r.isError, false);
  assert.match(r.text, /caminho nao encontrado/i);
  assert.match(r.text, /objeto com 3 chave/);
});

test("JSON invalido devolve o motivo, sem stack trace", async () => {
  const r = await mcp.call("read_json", { url: `${fixture.url}/json/invalido.json` });
  assert.equal(r.isError, false);
  assert.match(r.text, /JSON invalido/);
  assert.doesNotMatch(r.text, /at JSON\.parse/);
});

test("read_json em HTML aponta o read_page", async () => {
  const r = await mcp.call("read_json", { url: `${fixture.url}/` });
  assert.equal(r.isError, false);
  assert.match(r.text, /HTML, nao JSON/);
  assert.match(r.text, /read_page/);
});
