// Testes de integracao com a web publica de verdade.
//
// O principio que governa o projeto e "ler a web publica", entao as correcoes
// de seguranca nao podem ter reduzido essa capacidade. Sem internet, os testes
// sao pulados em vez de falharem.
//
// Uso: node --test tests/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMcp } from "./helpers.mjs";

let mcp;

before(async () => {
  mcp = await startMcp(); // padrao de producao: bloqueio de privados LIGADO
});

after(async () => {
  mcp?.close();
});

async function temInternet() {
  try {
    const res = await fetch("https://example.com", { signal: AbortSignal.timeout(10000) });
    return res.ok;
  } catch {
    return false;
  }
}

test("le uma pagina publica https normalmente", { timeout: 60000 }, async (t) => {
  if (!(await temInternet())) return t.skip("sem internet");
  const r = await mcp.call("read_page", { url: "https://example.com", maxChars: 2000, timeoutMs: 20000 });
  assert.equal(r.isError, false, `read_page falhou: ${r.text}`);
  assert.match(r.text, /Example Domain/);
});

test("segue o redirect http -> https de um site publico", { timeout: 60000 }, async (t) => {
  if (!(await temInternet())) return t.skip("sem internet");
  // github.com responde 301 de http para https.
  const r = await mcp.call("read_page", { url: "http://github.com/", maxChars: 2000, timeoutMs: 25000 });
  assert.equal(r.isError, false, `read_page falhou no redirect: ${r.text}`);
  assert.match(r.text, /^# /);
});

test("le uma pagina publica grande e extrai tabelas validas", { timeout: 90000 }, async (t) => {
  if (!(await temInternet())) return t.skip("sem internet");
  const r = await mcp.call("read_page", {
    url: "https://pt.wikipedia.org/wiki/Node.js",
    maxChars: 40000,
    timeoutMs: 30000,
  });
  assert.equal(r.isError, false, `read_page falhou: ${r.text}`);
  assert.match(r.text, /Node\.js/);
  // O separador de tabela GFM so aparece se a tabela saiu valida.
  assert.match(r.text, /^\| --- \|/m, "nenhuma tabela markdown valida foi gerada");
});

test("discover_urls funciona num site publico", { timeout: 60000 }, async (t) => {
  if (!(await temInternet())) return t.skip("sem internet");
  const r = await mcp.call("discover_urls", { url: "https://pt.wikipedia.org", limit: 5, timeoutMs: 20000 });
  assert.equal(r.isError, false, `discover_urls falhou: ${r.text}`);
  assert.match(r.text, /sitemap|links internos/i);
});
