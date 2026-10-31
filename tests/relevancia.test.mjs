// Testes da busca por trechos relevantes (find_relevant).
//
// O que se quer garantir:
// - acento e plural nao atrapalham ("baus" acha "baú"/"baús");
// - palavras vazias ("onde", "fica", "dos") nao casam com a pagina toda;
// - o trecho que cobre mais termos vem primeiro e secao de outro assunto
//   fica de fora;
// - maxTrechos respeita o teto;
// - sem casamento devolve aviso (nao pagina vazia), e avisa quando acha pouco;
// - consulta so de palavras vazias e erro de parametro;
// - pagina gigante avisa que a busca cobriu so a frente convertida.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarTexto,
  radicalDe,
  termosDaConsulta,
  blocosDoMarkdown,
  pontuarBlocos,
  recortarTrecho,
} from "../src/relevancia.mjs";
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

test("normaliza acento e maiusculas", () => {
  assert.equal(normalizarTexto("Baús da Floresta"), "baus da floresta");
  assert.equal(normalizarTexto("Localização"), "localizacao");
});

test("reduz plural regular e mantem palavra curta intacta", () => {
  assert.equal(radicalDe("baús"), "bau");
  assert.equal(radicalDe("baus"), "bau");
  assert.equal(radicalDe("localizações"), "localizacao");
  assert.equal(radicalDe("animais"), "animal");
  assert.equal(radicalDe("jardins"), "jardim");
  assert.equal(radicalDe("flores"), "flor");
  assert.equal(radicalDe("rapazes"), "rapaz");
  assert.equal(radicalDe("frases"), "frase");
  assert.equal(radicalDe("gas"), "gas");
});

test("descarta palavras vazias e repete radical so uma vez", () => {
  const termos = termosDaConsulta("onde ficam os baús baú");
  assert.deepEqual(termos.map((t) => t.radical), ["bau"]);
  assert.equal(termos[0].palavra, "baús");
  assert.deepEqual(
    termosDaConsulta("localização dos baús").map((t) => t.radical),
    ["localizacao", "bau"]
  );
});

test("blocos guardam a secao e nao misturam paragrafos", () => {
  const md =
    "# Guia\n\nTexto inicial.\n\n## Baús\n\nPrimeiro parágrafo.\n\n" +
    "Segundo parágrafo.\n\n## Combate\n\nOutro assunto.";
  const blocos = blocosDoMarkdown(md);
  assert.equal(blocos.length, 4);
  assert.deepEqual(
    blocos.map((b) => b.secao),
    ["Guia", "Baús", "Baús", "Combate"]
  );
  assert.equal(blocos[0].texto, "Texto inicial.");
  assert.equal(blocos[1].texto, "Primeiro parágrafo.");
});

test("pontua mais quem cobre os termos e quem esta na secao", () => {
  const blocos = [
    { secao: "Combate", texto: "A espada causa dano." },
    { secao: "Floresta", texto: "Um baú escondido entre as árvores." },
    { secao: "Baús da Floresta", texto: "Um baú escondido entre as árvores." },
    { secao: "Mapa", texto: "Os baús e a localização aparecem no mapa." },
  ];
  const achados = pontuarBlocos(blocos, termosDaConsulta("baús localização"));
  assert.equal(achados.length, 3);
  assert.match(achados[0].texto, /localização/);
  assert.equal(achados[1].secao, "Baús da Floresta");
  assert.equal(achados[2].secao, "Floresta");
  assert.ok(achados.every((a) => !a.texto.includes("espada")));
});

test("secao de apendice perde peso para a secao que responde", () => {
  const blocos = [
    { secao: "Referências", texto: "Node.js node Node.js node Node.js node Node.js node" },
    { secao: "História", texto: "O Node.js foi criado em 2009 e o Node.js cresceu." },
  ];
  const achados = pontuarBlocos(blocos, termosDaConsulta("node"));
  assert.equal(achados[0].secao, "História");
});

