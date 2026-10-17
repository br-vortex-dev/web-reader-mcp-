// Testes do controle de carga: admissao de requisicoes, limite de downloads e
// orcamento de memoria por bytes em voo.
//
// O que se quer garantir: sob saturacao o servidor NAO acumula latencia sem
// limite nem derruba — ele atende quem entra e devolve erro explicito para o
// resto, liberando as vagas depois.
//
// Uso: node --test tests/...
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp, sleep } from "./helpers.mjs";
import { criarLimitador } from "../src/utils.mjs";

let fixture;

before(async () => {
  fixture = await startFixture();
});

after(async () => {
  await fixture?.close();
});

const lento = (ms, id) => `${fixture.url}/lento?ms=${ms}&id=${id}`;

test("limite de downloads e respeitado e todos concluem", { timeout: 90000 }, async () => {
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    OUTBOUND_MAX_CONCURRENCY: "2",
    OUTBOUND_MAX_QUEUE: "50",
    MAX_WAIT_MS: "30000",
  });
  try {
    const picos = [];
    const amostrar = setInterval(async () => {
      try {
        const texto = await (await fetch(`${mcp.base}/health`)).text();
        const m = texto.match(/downloads: (\d+) ativos/);
        if (m) picos.push(Number(m[1]));
      } catch {
        // ocupado
      }
    }, 60);

    const respostas = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        mcp.call("read_page", { url: lento(300, i), maxChars: 500, timeoutMs: 20000 })
      )
    );
    clearInterval(amostrar);

    assert.ok(
      respostas.every((r) => !r.isError),
      `todas deveriam concluir: ${respostas.map((r) => r.text.slice(0, 80)).join(" | ")}`
    );
    const pico = Math.max(...picos, 0);
    assert.ok(pico <= 2, `nunca deveria passar de 2 downloads ao mesmo tempo, pico foi ${pico}`);
    assert.ok(pico > 0, "o pico deveria ser medido (senao o teste nao prova nada)");
  } finally {
    mcp.close();
  }
});

test("fila de downloads cheia devolve erro claro em vez de travar", { timeout: 60000 }, async () => {
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    OUTBOUND_MAX_CONCURRENCY: "1",
    OUTBOUND_MAX_QUEUE: "0", // sem fila: o segundo ja e recusado
    MAX_WAIT_MS: "30000",
  });
  try {
    const respostas = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        mcp.call("read_page", { url: lento(400, i), maxChars: 500, timeoutMs: 20000 })
      )
    );
    const recusadas = respostas.filter((r) => r.isError);
    const atendidas = respostas.filter((r) => !r.isError);
    assert.ok(atendidas.length >= 1, "pelo menos uma deveria ser atendida");
    assert.ok(recusadas.length >= 1, `as outras deveriam ser recusadas: ${respostas.map((r) => r.isError).join(",")}`);
    assert.match(recusadas[0].text, /Servidor ocupado/, `erro inesperado: ${recusadas[0].text}`);

    // E as vagas sao liberadas: depois da rajada, uma requisicao normal entra.
    const depois = await mcp.call("read_page", { url: lento(50, 99), maxChars: 500, timeoutMs: 10000 });
    assert.equal(depois.isError, false, `a vaga deveria ter sido liberada: ${depois.text}`);
  } finally {
    mcp.close();
  }
});

test("orcamento de memoria por bytes reserva e devolve depois de ler", { timeout: 60000 }, async () => {
  // Orcamento no piso (4 MB, o minimo aceito) com pagina de 40 KB: a reserva
  // aparece no /health e, ao terminar, tem de voltar a zero — senao vaza vaga
  // e o servidor trava depois de N downloads.
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    OUTBOUND_MEMORY_BUDGET: String(1024 * 1024), // abaixo do piso: vira 4 MB
    MAX_WAIT_MS: "30000",
  });
  try {
    const r = await mcp.call("read_page", { url: `${fixture.url}/page/mem?kb=40`, maxChars: 500, timeoutMs: 15000 });
    assert.equal(r.isError, false, r.text);

    const texto = await (await fetch(`${mcp.base}/health`)).text();
    assert.match(texto, /memoria de download: \d+ MB de 4 MB/, texto);
    const m = texto.match(/memoria de download: (\d+) MB de 4 MB/);
    assert.equal(Number(m[1]), 0, `o orcamento deveria voltar a zero: ${texto}`);

    // E o orcamento nao vazou: mais 5 leituras seguidas continuam funcionando.
    for (let i = 0; i < 5; i++) {
      const proxima = await mcp.call("read_page", {
        url: `${fixture.url}/page/mem${i}?kb=40`,
        maxChars: 300,
        timeoutMs: 15000,
      });
      assert.equal(proxima.isError, false, `leitura ${i + 1} falhou: ${proxima.text}`);
    }
    const depois = await (await fetch(`${mcp.base}/health`)).text();
    const md = depois.match(/memoria de download: (\d+) MB de 4 MB/);
    assert.equal(Number(md[1]), 0, `vazou orcamento: ${depois}`);
  } finally {
    mcp.close();
  }
});

