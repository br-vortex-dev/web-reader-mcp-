// Testes do cache em memoria (LRU + TTL com teto em BYTES).
//
// O fixture devolve um contador de requisicoes por id dentro do texto
// ("REQ-<id>-<n>"), o que deixa visivel de fora se a resposta veio do cache
// (mesmo n) ou foi baixada de novo (n maior).
//
// Uso: node --test tests/...
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp, cacheInfo } from "./helpers.mjs";

let fixture;

before(async () => {
  fixture = await startFixture();
});

after(async () => {
  await fixture?.close();
});

const pagina = (id, kb) => `${fixture.url}/page/${id}?kb=${kb}`;
const reqDe = (texto, id) => {
  const m = texto.match(new RegExp(`REQ-${id}-(\\d+)`));
  assert.ok(m, `contador REQ-${id}-N nao apareceu na saida`);
  return Number(m[1]);
};

test("respeita o teto em bytes (CACHE_MAX_BYTES)", { timeout: 60000 }, async () => {
  const MAX = 1024 * 1024; // 1 MB
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", CACHE_MAX_BYTES: String(MAX) });
  try {
    const urls = Array.from({ length: 12 }, (_, i) => pagina(`b${i}`, 150));
    const r = await mcp.call("read_multiple_pages", { urls, maxChars: 200, timeoutMs: 20000 });
    assert.equal(r.isError, false, r.text);

    const info = await cacheInfo(mcp);
    assert.equal(info.maxBytes, MAX, "o /health deveria refletir CACHE_MAX_BYTES");
    assert.ok(
      info.bytes <= MAX,
      `o cache passou do teto: ${info.bytes} bytes > ${MAX}`
    );
    assert.ok(
      info.entries < 12,
      `deveria ter despejado entradas (12 paginas de ~150 KB nao cabem em 1 MB), mas ficaram ${info.entries}`
    );
    assert.ok(info.entries > 0, "o cache nao deveria ficar vazio");
  } finally {
    mcp.close();
  }
});

test("entrada maior que o limite nao entra no cache, mas e devolvida", { timeout: 60000 }, async () => {
  const MAX = 1024 * 1024; // 1 MB -> limite de entrada = min(256 KB, 5 MB) = 256 KB
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", CACHE_MAX_BYTES: String(MAX) });
  try {
    const url = pagina("grande", 400); // 400 KB > 256 KB
    const r1 = await mcp.call("read_page", { url, maxChars: 400, timeoutMs: 20000 });
    assert.equal(r1.isError, false, `a pagina grande deveria ser devolvida normalmente: ${r1.text}`);
    assert.equal(reqDe(r1.text, "grande"), 1);

    const info = await cacheInfo(mcp);
    assert.equal(info.bytes, 0, `nada deveria ter entrado no cache (bytes=${info.bytes})`);

    const r2 = await mcp.call("read_page", { url, maxChars: 400, timeoutMs: 20000 });
    assert.equal(
      reqDe(r2.text, "grande"),
      2,
      "a segunda leitura deveria baixar de novo (a entrada nao pode estar no cache)"
    );
  } finally {
    mcp.close();
  }
});

test("acerta o cache e nao conta a mesma chave duas vezes", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const url = pagina("hit", 20);
    const r1 = await mcp.call("read_page", { url, maxChars: 200, timeoutMs: 20000 });
    assert.equal(reqDe(r1.text, "hit"), 1);
    const depoisDaPrimeira = await cacheInfo(mcp);

    for (let i = 0; i < 3; i++) {
      const r = await mcp.call("read_page", { url, maxChars: 200, timeoutMs: 20000 });
      assert.equal(reqDe(r.text, "hit"), 1, "deveria vir do cache (mesmo contador)");
    }
    const depois = await cacheInfo(mcp);
    assert.equal(depois.entries, 1, "a mesma URL nao pode virar duas entradas");
    assert.equal(
      depois.bytes,
      depoisDaPrimeira.bytes,
      "reler a mesma URL nao pode mudar a contagem em bytes"
    );
  } finally {
    mcp.close();
  }
});

test("mantem a semantica LRU ao despejar", { timeout: 60000 }, async () => {
  // O limite de UMA entrada e 1/4 do teto, entao com teto de 400 KB cabem 4
  // paginas de ~90 KB (368 KB) e a 5a precisa despejar a menos usada.
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", CACHE_MAX_BYTES: "400000" });
  try {
    const A = pagina("lruA", 90);
    const B = pagina("lruB", 90);
    const C = pagina("lruC", 90);
    const D = pagina("lruD", 90);
    const E = pagina("lruE", 90);

    for (const url of [A, B, C, D]) {
      const r = await mcp.call("read_page", { url, maxChars: 100, timeoutMs: 20000 });
      assert.equal(r.isError, false, r.text);
    }
    assert.equal((await cacheInfo(mcp)).entries, 4, "as 4 primeiras deveriam caber");

    // Toca A: agora o menos recentemente usado e B.
    const aHit = await mcp.call("read_page", { url: A, maxChars: 100, timeoutMs: 20000 });
    assert.equal(reqDe(aHit.text, "lruA"), 1, "A deveria estar no cache");

    // E entra e despeja o LRU (B).
    await mcp.call("read_page", { url: E, maxChars: 100, timeoutMs: 20000 });
    const depois = await cacheInfo(mcp);
    assert.equal(depois.entries, 4, "deveria continuar com 4 entradas");
    assert.ok(depois.bytes <= 400000, `o cache passou do teto: ${depois.bytes}`);

    const bDepois = await mcp.call("read_page", { url: B, maxChars: 100, timeoutMs: 20000 });
    assert.equal(reqDe(bDepois.text, "lruB"), 2, "B era o LRU e deveria ter sido despejado");

    const aDepois = await mcp.call("read_page", { url: A, maxChars: 100, timeoutMs: 20000 });
    assert.equal(reqDe(aDepois.text, "lruA"), 1, "A foi tocada depois de B e deveria sobreviver");
  } finally {
    mcp.close();
  }
});

