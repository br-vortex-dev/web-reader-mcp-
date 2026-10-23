// Regressao de desempenho e corretude de decodeEntities.
//
// O bug original: `indexOf(";", amp + 1)` varria o resto do documento a CADA
// "&". Num texto com muito "&" solto e nenhum ";" (HTML quebrado, comum na
// web real) o custo virava O(n^2): 80 mil "&" custavam 369 ms, 160 mil ~1,4 s.
// A correcao limita a busca do ";" a MAX_CORPO_ENTIDADE caracteres e para no
// primeiro caractere que nao pode compor entidade.
//
// Uso: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, htmlToMarkdown } from "../src/html-parser.mjs";

test("decodifica as entidades usuais (nomeadas, decimal e hexadecimal)", () => {
  assert.equal(decodeEntities("&amp;"), "&");
  assert.equal(decodeEntities("&lt;a&gt;"), "<a>");
  assert.equal(decodeEntities("&#65;&#x42;"), "AB");
  assert.equal(decodeEntities("a &amp;&amp; b"), "a && b");
});

test("entidade acentuada do portugues", () => {
  assert.equal(decodeEntities("a&ccedil;&atilde;o"), "ação");
});

test("texto sem entidade volta identico, sem alocar", () => {
  const texto = "apenas texto normal, com commas e pontos.";
  assert.equal(decodeEntities(texto), texto);
});

test("entidade desconhecida fica como esta, sem sumir", () => {
  assert.equal(decodeEntities("&naoexiste;"), "&naoexiste;");
  assert.equal(decodeEntities("& ;"), "& ;");
});

test("codigo fora de faixa fica como texto em vez de lancar", () => {
  assert.equal(decodeEntities("&#999999999;"), "&#999999999;");
});

test("'&' sem ';' nao engole o texto seguinte", () => {
  assert.equal(decodeEntities("a & b & c"), "a & b & c");
  assert.equal(decodeEntities("&amp"), "&amp");
  assert.equal(decodeEntities("&lt tag &gt"), "&lt tag &gt");
});

test("corpo que passa do teto nao e decodificado", () => {
  const longo = "&" + "a".repeat(64) + ";";
  assert.equal(decodeEntities(longo), longo);
});

test("muitos '&' sem ';' terminam rapido (nao e mais O(n^2))", () => {
  // 400 mil "&": no caminho antigo isso levava segundos; agora fica na casa
  // das dezenas de milissegundos. O teto aqui e folgado para nao falhar em
  // maquina lenta, mas ainda assim impossivel de passar com O(n^2).
  function medir(n) {
    const texto = "&".repeat(n);
    const t0 = process.hrtime.bigint();
    const saida = decodeEntities(texto);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(saida, texto);
    return ms;
  }
  medir(20000); // aquecimento
  const t400k = medir(400000);
  assert.ok(
    t400k < 500,
    `400 mil "&" levaram ${t400k.toFixed(0)} ms (esperado menos de 500 ms)`
  );
});

test("dobrar o tamanho nao quadruplica o tempo (crescimento linear)", () => {
  function medir(n) {
    const texto = "&".repeat(n);
    const t0 = process.hrtime.bigint();
    decodeEntities(texto);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  }
  medir(100000); // aquecimento do JIT
  // MEDIANA, nao o menor valor. A versao anterior tomava o minimo de tres
  // amostras de ~13 ms e comparava a razao entre dois tamanhos: um unico
  // pico de coletor na amostra de 200k derrubava a base e a razao saltava
  // para 5x num codigo comprovadamente linear (medido: ~60 ns/caractere em
  // 100k, 200k, 400k, 800k e 1,6M). Mediana de sete amostras e tamanhos
  // maiores medem a FORMA da curva, e nao o ruido da maquina.
  const mediana = (n, vezes) => {
    const v = [];
    for (let i = 0; i < vezes; i++) v.push(medir(n));
    v.sort((x, y) => x - y);
    return v[Math.floor(v.length / 2)];
  };
  // 400k/800k em vez de 200k/400k: o custo fixo da chamada pesa menos no
  // resultado, entao a razao reflete o algoritmo.
  const a = mediana(400000, 7);
  const b = mediana(800000, 7);
  const razao = b / Math.max(a, 0.01);
  assert.ok(
    razao < 3,
    `dobrar o tamanho multiplicou o tempo por ${razao.toFixed(2)} ` +
      `(${a.toFixed(1)} ms -> ${b.toFixed(1)} ms; esperado < 3, O(n^2) daria ~4)`
  );
});

test("a conversao de uma pagina cheia de '&' terminou sem travar", () => {
  const html = "<p>" + "&".repeat(100000) + "</p>";
  const t0 = process.hrtime.bigint();
  const md = htmlToMarkdown(html, "https://exemplo.com/");
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(md.length > 0);
  assert.ok(ms < 3000, `a conversao levou ${ms.toFixed(0)} ms`);
});
