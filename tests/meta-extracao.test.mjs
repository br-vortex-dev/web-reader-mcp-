// Regressao da extracao de metadados (extractMeta).
//
// A varredura das tags <meta> deixou de ser /<meta\b[^>]*>/gi e virou um
// laco com indexOf("<") — mesmo criterio, ~37% menos CPU em pagina grande.
// Estes casos travam o criterio que o regex tinha e que e facil perder numa
// varredura manual: nome sem diferenciar maiusculas, fronteira de palavra
// ("metadata" nao e <meta>), tag ate o primeiro ">" e primeiro valor vence.
//
// Uso: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../src/html-parser.mjs";

test("meta com maiusculas e minusculas mistas e reconhecida", () => {
  const meta = extractMeta(
    `<head><META NAME="description" CONTENT="Maiuscula">` +
      `<Meta property="og:title" content="Mista"></head>`
  );
  assert.equal(meta.description, "Maiuscula");
  assert.equal(meta.title, "Mista");
});

test("<metadata> nao e <meta> e o primeiro valor vence", () => {
  const meta = extractMeta(
    `<metadata name="description" content="errada">` +
      `<meta name="description" content="certa">` +
      `<meta name="description" content="segunda ignorada">`
  );
  assert.equal(meta.description, "certa");
});

test("a tag termina no primeiro '>'", () => {
  const meta = extractMeta(`<meta name="description" content="a>b"><meta property="og:title" content="t">`);
  assert.equal(meta.description, "");
  assert.equal(meta.title, "t");
});

test("author so vale pelo atributo name; published e truncado em 25", () => {
  const meta = extractMeta(
    `<meta property="author" content="Pelo property nao">` +
      `<meta name="author" content="Ana">` +
      `<meta property="article:published_time" content="2026-01-02T03:04:05Z extra">`
  );
  assert.equal(meta.author, "Ana");
  assert.equal(meta.published, "2026-01-02T03:04:05Z extr");
});

test("sem <title> cai no og:title e nao quebra com HTML sem tag fechada", () => {
  assert.equal(extractMeta(`<meta property="og:title" content="Do og">`).title, "Do og");
  assert.equal(extractMeta(`<meta name="description" content="d"><meta`).description, "d");
  assert.deepEqual(extractMeta(""), { title: "", description: "", author: "", published: "" });
});