test("libera os bytes da entrada expirada", { timeout: 60000 }, async () => {
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    CACHE_TTL_MS: "700", // TTL curto so para o teste
  });
  try {
    const url = pagina("ttl", 40);
    await mcp.call("read_page", { url, maxChars: 200, timeoutMs: 20000 });
    const comEntrada = await cacheInfo(mcp);
    assert.equal(comEntrada.entries, 1);
    assert.ok(comEntrada.bytes > 0);

    await new Promise((r) => setTimeout(r, 1200));

    // Expirada: a releitura precisa baixar de novo e nao pode acumular bytes.
    const r = await mcp.call("read_page", { url, maxChars: 200, timeoutMs: 20000 });
    assert.equal(reqDe(r.text, "ttl"), 2, "com o TTL vencido deveria baixar de novo");
    const depois = await cacheInfo(mcp);
    assert.equal(depois.entries, 1, "a entrada expirada nao pode continuar contando");
    assert.ok(
      depois.bytes <= comEntrada.bytes,
      `a contagem em bytes derivou: ${depois.bytes} > ${comEntrada.bytes}`
    );
  } finally {
    mcp.close();
  }
});

test("despejo por contagem continua valendo (CACHE_MAX_ENTRIES)", { timeout: 120000 }, async () => {
  // Paginas minusculas (cabem em bytes), mas muitas: quem tem de despejar e a contagem.
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const urls = Array.from({ length: 30 }, (_, i) => pagina(`m${i}`, 1));
    await mcp.call("read_multiple_pages", { urls, maxChars: 100, timeoutMs: 20000 });
    const info = await cacheInfo(mcp);
    assert.equal(info.entries, 30, "30 entradas pequenas deveriam caber (teto de 100)");
    assert.ok(info.bytes < 100 * 1024, `30 paginas de ~1 KB nao podem ocupar tanto: ${info.bytes} bytes`);
  } finally {
    mcp.close();
  }
});

/* ------------------- stale-while-revalidate (CACHE_SWR) ------------------- */

test("SWR: vencido serve na hora e a rajada no vencimento vira 1 revalidação", { timeout: 90000 }, async () => {
  // Backend atrasado de 300 ms de propósito: garante que a revalidação fica
  // EM VOO enquanto a rajada inteira chega — é isso que prova a coalescência.
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    CACHE_SWR: "1",
    CACHE_TTL_MS: "1000",
    CACHE_STALE_WINDOW_MS: "60000",
  });
  try {
    const url = `${fixture.url}/page/swr?kb=5&ms=300`;

    // 1a leitura: busca de verdade (contador 1).
    const r1 = await mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
    assert.equal(reqDe(r1.text, "swr"), 1);

    // Vence (TTL 1 s), seguindo DENTRO da janela de graça (60 s).
    await new Promise((r) => setTimeout(r, 1200));

    // Rajada no vencimento: ninguém espera rede — todos recebem o vencido.
    const t0 = Date.now();
    const rajada = await Promise.all(
      Array.from({ length: 8 }, () => mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 }))
    );
    const ms = Date.now() - t0;
    for (const r of rajada) {
      assert.equal(r.isError, false, r.text);
      assert.equal(reqDe(r.text, "swr"), 1, `deveria servir o vencido (contador 1): ${r.text.slice(0, 200)}`);
    }
    assert.ok(ms < 2500, `a rajada não podia esperar a rede (levou ${ms} ms)`);

    // A revalidação roda atrás: depois dela, a leitura devolve a versão nova.
    await new Promise((r) => setTimeout(r, 800));
    const r2 = await mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
    assert.equal(reqDe(r2.text, "swr"), 2, `revalidação deveria ter atualizado (contador 2): ${r2.text.slice(0, 200)}`);

    // E o /health conta UMA revalidação — não oito (a rajada coalesceu nela).
    const health = await (await fetch(`${mcp.base}/health`)).text();
    const m = health.match(/revalidacoes: (\d+) \(falhas (\d+)\)/);
    assert.ok(m, `o /health deveria trazer o contador de revalidações: ${health}`);
    assert.equal(Number(m[1]), 1, `a rajada deveria colapsar em 1 revalidação: ${health}`);
    assert.equal(Number(m[2]), 0, `nenhuma revalidação deveria falhar: ${health}`);
  } finally {
    mcp.close();
  }
});

test("SWR desligado (padrão): vencido continua bloqueando na nova busca", { timeout: 60000 }, async () => {
  // O padrão da suíte e do modo local segue conservador: expirada = busca de novo.
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    CACHE_TTL_MS: "700",
  });
  try {
    const url = pagina("swroff", 10);
    await mcp.call("read_page", { url, maxChars: 200, timeoutMs: 20000 });
    await new Promise((r) => setTimeout(r, 1200));
    const r = await mcp.call("read_page", { url, maxChars: 200, timeoutMs: 20000 });
    assert.equal(reqDe(r.text, "swroff"), 2, "sem SWR a releitura precisa baixar de novo");
    const health = await (await fetch(`${mcp.base}/health`)).text();
    const m = health.match(/revalidacoes: (\d+) \(falhas (\d+)\)/);
    assert.equal(Number(m[1]), 0, `sem SWR nao pode haver revalidacao: ${health}`);
  } finally {
    mcp.close();
  }
});
