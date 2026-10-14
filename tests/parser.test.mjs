// Testes do parser HTML -> markdown.
// Cada caso aqui e um bug real que corrompia o conteudo extraido.
//
// Uso: node --test tests/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp, blocosDeCodigo, tabelas, celulas } from "./helpers.mjs";

let fixture;
let mcp;
let markdown = "";

// O fixture e local (127.0.0.1), entao estes testes rodam com o bloqueio de
// hosts privados desligado.
before(async () => {
  fixture = await startFixture();
  mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  const r = await mcp.call("read_page", { url: `${fixture.url}/pagina`, maxChars: 50000 });
  assert.equal(r.isError, false, `read_page falhou: ${r.text}`);
  markdown = r.text;
});

after(async () => {
  mcp?.close();
  await fixture?.close();
});

test("preserva '<' solto no texto (3 < 5)", () => {
  assert.match(markdown, /Compare 3 < 5 e 5 > 3 neste paragrafo\./);
  assert.doesNotMatch(markdown, /Compare 3 3 /);
});

test("preserva '<' no fim do documento", () => {
  assert.match(markdown, /CASO 9 \(menor-que no fim do documento\):\s*\n\s*</);
});

test("preserva a indentacao de codigo Python", () => {
  const blocos = blocosDeCodigo(markdown);
  const python = blocos.find((b) => b.startsWith("def soma"));
  assert.ok(python, "bloco Python nao encontrado");
  assert.equal(python, "def soma(a, b):\n    if a > 0:\n        return a + b\n    return 0\n");
});

test("preserva a indentacao de codigo YAML", () => {
  const blocos = blocosDeCodigo(markdown);
  const yaml = blocos.find((b) => b.startsWith("servico:"));
  assert.ok(yaml, "bloco YAML nao encontrado");
  assert.equal(yaml, "servico:\n  nome: api\n  portas:\n    - 80\n    - 443\n");
});

test("gera tabela markdown valida com cabecalho th", () => {
  const encontradas = tabelas(markdown);
  assert.ok(encontradas.length >= 2, `esperava pelo menos 2 tabelas, achei ${encontradas.length}`);
  const comTh = encontradas.find((t) => t[0].includes("Nome"));
  assert.ok(comTh, "tabela com th nao encontrada");
  assert.equal(comTh[0], "| Nome | Valor |");
  assert.equal(comTh[1], "| --- | --- |");
  assert.equal(comTh[2], "| A | 1 |");
});

test("escapa o '|' dentro da celula", () => {
  assert.match(markdown, /\| B\\\|pipe \| 2 \|/);
});

test("gera tabela valida mesmo sem cabecalho", () => {
  const semTh = tabelas(markdown).find((t) => t[0].includes("sem"));
  assert.ok(semTh, "tabela sem th nao encontrada");
  assert.equal(semTh[0], "| sem | cabecalho |");
  assert.equal(semTh[1], "| --- | --- |");
  assert.equal(semTh[2], "| x | y |");
});

test("toda tabela tem o mesmo numero de celulas em todas as linhas", () => {
  const encontradas = tabelas(markdown);
  assert.ok(encontradas.length >= 2, "nao encontrei tabelas para validar");
  for (const grupo of encontradas) {
    const esperado = celulas(grupo[0]).length;
    for (const linha of grupo) {
      assert.equal(
        celulas(linha).length,
        esperado,
        `linha com numero de celulas diferente (${linha})`
      );
    }
  }
});

test("degrada colspan/br sem perder texto", () => {
  const grupo = tabelas(markdown).find((t) => t[0].includes("Titulo"));
  assert.ok(grupo, "tabela com colspan nao encontrada");
  // colspan vira uma celula e o <br> vira espaco, mas o texto continua la.
  assert.ok(grupo.some((l) => l.includes("linha quebrada")), "texto com <br> foi perdido");
  assert.ok(grupo.some((l) => l.includes("Titulo")), "texto do th com colspan foi perdido");
});

test("decodifica entidades acentuadas do portugues", () => {
  assert.match(markdown, /ção é Água Ø & fim\./);
  assert.doesNotMatch(markdown, /&ccedil;|&atilde;|&eacute;|&Aacute;|&Oslash;/);
});

test("decodifica entidades numericas (decimal e hexadecimal)", () => {
  assert.match(markdown, /Numericas: ç ç\./);
});

test("mantem entidade desconhecida como texto, sem sumir", () => {
  assert.match(markdown, /Desconhecida: &naoexiste;/);
});

test("mantem codigo numerico fora de range como texto, sem sumir", () => {
  assert.match(markdown, /Fora de range: &#99999999;/);
});
