// Testes do teto de concorrencia POR HOST.
//
// O que se quer garantir: um site lento (ou um lote inteiro de URLs do mesmo
// site) NAO consome todas as vagas de download — os outros hosts continuam
// sendo atendidos em paralelo. E o teto global continua valendo por cima.
//
// Uso: node --test tests/host-limit.test.mjs
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

test("um host lento nao monopoliza as vagas (os outros passam em paralelo)", { timeout: 60000 }, async () => {
  // Teto global generoso (8), teto por host pequeno (1). Com 3 pedidos do
  // MESMO host devendo ~500 ms cada, e preciso que os pedidos desse host
  // fiquem em fila, enquanto um pedido de OUTRO host passe na hora.
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    OUTBOUND_MAX_CONCURRENCY: "8",
    OUTBOUND_MAX_QUEUE: "50",
    HOST_MAX_CONCURRENCY: "1",
    HOST_MAX_QUEUE: "50",
    MAX_WAIT_MS: "30000",
  });
  try {
    // Os 3 do host "127.0.0.1" ficam serializados em ~500 ms cada (~1.5 s no total).
    const doMesmoHost = Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        mcp.call("read_page", { url: `${fixture.url}/lento?ms=500&id=h${i}`, maxChars: 300, timeoutMs: 20000 })
      )
    );
    // Este outro host (127.0.0.2) nao pode esperar a fila do primeiro.
    await new Promise((r) => setTimeout(r, 150)); // deixa os 3 entrarem na fila
    const t0 = performance.now();
    const outro = await mcp.call("read_page", {
      url: `${fixture.urlAlt}/lento?ms=100&id=outro`,
      maxChars: 300,
      timeoutMs: 20000,
    });
    const msOutro = performance.now() - t0;

    const respostas = await doMesmoHost;
    assert.ok(respostas.every((r) => !r.isError), `todas deveriam concluir: ${respostas.map((r) => r.text.slice(0, 60)).join(" | ")}`);
    assert.equal(outro.isError, false, `o outro host deveria passar: ${outro.text.slice(0, 200)}`);

    // Se o host lento monopolizasse, o pedido de fora esperaria ~1,5 s na fila.
    // Com o teto por host, ele sai em ~100-400 ms (a latencia propria).
    assert.ok(
      msOutro < 1200,
      `o outro host esperou ${msOutro.toFixed(0)} ms — a fila do host lento o segurou`
    );

    // E o /health mostra a contabilidade por host.
    const health = await (await fetch(`${mcp.base}/health`)).text();
    assert.match(health, /por host: \d+ host\(s\)/);
  } finally {
    mcp.close();
  }
});

test("fila do host cheia devolve erro claro, sem travar", { timeout: 60000 }, async () => {
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    OUTBOUND_MAX_CONCURRENCY: "8",
    OUTBOUND_MAX_QUEUE: "50",
    HOST_MAX_CONCURRENCY: "1",
    HOST_MAX_QUEUE: "0", // sem fila por host: o segundo ja e recusado
    MAX_WAIT_MS: "30000",
  });
  try {
    const respostas = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        mcp.call("read_page", { url: `${fixture.url}/lento?ms=300&id=f${i}`, maxChars: 300, timeoutMs: 20000 })
      )
    );
    const atendidas = respostas.filter((r) => !r.isError);
    const recusadas = respostas.filter((r) => r.isError);
    assert.ok(atendidas.length >= 1, "pelo menos uma deveria passar");
    assert.ok(recusadas.length >= 1, `as excedentes deveriam ser recusadas: ${respostas.map((r) => r.isError).join(",")}`);
    assert.match(recusadas[0].text, /Servidor ocupado/, `erro inesperado: ${recusadas[0].text.slice(0, 200)}`);
  } finally {
    mcp.close();
  }
});

test("o estado por host nao vaza: host sem ninguem ativo sai do mapa", { timeout: 60000 }, async () => {
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    HOST_MAX_CONCURRENCY: "2",
    HOST_MAX_QUEUE: "10",
  });
  try {
    const r = await mcp.call("read_page", { url: `${fixture.url}/pagina`, maxChars: 500, timeoutMs: 15000 });
    assert.equal(r.isError, false, r.text);
    // Espera o limpeza acontecer (ela e sincrona no liberar, mas garante o ciclo).
    await new Promise((r2) => setTimeout(r2, 100));
    const health = await (await fetch(`${mcp.base}/health`)).text();
    const m = health.match(/por host: (\d+) host\(s\), (\d+) ativos, (\d+) na fila/);
    assert.ok(m, `formato inesperado: ${health}`);
    assert.equal(Number(m[2]), 0, "ninguem deveria estar ativo depois da leitura");
    assert.equal(Number(m[3]), 0, "a fila deveria estar vazia");
    assert.equal(Number(m[1]), 0, `nenhum host deveria ficar preso no mapa: ${health}`);
  } finally {
    mcp.close();
  }
});
