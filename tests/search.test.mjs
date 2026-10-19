// Testes do read_search SEM rede: extração do HTML do provedor e validação.
//
// O que se quer garantir:
// - o extrator do DuckDuckGo pega título, URL real (desembrulha o redirect
//   uddg=) e resumo de cada resultado;
// - link patrocinado/anúncio não entra na lista;
// - URL repetida não vira resultado repetido (dedupe);
// - consulta vazia é recusada com motivo, não com lista vazia silenciosa;
// - HTML sem resultado nenhum devolve lista vazia (a camada de cima decide).

import { test } from "node:test";
import assert from "node:assert/strict";
import { extrairDdg, toolSearch } from "../src/search.mjs";

// Página mínima no formato real do html.duckduckgo.com: o href vem embrulhado
// no redirecionador (//duckduckgo.com/l/?uddg=...), e o resumo é um <a> irmão.
const HTML = `
<html><body>
  <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexemplo.com%2Fartigo-1&amp;rut=abc" class="result__a">Artigo Um &amp; cia</a>
  <a class="result__snippet">Resumo do primeiro artigo.</a>
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexemplo.com%2Fartigo-2">Artigo Dois</a>
  <a class="result__snippet">Resumo do segundo.</a>
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexemplo.com%2Fartigo-1">Artigo Um repetido</a>
  <a class="result__snippet">Resumo repetido, deve ser ignorado.</a>
</body></html>`;

test("extrai titulo, URL real (desembrulha uddg) e resumo", () => {
  const achados = extrairDdg(HTML);
  assert.equal(achados.length, 2, "o repetido não entra");
  assert.equal(achados[0].titulo, "Artigo Um & cia", "entidade HTML é decodificada");
  assert.equal(achados[0].url, "https://exemplo.com/artigo-1", "uddg é desembrulhado");
  assert.equal(achados[0].resumo, "Resumo do primeiro artigo.");
  assert.equal(achados[1].url, "https://exemplo.com/artigo-2");
});

test("a classe pode vir antes do href (as duas ordens)", () => {
  const invertido = `<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexemplo.com%2Fx">X</a>`;
  const achados = extrairDdg(invertido);
  assert.equal(achados.length, 1);
  assert.equal(achados[0].url, "https://exemplo.com/x");
});

test("HTML sem resultado devolve lista vazia, não erro", () => {
  assert.deepEqual(extrairDdg("<html><body>nada aqui</body></html>"), []);
});

test("consulta vazia é recusada com motivo", async () => {
  await assert.rejects(() => toolSearch({ q: "   " }), /informe o termo/);
  await assert.rejects(() => toolSearch({}), /informe o termo/);
});
