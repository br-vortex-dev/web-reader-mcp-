// Testes da memoização da conversão (HTML -> markdown/meta/links).
//
// O que se quer garantir: em acerto de cache o conteúdo já foi baixado, então
// NÃO se paga de novo a conversão — o resultado fica preso ao MESMO objeto de
// payload. Conteúdo novo (nova busca, TTL vencido) converte de novo. Os
// contadores do /health deixam o efeito visível de fora.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp } from "./helpers.mjs";

let fixture;

before(async () => {
  fixture = await startFixture();
});

after(async () => {
  await fixture?.close();
});

// Le { realizadas, caronas } do /health.
async function conversoesDe(mcp) {
  const texto = await (await fetch(`${mcp.base}/health`)).text();
  const m = texto.match(/conversoes: (\d+) \(reaproveitadas (\d+)\)/);
  assert.ok(m, `o /health deveria trazer o contador de conversoes: ${texto}`);
  return { realizadas: Number(m[1]), caronas: Number(m[2]) };
}

test("acerto de cache reaproveita a conversão (não reconverte)", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const url = `${fixture.url}/page/memo1?kb=5`;

    // 1a leitura: baixa + converte (meta e markdown = 2 conversões reais).
    const r1 = await mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
    assert.equal(r1.isError, false, r1.text);
    const apos1 = await conversoesDe(mcp);
    assert.equal(apos1.realizadas, 2, `1a leitura deveria converter 2x (meta+markdown), realizou ${apos1.realizadas}`);
    assert.equal(apos1.caronas, 0);

    // Leituras seguintes: cache quente -> caronas, sem novas conversões.
    for (let i = 0; i < 2; i++) {
      const r = await mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
      assert.equal(r.isError, false, r.text);
    }
    const apos3 = await conversoesDe(mcp);
    assert.equal(apos3.realizadas, 2, `não podia reconverter: realizadas ${apos3.realizadas}`);
    assert.equal(apos3.caronas, 4, `as 2 releituras deveriam reaproveitar 4 conversões: ${apos3.caronas}`);
  } finally {
    mcp.close();
  }
});

test("conteúdo novo (TTL vencido) converte de novo — e o próximo acerto reaproveita", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", CACHE_TTL_MS: "800" });
  try {
    const url = `${fixture.url}/page/memo2?kb=5`;
    await mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
    assert.equal((await conversoesDe(mcp)).realizadas, 2);

    // Vence o TTL: a releitura baixa conteúdo NOVO (objeto novo) e converte de novo.
    await new Promise((r) => setTimeout(r, 1300));
    await mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
    const apos2 = await conversoesDe(mcp);
    assert.equal(apos2.realizadas, 4, `conteúdo novo deveria reconverter: ${apos2.realizadas}`);

    // E o acerto seguinte (mesmo payload novo) volta a reaproveitar.
    await mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
    const apos3 = await conversoesDe(mcp);
    assert.equal(apos3.realizadas, 4);
    assert.equal(apos3.caronas, 2, `o acerto deveria reaproveitar: ${apos3.caronas}`);
  } finally {
    mcp.close();
  }
});

test("MEMO_CONVERSAO=0 desliga a memoização (cada leitura converte)", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", MEMO_CONVERSAO: "0" });
  try {
    const url = `${fixture.url}/page/memo3?kb=5`;
    await mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
    await mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
    const apos = await conversoesDe(mcp);
    assert.equal(apos.realizadas, 4, `sem memo cada leitura converte (2+2): ${apos.realizadas}`);
    assert.equal(apos.caronas, 0, `sem memo não pode haver carona: ${apos.caronas}`);
  } finally {
    mcp.close();
  }
});

test("read_multiple_pages e extract_links compartilham a conversão do mesmo payload", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const alvo = `${fixture.url}/pagina`;
    // A leitura converte meta+markdown (+links do crawl interno).
    const m = await mcp.call("read_multiple_pages", { urls: [alvo], maxChars: 400, timeoutMs: 20000 });
    assert.equal(m.isError, false, m.text);
    const depoisDaLeitura = await conversoesDe(mcp);
    assert.ok(depoisDaLeitura.realizadas >= 2, `a leitura converteu: ${JSON.stringify(depoisDaLeitura)}`);

    // extract_links no MESMO payload: os links já foram extraídos e ficam em memo.
    const l = await mcp.call("extract_links", { url: alvo, limit: 5 });
    assert.equal(l.isError, false, l.text);
    const depoisDosLinks = await conversoesDe(mcp);
    assert.equal(
      depoisDosLinks.realizadas,
      depoisDaLeitura.realizadas,
      `extract_links não podia pagar conversão de novo: ${JSON.stringify(depoisDosLinks)}`
    );
    assert.ok(depoisDosLinks.caronas > depoisDaLeitura.caronas, "deveria ter havido carona");
  } finally {
    mcp.close();
  }
});
