// A passada única tem de reproduzir EXATAMENTE as duas funções separadas.
//
// `htmlToMarkdownComLinks` existe por performance: antes, `htmlToMarkdown` e
// `extractLinks` tokenizavam o mesmo HTML cada um (duas varreduras completas,
// 48,8 ms + 25,4 ms numa página de 1,34 MB). O ganho só vale se a saída for
// indistinguível — então este teste compara as duas rotas em todas as
// fixtures, incluindo ordem, texto, href e a marca `internal`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  htmlToMarkdown,
  htmlToMarkdownComLinks,
  extractLinks,
} from "../src/html-parser.mjs";

const BASE = "https://exemplo.com/pagina/";

const CASOS = [
  ["básico", `<h1>Título</h1><p>Texto com <a href="/relativo">link</a> e <b>negrito</b>.</p>`],
  ["imagens em link", `<a href="/x"><img src="/i.png" alt="Alt da imagem"></a><a href="/vazio"></a>`],
  ["links duplicados", `<a href="/a">A</a><a href="/a">A de novo</a><a href="/b">B</a>`],
  ["aria-hidden", `<div aria-hidden="true"><a href="/oculto">não deve aparecer</a></div><a href="/visivel">visível</a>`],
  ["skip tags", `<nav><a href="/menu">menu</a></nav><main><a href="/conteudo">conteúdo</a></main>`],
  ["script self-closing", `<script src="x.js"/><a href="/depois">depois do script</a>`],
  ["svg self-closing", `<svg viewBox="0 0 1 1"/><a href="/depois">depois do svg</a>`],
  ["tabela", `<table><tr><th>A</th><th>B</th></tr><tr><td><a href="/c">c</a></td><td>d</td></tr></table>`],
  ["pre/código", `<pre><code>linha 1\nlinha 2</code></pre><a href="/fim">fim</a>`],
  ["malformado", `<p>sem fechar <a href="/m">link solto <div>bloco</div></p>`],
  ["entidades", `<a href="/e?x=1&amp;y=2">A &amp; B &ccedil;</a>`],
  ["link externo e interno", `<a href="https://outro.com/x">fora</a><a href="/dentro">dentro</a>`],
  ["utm removido", `<a href="/limpo?utm_source=x&id=7">com utm</a>`],
  ["href inválido", `<a href="javascript:void(0)">js</a><a href="#topo">âncora</a><a href="/ok">ok</a>`],
  ["vazio", ""],
  ["texto puro", "só texto, sem tag nenhuma"],
];

function canonico(links) {
  return links.map((l) => ({ text: l.text, href: l.href, internal: l.internal }));
}

for (const [nome, html] of CASOS) {
  test(`passada única reproduz as duas funções: ${nome}`, () => {
    const mdSeparado = htmlToMarkdown(html, BASE);
    const linksSeparados = extractLinks(html, BASE);
    const unificado = htmlToMarkdownComLinks(html, BASE);

    assert.equal(unificado.markdown, mdSeparado, "o markdown tem de ser idêntico");
    assert.deepEqual(
      canonico(unificado.links),
      canonico(linksSeparados),
      "a lista de links tem de ser idêntica (ordem, texto, href, internal)"
    );
  });
}

test("a passada única conta os links mesmo com a parada antecipada ligada", () => {
  // Página grande o bastante para a parada disparar, com links espalhados:
  // o markdown para no teto, mas a lista de links continua completa.
  const bloco = "<p>" + "conteúdo de enchimento ".repeat(2000) + '<a href="/alvo-%d">link %d</a></p>';
  let html = "";
  for (let i = 0; i < 400; i++) html += bloco.replace(/%d/g, String(i));

  const separados = extractLinks(html, BASE);
  const diagnostico = { interrompida: false };
  const unificado = htmlToMarkdownComLinks(html, BASE, {
    minCharsEntregaveis: 5000,
    diagnostico,
  });

  assert.ok(diagnostico.interrompida, "a parada antecipada tinha de disparar nesta página");
  assert.deepEqual(
    canonico(unificado.links),
    canonico(separados),
    "a parada antecipada não pode truncar a lista de links"
  );
});
