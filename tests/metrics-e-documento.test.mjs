// Regressões da rodada 20.
//
// Dois contratos que estavam quebrados ou ausentes e agora têm prova:
//
// 1. DOCUMENTO GRANDE EM multi/crawl. `read_multiple_pages` e `crawl_site`
//    usavam `fetchTextCached` (teto duro de 5 MB), então uma página de 8 MB
//    fazia a chamada inteira falhar ali enquanto o `read_page` lia a MESMA URL
//    normalmente. O teste serve uma página acima do teto duro e exige que o
//    multi a leia.
//
// 2. /metrics. O servidor só tinha /health, que mostra o estado agora (cache,
//    fila, memória) mas não a TAXA nem a LATÊNCIA. Aqui se prova que a rota
//    existe, que o formato é o de exposição do Prometheus e que ela é
//    realmente alimentada pelas requisições feitas.

import test from "node:test";
import assert from "node:assert/strict";
import { startFixture, startMcp, TOKEN } from "./helpers.mjs";

// 6000 KB passa do teto duro de 5 MB (MAX_RESPONSE_BYTES).
const GIGANTE = "/page/gigante?kb=6000";

test("read_multiple_pages lê página acima do teto duro (5 MB)", { timeout: 60000 }, async () => {
  const fixture = await startFixture();
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const r = await mcp.call("read_multiple_pages", {
      urls: [`${fixture.url}${GIGANTE}`],
      maxChars: 2000,
    });
    assert.equal(r.isError, false, `o multi falhou: ${r.text.slice(0, 300)}`);
    // Se tivesse caído no teto duro, apareceria "Resposta muito grande".
    assert.doesNotMatch(
      r.text,
      /Resposta muito grande acima de/,
      `o multi ainda está preso no teto duro: ${r.text.slice(0, 300)}`
    );
  } finally {
    mcp.close();
    await fixture.close();
  }
});

test("crawl_site lê a página inicial acima do teto duro (5 MB)", { timeout: 90000 }, async () => {
  const fixture = await startFixture();
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const r = await mcp.call("crawl_site", {
      url: `${fixture.url}${GIGANTE}`,
      maxPages: 2,
      maxChars: 2000,
    });
    assert.doesNotMatch(
      r.text,
      /Resposta muito grande acima de/,
      `o crawl ainda está preso no teto duro: ${r.text.slice(0, 300)}`
    );
    assert.match(r.text, /Crawl de/, `o crawl não devolveu o resumo: ${r.text.slice(0, 300)}`);
  } finally {
    mcp.close();
    await fixture.close();
  }
});

test("/metrics responde no formato de exposição do Prometheus", { timeout: 30000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    const res = await fetch(`${mcp.base}/metrics`);
    assert.equal(res.status, 200, "a rota existe e responde 200");

    const tipo = String(res.headers.get("content-type") || "");
    assert.match(tipo, /text\/plain/, `content-type inesperado: ${tipo}`);
    assert.match(tipo, /version=0\.0\.4/, "declara a versão do formato de exposição");

    const texto = await res.text();

    // Regras do formato: toda família tem HELP e TYPE; nenhuma linha solta.
    assert.match(texto, /# TYPE web_reader_up gauge/);
    assert.match(texto, /web_reader_up 1/);
    assert.match(texto, /# TYPE web_reader_requisicoes_total counter/);

    // O histograma tem de vir fechado: buckets, +Inf, sum e count.
    assert.match(texto, /web_reader_duracao_segundos_bucket\{le="\+Inf"\} \d+/);
    assert.match(texto, /web_reader_duracao_segundos_sum [\d.]+/);
    assert.match(texto, /web_reader_duracao_segundos_count \d+/);

    // Nenhuma linha em branco no meio (o Prometheus tolera, mas é sinal de
    // rótulo vazando para fora do bloco). A linha de HELP é texto livre depois
    // do nome da métrica — acento e pontuação são permitidos ali.
    for (const linha of texto.split("\n")) {
      if (!linha) continue;
      assert.match(
        linha,
        /^(# HELP \w+ .+|# TYPE \w+ (counter|gauge|histogram|summary|untyped)|[a-zA-Z_:][\w:]*(\{[^}]*\})? [-\d.e+]+)$/,
        `linha fora do formato: ${JSON.stringify(linha)}`
      );
    }
  } finally {
    mcp.close();
  }
});

test("/metrics é alimentado pelas requisições reais", { timeout: 30000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1" });
  try {
    // Uma requisição de /health conhecida, e uma chamada de ferramenta por /mcp.
    await fetch(`${mcp.base}/health`);
    await mcp.call("tools/list", {});

    const texto = await (await fetch(`${mcp.base}/metrics`)).text();

    const contagem = (rota, status) => {
      const m = texto.match(
        new RegExp(`web_reader_requisicoes_total\\{rota="${rota}",status="${status}"\\} (\\d+)`)
      );
      return m ? Number(m[1]) : 0;
    };

    assert.ok(contagem("/health", 200) >= 1, "o /health foi contado");
    assert.ok(contagem("/mcp", 200) >= 1, `o /mcp foi contado:\n${texto.slice(0, 800)}`);

    // A latência total tem de acompanhar a contagem: média coerente.
    const soma = Number((texto.match(/web_reader_duracao_segundos_sum ([\d.]+)/) || [])[1]);
    const total = Number((texto.match(/web_reader_duracao_segundos_count (\d+)/) || [])[1]);
    assert.ok(total >= 2, `deveria ter medido pelo menos 2 respostas (medido ${total})`);
    assert.ok(soma >= 0 && soma < total * 60, `soma de latência incoerente: ${soma}`);
  } finally {
    mcp.close();
  }
});

test("/metrics pode ser fechado com METRICS_PUBLIC=0", { timeout: 30000 }, async () => {
  const mcp = await startMcp({ ALLOW_PRIVATE_HOSTS: "1", METRICS_PUBLIC: "0" });
  try {
    const semToken = await fetch(`${mcp.base}/metrics`);
    assert.equal(semToken.status, 401, "sem token tem de recusar");

    const comToken = await fetch(`${mcp.base}/metrics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(comToken.status, 200, "com token tem de responder");

    // E o /health continua público nos dois modos (é o que orquestrador usa).
    assert.equal((await fetch(`${mcp.base}/health`)).status, 200);
  } finally {
    mcp.close();
  }
});