test("bloco que so tem link de editar fica de fora", () => {
  const blocos = blocosDoMarkdown(
    "## Seção\n\n[[editar](https://x/edit) | [editar código](https://x/edit2)]\n\nConteúdo de verdade."
  );
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].texto, "Conteúdo de verdade.");
});

test("termo que so aparece no titulo da secao ainda conta", () => {
  const achados = pontuarBlocos(
    [
      { secao: "Histórico", texto: "Dahl demonstrou o projeto em 2009." },
      { secao: "Geral", texto: "Um texto qualquer sem o termo." },
    ],
    termosDaConsulta("história")
  );
  assert.equal(achados.length, 1);
  assert.equal(achados[0].secao, "Histórico");
});

test("recorta trecho longo sem cortar no meio de uma linha", () => {
  const texto = ("linha de teste\n").repeat(500);
  const recortado = recortarTrecho(texto, 100);
  assert.ok(recortado.length < texto.length);
  assert.match(recortado, /trecho cortado/);
  assert.ok(recortado.split("\n").every((l) => l.length <= 100));
});

test("consulta sem acento acha os baus e deixa o combate de fora", async () => {
  const r = await mcp.call("find_relevant", { url: `${fixture.url}/baus`, query: "onde ficam os baus" });
  assert.equal(r.isError, false);
  assert.match(r.text, /# Trechos relevantes em:/);
  assert.match(r.text, /termos usados: baus/);
  assert.match(r.text, /baú/i);
  assert.match(r.text, /secao: Localização dos Baús/);
  assert.doesNotMatch(r.text, /Aprenda a esquivar/);
});

test("consulta com dois termos prioriza o trecho que cobre os dois", async () => {
  const r = await mcp.call("find_relevant", {
    url: `${fixture.url}/baus`,
    query: "localização dos baús",
  });
  assert.equal(r.isError, false);
  assert.match(r.text, /termos usados: localização, baús/);
  const primeiro = r.text.split("\n\n")[1];
  assert.match(primeiro, /^## 1\./);
  assert.match(primeiro, /Baú/);
  assert.match(primeiro, /Localização/);
});

test("maxTrechos limita a quantidade devolvida", async () => {
  const r = await mcp.call("find_relevant", {
    url: `${fixture.url}/baus`,
    query: "baús",
    maxTrechos: 2,
  });
  assert.equal(r.isError, false);
  assert.equal((r.text.match(/^## /gm) || []).length, 2);
  assert.match(r.text, /Trechos: 2 de [3-9]/);
});

test("maxTrechos 0 vira 1 em vez de devolver nada", async () => {
  const r = await mcp.call("find_relevant", {
    url: `${fixture.url}/baus`,
    query: "baús",
    maxTrechos: 0,
  });
  assert.equal(r.isError, false);
  assert.equal((r.text.match(/^## /gm) || []).length, 1);
});

test("termo ausente avisa em vez de devolver vazio", async () => {
  const r = await mcp.call("find_relevant", { url: `${fixture.url}/baus`, query: "dragão" });
  assert.equal(r.isError, false);
  assert.match(r.text, /Nenhum trecho relevante/);
});

test("consulta so com palavras vazias e erro de parametro", async () => {
  const r = await mcp.call("find_relevant", { url: `${fixture.url}/baus`, query: "onde fica dos" });
  assert.equal(r.isError, true);
  assert.match(r.text, /palavras vazias/);
});

test("acha pouco: avisa que so parte dos termos apareceu", async () => {
  const r = await mcp.call("find_relevant", { url: `${fixture.url}/baus`, query: "baús dragão" });
  assert.equal(r.isError, false);
  assert.match(r.text, /AVISO: achado fraco/);
});

test("pagina gigante avisa que a busca cobriu so a frente convertida", async () => {
  const r = await mcp.call("find_relevant", { url: `${fixture.url}/gigante`, query: "palavra" });
  assert.equal(r.isError, false);
  assert.match(r.text, /AVISO: a pagina e grande demais para converter inteira/);
});