test("sob saturacao a admissao responde 503 explicito (nao trava)", { timeout: 60000 }, async () => {
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    MAX_INFLIGHT_REQUESTS: "1",
    MAX_WAITING_REQUESTS: "0", // sem fila
    MAX_WAIT_MS: "30000",
  });
  try {
    const envios = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        mcp.raw({
          jsonrpc: "2.0",
          id: i,
          method: "tools/call",
          params: { name: "read_page", arguments: { url: lento(400, i), maxChars: 300, timeoutMs: 20000 } },
        })
      )
    );
    const status = envios.map((e) => e.status);
    assert.ok(status.includes(200), `pelo menos uma deveria passar: ${status.join(",")}`);
    assert.ok(status.includes(503), `as excedentes deveriam receber 503: ${status.join(",")}`);
    const recusada = envios.find((e) => e.status === 503);
    assert.equal(recusada.json.error.code, -32002);
    assert.match(recusada.json.error.message, /Servidor ocupado/);
  } finally {
    mcp.close();
  }
});

test("/health nunca e enfileirado nem recusado", { timeout: 60000 }, async () => {
  // Com admissao zerada, o /health tem de continuar respondendo 200: se ele
  // fosse enfileirado, o health check do Render derrubaria o servico sob carga.
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    MAX_INFLIGHT_REQUESTS: "1",
    MAX_WAITING_REQUESTS: "0",
    MAX_WAIT_MS: "30000",
  });
  try {
    // ocupa a unica vaga
    const ocupado = mcp.call("read_page", { url: lento(600, 1), maxChars: 200, timeoutMs: 20000 });
    await new Promise((r) => setTimeout(r, 100));
    const health = await fetch(`${mcp.base}/health`);
    assert.equal(health.status, 200, "o /health nao pode ser recusado");
    const texto = await health.text();
    assert.match(texto, /requisicoes: 1 ativas/);
    assert.match(texto, /admissao|requisicoes/);
    await ocupado;
  } finally {
    mcp.close();
  }
});

test("o /health informa fila, recusas e memoria", { timeout: 60000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const texto = await (await fetch(`${mcp.base}/health`)).text();
    assert.match(texto, /web-reader-mcp v[\d.]+ OK/);
    assert.match(texto, /cache: \d+ entradas/);
    assert.match(texto, /requisicoes: \d+ ativas, \d+ na fila \(max \d+\/\d+, recusadas \d+\)/);
    assert.match(texto, /downloads: \d+ ativos, \d+ na fila \(max \d+\/\d+, recusados \d+\)/);
    assert.match(texto, /memoria de download: \d+ MB de \d+ MB/);
    assert.match(texto, /conexoes: \d+/);
    assert.match(texto, /rss: \d+ MB/);
  } finally {
    mcp.close();
  }
});

/* ----------- desistencias da fila nao deixam fantasma ----------- */

test("quem desiste da espera sai da contagem da fila (e o liberar nao quebra)", { timeout: 60000 }, async () => {
  const lim = criarLimitador({ limite: 1, filaMax: 10, nome: "teste", esperaMaxMs: 40 });
  await lim.adquirir(); // ocupa a unica vaga
  const desistiu = lim.adquirir().then(
    () => null,
    (err) => err
  );
  assert.equal(lim.stats.naFila, 1, "o pedido deveria estar esperando");
  const err = await desistiu;
  assert.equal(err && err.name, "ServidorOcupadoError", `deveria desistir com erro claro: ${err}`);
  assert.equal(lim.stats.naFila, 0, "a desistencia tem de sair da contagem da fila");
  lim.liberar(); // antes quebrava aqui: o buraco deixado pela desistencia nao era pulado
  await lim.adquirir(); // a vaga liberada tem de ser reaproveitada
  lim.liberar();
});

test("desistencias da fila nao derrubam o servidor nem travam a admissao", { timeout: 60000 }, async () => {
  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    MAX_INFLIGHT_REQUESTS: "1",
    MAX_WAITING_REQUESTS: "8",
    MAX_WAIT_MS: "250",
  });
  try {
    // ocupa a unica vaga com uma leitura que demora
    const ocupado = mcp
      .call("read_page", { url: lento(1200, 1), maxChars: 200, timeoutMs: 20000 })
      .catch(() => null);
    await sleep(200);

    // rajada: as 3 esperam a vaga e desistem no teto de espera (250 ms)
    const rajada = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        mcp.raw({
          jsonrpc: "2.0",
          id: i,
          method: "tools/call",
          params: { name: "read_page", arguments: { url: lento(50, 10 + i), maxChars: 200, timeoutMs: 20000 } },
        })
      )
    );
    assert.ok(
      rajada.every((r) => r.status === 503),
      `as 3 deveriam ser recusadas apos a espera: ${rajada.map((r) => r.status).join(",")}`
    );

    // quando a vaga e liberada, o servidor tem de continuar no ar e com a fila zerada
    await ocupado;
    await sleep(300);
    const health = await fetch(`${mcp.base}/health`)
      .then(async (r) => ({ status: r.status, texto: await r.text() }))
      .catch((err) => ({ status: 0, texto: err.message }));
    assert.equal(health.status, 200, `o servidor deveria seguir no ar: ${health.texto}`);
    const naFila = Number((health.texto.match(/requisicoes: \d+ ativas, (\d+) na fila/) || [])[1]);
    assert.equal(naFila, 0, `a fila deveria ter esvaziado: ${health.texto}`);

    const depois = await mcp.call("read_page", { url: lento(30, 99), maxChars: 200, timeoutMs: 10000 });
    assert.equal(depois.isError, false, `a admissao deveria voltar a atender: ${depois.text}`);
  } finally {
    mcp.close();
  }
});
