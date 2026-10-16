// Trava os PADROES de leitura da web real (DEFAULT_MAX_CHARS, MAX_REDIRECTS e
// DEFAULT_TIMEOUT_MS) — valores que mudaram de proposito e nao podem voltar
// para tras sem alguem perceber.
//
// Uso: node --test tests/defaults.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_CHARS,
  HARD_MAX_CHARS,
  MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
} from "../src/config.mjs";
import { truncate } from "../src/fetch.mjs";
import { startFixture, startMcp } from "./helpers.mjs";

let fixture;
let mcp;

before(async () => {
  fixture = await startFixture();
  // O timeout baixo aqui nao e o padrao de producao: e a variavel de ambiente
  // que deixa a suite rodar rapido sem depender do valor padrao.
  mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", DEFAULT_TIMEOUT_MS: "1500" });
});

after(async () => {
  mcp?.close();
  await fixture?.close();
});

test("o padrao de maxChars e 8000 e vale tambem no argumento omitido", async () => {
  assert.equal(DEFAULT_MAX_CHARS, 8000, "DEFAULT_MAX_CHARS deve ser 8000");

  // O texto do fixture tem mais de 8000 caracteres: sem maxChars, o corte tem
  // de acontecer exatamente em 8000 (mais o aviso de truncamento).
  const r = await mcp.call("read_page", { url: `${fixture.url}/longa` });
  assert.equal(r.isError, false, r.text);
  // O corte e em 8000 caracteres; o que vem depois e o aviso de truncamento,
  // entao "exibidos" passa um pouco de 8000.
  const m = r.text.match(/Conteudo: (\d+) caracteres \(exibidos (\d+)\)/);
  assert.ok(m, `cabecalho inesperado: ${r.text.slice(0, 200)}`);
  assert.ok(Number(m[1]) > 8000, `a pagina deveria passar de 8000 caracteres: ${m[1]}`);
  assert.ok(Number(m[2]) > 8000 && Number(m[2]) < 8200, `o corte deveria ser em 8000: ${m[2]}`);
  assert.match(r.text, /conteudo truncado em 8000 caracteres/);
});

test("DEFAULT_MAX_CHARS nao pode passar do teto absoluto", () => {
  assert.ok(DEFAULT_MAX_CHARS >= 200, "o piso de maxChars e 200");
  assert.ok(DEFAULT_MAX_CHARS <= HARD_MAX_CHARS, "o padrao nao pode exceder HARD_MAX_CHARS");
});

test("MAX_REDIRECTS e 5", () => {
  assert.equal(MAX_REDIRECTS, 5, "MAX_REDIRECTS deve ser 5");
});

test("DEFAULT_TIMEOUT_MS e 8000 no padrao de producao", () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 8000, "DEFAULT_TIMEOUT_MS deve ser 8000");
});

test("o truncamento usa a constante exportada, nao um numero fixo", () => {
  const texto = "a".repeat(9000);
  const { text, truncated } = truncate(texto, DEFAULT_MAX_CHARS);
  assert.equal(truncated, true);
  assert.ok(text.length > DEFAULT_MAX_CHARS, "o aviso de truncamento entra no final");
  assert.match(text, /conteudo truncado em 8000 caracteres/);
});
