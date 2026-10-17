// Testes da junção de buscas em voo (single-flight).
//
// O cenário que estes testes protegem: muitos pedidos SIMULTÂNEOS da MESMA
// URL. Sem a junção, cada pedido disparava o próprio download enquanto o
// cache não esquentava — uma rajada de N virava N acessos ao site. Com ela,
// o primeiro iniciou a busca e os demais caronaram: o fixture conta 1 acesso.
//
// O contador REQ-<id>-<n> do fixture deixa o acesso visível de fora.
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

const reqDe = (texto, id) => {
  const m = texto.match(new RegExp(`REQ-${id}-(\\d+)`));
  assert.ok(m, `contador REQ-${id}-N nao apareceu na saida: ${texto.slice(0, 300)}`);
  return Number(m[1]);
};

test("rajada na mesma URL vira 1 acesso (junção em voo)", { timeout: 90000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const url = `${fixture.url}/page/pico?kb=30`;
    // 12 pedidos simultâneos da MESMA URL, mais lenta (500 ms) para garantir
    // que os pedidos chegam enquanto a busca está em andamento.
    const respostas = await Promise.all(
      Array.from({ length: 12 }, () =>
        mcp.call("read_page", { url: `${fixture.url}/page/pico-lento?kb=30&ms=500`, maxChars: 300, timeoutMs: 20000 })
      )
    );
    for (const r of respostas) assert.equal(r.isError, false, r.text);

    // Todos recebem a MESMA resposta (mesmo contador de acesso).
    const contadores = respostas.map((r) => reqDe(r.text, "pico-lento"));
    assert.equal(new Set(contadores).size, 1, `contadores diferentes: ${contadores.join(",")}`);
    assert.equal(contadores[0], 1, `deveria haver 1 acesso, houve ${contadores[0]}`);

    // E o /health mostra o trabalho evitado.
    const health = await (await fetch(`${mcp.base}/health`)).text();
    const colapsadas = Number((health.match(/coalescidas: (\d+)/) || [])[1] || 0);
    assert.ok(colapsadas >= 11, `esperava >=11 caronas, veio ${colapsadas}: ${health}`);
  } finally {
    mcp.close();
  }
});

test("pedidos em série (não simultâneos) continuam servidos do cache", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const url = `${fixture.url}/page/serie?kb=5`;
    const r1 = await mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
    assert.equal(reqDe(r1.text, "serie"), 1);
    // Em série o segundo nem toca na rede: cache quente.
    const r2 = await mcp.call("read_page", { url, maxChars: 300, timeoutMs: 20000 });
    assert.equal(reqDe(r2.text, "serie"), 1);
  } finally {
    mcp.close();
  }
});

test("falha compartilhada não vira rejeição solta nem derruba o servidor", { timeout: 90000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    // URL que nunca responde (/crawl/trava aceita a conexão e fica calada):
    // os N pedidos em voo compartilham a MESMA falha — e o processo NÃO pode
    // morrer por rejeição não tratada (a política do projeto é encerrar; a
    // promessa guardada precisa ser consumida).
    const url = `${fixture.url}/crawl/trava`;
    const respostas = await Promise.all(
      Array.from({ length: 8 }, () =>
        mcp.call("read_page", { url, maxChars: 300, timeoutMs: 1000 }).catch(() => ({ isError: true, text: "socket" }))
      )
    );
    const erros = respostas.filter((r) => r.isError);
    assert.ok(erros.length >= 1, "pelo menos uma deveria falhar (timeout)");

    // O servidor tem de continuar no ar e atendendo.
    const health = await fetch(`${mcp.base}/health`);
    assert.equal(health.status, 200, "o servidor deveria continuar no ar");
    const depois = await mcp.call("read_page", { url: `${fixture.url}/page/pviva?kb=1`, maxChars: 200, timeoutMs: 10000 });
    assert.equal(depois.isError, false, `deveria atender depois da falha: ${depois.text}`);
    assert.doesNotMatch(mcp.stderr(), /rejeição não tratada|exceção não tratada/);
  } finally {
    mcp.close();
  }
});
