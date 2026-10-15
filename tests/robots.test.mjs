// Testes de robots.txt: bloqueio, Allow mais longa que vence, curingas,
// ancora $, fail-open em robo inacessivel, TTL da busca e escape hatch.
//
// Uso: node --test tests/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp } from "./helpers.mjs";

let fixture;
let mcp;

before(async () => {
  fixture = await startFixture(); // modo "regras" (padrao)
  mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
});

after(async () => {
  mcp?.close();
  await fixture?.close();
});

/* ------------------------------ bloqueio -------------------------------- */

test("Disallow bloqueia a URL, com mensagem que explica e diz como escapar", { timeout: 30000 }, async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/privado/qualquer` });
  assert.equal(r.isError, true, `deveria bloquear: ${r.text}`);
  assert.match(
    r.text,
    /Bloqueado por robots\.txt de .+: o caminho \/privado\/qualquer casa com "Disallow: \/privado"/,
    `mensagem inesperada: ${r.text}`
  );
  assert.match(r.text, /ROBOTS_RESPECT=0/, `a mensagem tem de citar o escape: ${r.text}`);
});

test("Allow mais longa que o Disallow vence", { timeout: 30000 }, async () => {
  // Disallow: /privado (8) vs Allow: /privado/publico (16) — o mais longo
  // manda, e a pagina e lida.
  const r = await mcp.call("read_page", { url: `${fixture.url}/privado/publico` });
  assert.equal(r.isError, false, `deveria ler: ${r.text}`);
  assert.match(r.text, /MARCADO-PUBLICO/);
});

test("curinga * no padrao do Disallow funciona", { timeout: 30000 }, async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/coisa/curinga` });
  assert.equal(r.isError, true, `deveria bloquear: ${r.text}`);
  assert.match(r.text, /casa com "Disallow: \/\*\/curinga"/);
});

test("$ ancora o fim do padrao: /termo bloqueia, /termo-extra nao", { timeout: 30000 }, async () => {
  const bloqueado = await mcp.call("read_page", { url: `${fixture.url}/termo` });
  assert.equal(bloqueado.isError, true, `/termo deveria bloquear: ${bloqueado.text}`);
  assert.match(bloqueado.text, /casa com "Disallow: \/termo\$"/);

  const liberado = await mcp.call("read_page", { url: `${fixture.url}/termo-extra` });
  assert.equal(liberado.isError, false, `/termo-extra deveria passar: ${liberado.text}`);
  assert.match(liberado.text, /MARCADO-TERMO-EXTRA/);
});

test("caminho sem regra passa normalmente", { timeout: 30000 }, async () => {
  const r = await mcp.call("read_page", { url: `${fixture.url}/livre` });
  assert.equal(r.isError, false, `deveria ler: ${r.text}`);
  assert.match(r.text, /MARCADO-LIVRE/);
});

test("o bloqueio vale para extract_links, nao so read_page", { timeout: 30000 }, async () => {
  const r = await mcp.call("extract_links", { url: `${fixture.url}/privado/qualquer` });
  assert.equal(r.isError, true, `deveria bloquear: ${r.text}`);
  assert.match(r.text, /Bloqueado por robots\.txt/);
});

/* ------------------------- cache e fail-open ---------------------------- */

test("robots.txt e buscado UMA vez por origem (TTL)", { timeout: 30000 }, async () => {
  // Duas URLs diferentes na mesma origem: a segunda nao pode buscar o
  // robots.txt de novo.
  await mcp.call("read_page", { url: `${fixture.url}/livre` });
  await mcp.call("read_page", { url: `${fixture.url}/termo-extra` });
  assert.equal(fixture.contagemDe("/robots.txt"), 1, "o robots.txt so pode ser buscado uma vez");
});

test("robots.txt inacessivel (HTTP 500) = fail-open", { timeout: 30000 }, async () => {
  const fixtureQuebrado = await startFixture({ robots: "erro500" });
  const mcpRobo = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const r = await mcpRobo.call("read_page", { url: `${fixtureQuebrado.url}/privado/qualquer` });
    assert.equal(r.isError, false, `sem regra para cumprir, nada a bloquear: ${r.text}`);
    assert.match(r.text, /MARCADO-PRIVADO/);
  } finally {
    mcpRobo.close();
    await fixtureQuebrado.close();
  }
});

test("ROBOTS_RESPECT=0 desliga a checagem (escape hatch)", { timeout: 30000 }, async () => {
  const mcpRobo0 = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", ROBOTS_RESPECT: "0" });
  const antes = fixture.contagemDe("/robots.txt");
  try {
    const r = await mcpRobo0.call("read_page", { url: `${fixture.url}/privado/qualquer` });
    assert.equal(r.isError, false, `com a checagem desligada deveria ler: ${r.text}`);
    assert.match(r.text, /MARCADO-PRIVADO/);

    // O escape nao pode sequer buscar o robots.txt.
    assert.equal(fixture.contagemDe("/robots.txt"), antes, "sem respeito, nem busca o robots.txt");
  } finally {
    mcpRobo0.close();
  }
});

// Garante que a fixture serve as regras que os casos acima assumem: se
// alguem mexer no robots.txt do fixture, este teste quebra primeiro.
test("a fixture serve as regras que os casos assumem", async () => {
  const res = await fetch(`${fixture.url}/robots.txt`);
  assert.equal(res.status, 200);
  const texto = await res.text();
  assert.ok(texto.includes("Disallow: /privado"), texto);
  assert.ok(texto.includes("Allow: /privado/publico"), texto);
  assert.ok(texto.includes("Disallow: /*/curinga"), texto);
  assert.ok(texto.includes("Disallow: /termo$"), texto);
});
