// Golden files do parser HTML -> markdown.
//
// A saída de htmlToMarkdown tem de ser IDENTICA à gravada em tests/golden/.
// Estes arquivos foram gerados do parser em funcionamento
// (node scripts/generate-golden.mjs) antes da refactor e são a proteção
// permanente: qualquer mudança de saída (mesmo acidental) derruba aqui.
//
// Uso: node --test tests/golden.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { htmlToMarkdown } from "../src/html-parser.mjs";
import { FIXTURE_HTML } from "./helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(__dirname, "golden");
const BASE = "https://exemplo.com/pagina";

// Os mesmos HTMLs do gerador. Se o gerador mudar, este mapa precisa acompanhar.
const CASES = {
  "01-fixture": FIXTURE_HTML,
  "02-tabelas": `<!DOCTYPE html><html><body>
<h2>Tabelas</h2>
<table><thead><tr><th>Nome</th><th>Valor</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr><tr><td>B|pipe</td><td>2</td></tr></tbody></table>
<table><tbody><tr><td>sem</td><td>cabecalho</td></tr><tr><td>x</td><td>y</td></tr></tbody></table>
<table><tr><th colspan="2">Titulo</th></tr><tr><td>linha<br>quebrada</td><td>ok</td></tr></table>
<table><tr><td rowspan="2">A</td><td>1</td></tr><tr><td>2</td></tr></table>
</body></html>`,
  "03-codigo": `<!DOCTYPE html><html><body>
<h2>Codigo</h2>
<p>Antes do codigo.</p>
<pre><code>def soma(a, b):
    if a > 0:
        return a + b
    return 0
</code></pre>
<p>Depois.</p>
<pre><code>servico:
  nome: api
  portas:
    - 80
    - 443
</code></pre>
<pre><code><div class="line">function Soma() {</div>
<div class="line">  return 1 + 1;</div>
<div>}</div>
</code></pre>
</body></html>`,
  "04-listas": `<!DOCTYPE html><html><body>
<h2>Listas</h2>
<ul><li>um</li><li>dois<ul><li>dois-um</li><li>dois-dois</li></ul></li><li>tres</li></ul>
<ol><li>primeiro</li><li>segundo</li></ol>
<dl><dt>Termo</dt><dd>Definicao</dd></dl>
</body></html>`,
  "05-links": `<!DOCTYPE html><html><body>
<h2><a href="/titulo">Titulo com link</a></h2>
<p>Veja <a href="https://outro.com/x?a=1&utm_source=ads">outro site</a> e <a href="/relativo">relativo</a>.</p>
<p><a href="/so-imagem"><img src="/img.png" alt="Legenda"></a></p>
<p><img src="/logo.png" alt=""></p>
</body></html>`,
  "06-inline": `<!DOCTYPE html><html><body>
<h2>Inline</h2>
<p><strong>negrito</strong>, <em>italico</em>, <b>b</b>, <i>i</i>, <code>codigo inline</code> e <br> quebra.</p>
<p>Entidades: &ccedil;&atilde;o &amp; &lt; &gt; &quot; &#231; &#xE7; &naoexiste; &#99999999;</p>
<hr>
<blockquote>Citação em bloco</blockquote>
</body></html>`,
  "07-aria-hidden": `<!DOCTYPE html><html><body>
<div aria-hidden="true"><p>Enfeite que não deve aparecer</p></div>
<h1>Artigo</h1>
<p>Texto de verdade, com bastante conteúdo para passar da marca de 300 caracteres. Mais uma frase para garantir.</p>
<div aria-hidden="true"><a href="/nao-lista">link escondido</a></div>
<img src="/logo.png" alt="" aria-hidden="true">
<p>Depois do bloco escondido.</p>
</body></html>`,
  "08-skip": `<!DOCTYPE html><html><head><script src="/app.js"/></head><body>
<style>.x{color:red}</style>
<svg width="16" height="16" aria-hidden="true"/>
<h1>Pagina</h1>
<p><a href="/alvo-1">Alvo um</a></p><p><a href="/alvo-2">Alvo dois</a></p>
<template><p>template</p></template>
<noscript><p>noscript</p></noscript>
</body></html>`,
  "09-malformado": `<!DOCTYPE html><html><body>
<p>Compare 3 < 5 e 5 > 3 neste paragrafo.</p>
<p>Menor-que no fim do documento:</p>
<
<p>Tags nao fechadas: <b>negrito <i>italico <u>sublinhado</p>
<p>Entidade sem ponto e virgula: &amp e &lt</p>
</body></html>`,
  "10-tabela-aninhada": `<!DOCTYPE html><html><body>
<table>
<thead><tr><th>A</th><th>B</th></tr></thead>
<tbody>
<tr><td>1</td><td><table><tr><th>X</th><th>Y</th></tr><tr><td>x1</td><td>y1</td></tr></table></td></tr>
<tr><td>2</td><td>3</td></tr>
</tbody>
</table>
</body></html>`,
  "11-wikipedia": `<!DOCTYPE html><html><head><title>Node.js - Wikipédia</title></head><body>
<div class="alerta">Skip to content</div>
<h1>Node.js</h1>
<p>Origem: Wikipédia, a enciclopédia livre.</p>
<table><tr><td aria-hidden="true">1</td><td>const a = 1;</td></tr></table>
<p>[[Arquivo:logo.svg|miniaturadaimagem|Logo]]</p>
</body></html>`,
  "12-cdata": `<!DOCTYPE html><html><body>
<h1>Feed</h1>
<p><![CDATA[Texto com <marcacao> dentro]]></p>
</body></html>`,
  "13-headings": `<!DOCTYPE html><html><body>
<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>
<p><a href="/x">link antes do h2</a></p>
<h2>H2 depois de link</h2>
</body></html>`,
  "14-vazio": `<!DOCTYPE html><html><head><title>Só título</title></head><body></body></html>`,
  "15-texto-puro": `Apenas texto, sem tag nenhuma. Com < e > soltos.`,
  "16-previa": `<html><body>
<h1>Dados</h1>
<div id="root"></div>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"titulo":"Produto X","preco":123.45}}}</script>
</body></html>`,
  "17-colspan-multiplo": `<!DOCTYPE html><html><body>
<table><tr><th colspan="3">Grupo</th></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>
<table><tr><td>x</td><td colspan="2">y</td></tr></table>
</body></html>`,
  "18-pre-dentro-de-tabela": `<!DOCTYPE html><html><body>
<table><tr><td><pre><code>linha1
linha2</code></pre></td><td>texto</td></tr></table>
</body></html>`,
  "19-links-duplicados": `<!DOCTYPE html><html><body>
<p><a href="/a">A</a> e <a href="/a">A de novo</a> e <a href="/b">B</a></p>
</body></html>`,
  "20-quebras": `<!DOCTYPE html><html><body>
<p>Linha com    varios espaços	e tab.</p>
<p>Duas quebras<br><br>seguidas.</p>
<div>bloco</div><div>outro bloco</div>
</body></html>`,
};

const arquivos = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort();

test("existe pelo menos um golden file", () => {
  assert.ok(arquivos.length >= 15, `esperava pelo menos 15 golden files, há ${arquivos.length}`);
});

for (const arquivo of arquivos) {
  const nome = arquivo.replace(/\.md$/, "");
  test(`golden: ${nome}`, () => {
    const esperado = readFileSync(join(GOLDEN_DIR, arquivo), "utf8");
    const html = CASES[nome];
    assert.ok(html, `golden file sem caso correspondente: ${nome} (registre em CASES e em scripts/generate-golden.mjs)`);
    const obtido = htmlToMarkdown(html, BASE);
    assert.equal(obtido, esperado);
  });
}
