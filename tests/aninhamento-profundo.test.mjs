// Testes de aninhamento profundo.
//
// Motivo: um teste de estresse antigo mostrou "div x100000 -> 0,00MB de saida"
// e isso foi lido como perda de conteudo. Nao era: <div> vazio nao emite texto.
// O que importa provar e que o conteudo REAL no fundo do aninhamento (texto e
// link) sobrevive — sem teto artificial de profundidade e sem estourar a pilha.

import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown, htmlToMarkdownComLinks, extractLinks } from "../src/html-parser.mjs";

const BASE = "https://exemplo.com/";

/** Monta <div> x n -> miolo -> </div> x n. */
function aninhar(n, miolo) {
  return "<div>".repeat(n) + miolo + "</div>".repeat(n);
}

test("texto no fundo do aninhamento sobrevive em qualquer profundidade", () => {
  for (const n of [1, 100, 10000, 100000]) {
    const md = htmlToMarkdown(aninhar(n, "FIM"), BASE);
    assert.equal(md.trim(), "FIM", `profundidade ${n} perdeu o texto`);
  }
});

test("link no fundo do aninhamento e extraido, com href resolvido", () => {
  for (const n of [1, 100, 10000, 100000]) {
    const links = extractLinks(aninhar(n, '<a href="/alvo">FIM</a>'), BASE);
    assert.equal(links.length, 1, `profundidade ${n}: esperava 1 link`);
    assert.equal(links[0].href, "https://exemplo.com/alvo");
    assert.equal(links[0].text, "FIM");
    assert.equal(links[0].internal, true);
  }
});

test("markdown com links preserva o link do fundo (assinatura: html, baseUrl)", () => {
  const { markdown, links } = htmlToMarkdownComLinks(aninhar(50000, '<a href="/alvo">FIM</a>'), BASE);
  assert.equal(links.length, 1);
  assert.match(markdown, /\[FIM\]\(https:\/\/exemplo\.com\/alvo\)/);
});

test("aninhamento desbalanceado nao perde o conteudo", () => {
  const semFechar = "<div>".repeat(50000) + "FIM";
  const fechandoDemais = "FIM" + "</div>".repeat(50000);
  assert.equal(htmlToMarkdown(semFechar, BASE).trim(), "FIM");
  assert.equal(htmlToMarkdown(fechandoDemais, BASE).trim(), "FIM");
});

test("muitos niveis nao estouram a pilha (sem RangeError)", () => {
  assert.doesNotThrow(() => htmlToMarkdown(aninhar(200000, "fundo"), BASE));
});
