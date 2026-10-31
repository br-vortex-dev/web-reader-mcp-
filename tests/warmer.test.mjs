// Testes do aquecedor de cache (CACHE_WARMER=1): as paginas mais pedidas sao
// revalidadas ANTES de vencer, para a primeira leitura depois do TTL nao pagar
// a espera do site de novo.
//
// Uso: node --test tests/warmer.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp, sleep } from "./helpers.mjs";

let fixture;

before(async () => {
  fixture = await startFixture();
});

after(async () => {
  await fixture?.close();
});

// Le o /health ate o contador de aquecidas chegar em `alvo` (ou estourar o prazo).
async function esperarAquecidas(mcp, alvo, ms = 15000) {
  const limite = Date.now() + ms;
  let health = "";
  while (Date.now() < limite) {
    health = await (await fetch(`${mcp.base}/health`)).text();
    if (aquecidasDe(health) >= alvo) return health;
    await sleep(250);
  }
  return health;
}

// O /health escreve "(N quentes, M aquecidas, F falhas)".
function aquecidasDe(health) {
  const m = health.match(/, (\d+) aquecidas,/);
  return m ? Number(m[1]) : 0;
}

test("desligado por padrao: nenhuma chamada de rede por conta propria", { timeout: 30000 }, async () => {
  // Sem CACHE_WARMER a suite inteira nao pode assumir trabalho de fundo: duas
  // leituras viram UMA requisicao ao site, e nenhuma rodada acontece depois.
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    CACHE_TTL_MS: "1500",
    CACHE_WARMER_INTERVAL_MS: "5000",
    CACHE_WARMER_MARGEM_MS: "5000",
    CACHE_WARMER_MIN_PEDIDOS: "1",
  });
  try {
    const antes = fixture.contagemDe("/quente");
    const url = `${fixture.url}/quente`;
    const r1 = await mcp.call("read_page", { url });
    const r2 = await mcp.call("read_page", { url });
    assert.equal(r1.isError, false, r1.text.slice(0, 200));
    assert.equal(r2.isError, false, r2.text.slice(0, 200));
    assert.equal(fixture.contagemDe("/quente"), antes + 1, "as duas leituras deveriam vir do cache");

    // Espera passar mais de uma rodada: sem aquecedor, o contador nao muda.
    await sleep(6000);
    assert.equal(
      fixture.contagemDe("/quente"),
      antes + 1,
      "sem CACHE_WARMER nao pode haver revalidacao de fundo"
    );
    const health = await (await fetch(`${mcp.base}/health`)).text();
    assert.match(health, /aquecimento: desligado/, `o /health deveria dizer que esta desligado: ${health}`);
  } finally {
    mcp.close();
  }
});

test("ligado: revalida a pagina popular antes de vencer, sem pedido de cliente", { timeout: 40000 }, async () => {
  // TTL curto (1,5 s) e rodada a cada 5 s: a entrada vence e a rodada a renova
  // sozinha. A pagina lida UMA vez nao bate o minimo de pedidos e fica de fora.
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    CACHE_TTL_MS: "1500",
    CACHE_WARMER: "1",
    CACHE_WARMER_INTERVAL_MS: "5000",
    CACHE_WARMER_MARGEM_MS: "5000",
    CACHE_WARMER_MIN_PEDIDOS: "2",
    CACHE_WARMER_MAX_URLS: "4",
    CACHE_WARMER_TIMEOUT_MS: "5000",
  });
  try {
    const quente = `${fixture.url}/quente`;
    const frio = `${fixture.url}/page/frio-aquecedor?kb=1`;
    const antesQuente = fixture.contagemDe("/quente");
    const antesFrio = fixture.hitsDe("frio-aquecedor");

    // Duas leituras da mesma URL: a segunda sai do cache (contador fica em 1).
    const a = await mcp.call("read_page", { url: quente });
    const b = await mcp.call("read_page", { url: quente });
    assert.equal(a.isError, false, a.text.slice(0, 200));
    assert.equal(b.isError, false, b.text.slice(0, 200));
    assert.equal(fixture.contagemDe("/quente"), antesQuente + 1, "as duas leituras deveriam vir do cache");

    // Uma leitura isolada: entra no placar, mas nao bate o minimo de 2 pedidos.
    const c = await mcp.call("read_page", { url: frio });
    assert.equal(c.isError, false, c.text.slice(0, 200));
    assert.equal(fixture.hitsDe("frio-aquecedor"), antesFrio + 1);

    // A rodada de fundo renova a pagina quente SEM nenhum read_page novo.
    const health = await esperarAquecidas(mcp, 1);
    assert.ok(aquecidasDe(health) >= 1, `o /health deveria registrar o aquecimento: ${health}`);
    assert.equal(
      fixture.contagemDe("/quente"),
      antesQuente + 2,
      "a pagina quente deveria ter sido revalidada uma vez"
    );

    // E a pagina pedida uma vez so continua intocada pelo aquecedor.
    assert.equal(
      fixture.hitsDe("frio-aquecedor"),
      antesFrio + 1,
      "pagina abaixo do minimo de pedidos nao pode ser aquecida"
    );
  } finally {
    mcp.close();
  }
});

test("o aquecedor mantem a entrada fresca entre rodadas", { timeout: 40000 }, async () => {
  // Duas rodadas seguidas: depois da primeira a entrada esta fresca (idade <
  // TTL - margem), entao a segunda NAO deve rebaixar de novo. Prova que o
  // aquecedor nao vira download perpetuo: ele respeita o vencimento.
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    CACHE_TTL_MS: "60000",
    CACHE_WARMER: "1",
    CACHE_WARMER_INTERVAL_MS: "5000",
    CACHE_WARMER_MARGEM_MS: "5000",
    CACHE_WARMER_MIN_PEDIDOS: "1",
    CACHE_WARMER_MAX_URLS: "4",
  });
  try {
    const antes = fixture.contagemDe("/quente");
    const url = `${fixture.url}/quente`;
    const r = await mcp.call("read_page", { url });
    assert.equal(r.isError, false, r.text.slice(0, 200));
    assert.equal(fixture.contagemDe("/quente"), antes + 1);

    // Com TTL de 60 s a entrada esta LONGE de vencer: a rodada nao faz nada.
    await sleep(6500);
    assert.equal(
      fixture.contagemDe("/quente"),
      antes + 1,
      "entrada fresca nao pode ser rebaixada: o aquecedor so age perto do vencimento"
    );
    const health = await (await fetch(`${mcp.base}/health`)).text();
    assert.match(health, /aquecimento: ligado \(1 quentes, 0 aquecidas/, `formato inesperado: ${health}`);
  } finally {
    mcp.close();
  }
});
