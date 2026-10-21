#!/usr/bin/env node
/**
 * _diag-feed-etapas.mjs — onde vão os segundos do read_feed.
 *
 * O read_feed foi o maior outlier da bateria (20.446 ms). O parser de XML
 * custa 7,5 ms, então o tempo não é CPU. Sobram três suspeitos:
 *   1. o alvo em si (hnrss.org é notoriamente lento e instável);
 *   2. o robots.txt, buscado na PRIMEIRA leitura de cada host;
 *   3. retry do transporte, que paga o primeiro erro + espera + nova tentativa.
 *
 * Cada etapa é cronometrada. Rodar com `--robots-off` isola o item 2.
 *
 * Uso: node dev/_diag-feed-etapas.mjs [voltas] [--robots-off]
 */
process.env.ROBOTS_RESPECT = process.argv.includes("--robots-off") ? "0" : process.env.ROBOTS_RESPECT || "1";

const VOLTAS = Math.max(1, Number(process.argv[2] || 4));

const { fetchTextCached } = await import("../src/fetch.mjs");
const { analisarFeed } = await import("../src/feeds.mjs");

const URL_FEED = "https://hnrss.org/frontpage";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function redeCrua(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(120000) });
    const txt = await res.text();
    return { ms: performance.now() - t0, status: res.status, bytes: txt.length };
  } catch (e) {
    return { ms: performance.now() - t0, erro: e.message };
  }
}

console.log(`robots: ${process.env.ROBOTS_RESPECT === "0" ? "DESLIGADO" : "ligado"} | ${VOLTAS} voltas\n`);

for (let v = 1; v <= VOLTAS; v++) {
  // Intercala cru e pipeline para o mesmo ruído de rede afetar os dois.
  const cru = await redeCrua(URL_FEED);

  const t0 = performance.now();
  let info = "";
  try {
    const payload = await fetchTextCached(URL_FEED, { timeoutMs: 60000 });
    const tRede = performance.now() - t0;
    const t1 = performance.now();
    const feed = analisarFeed(payload.text);
    info =
      `rede+robots ${tRede.toFixed(0)} ms | parser ${(performance.now() - t1).toFixed(1)} ms | ` +
      `${feed?.itens?.length ?? 0} itens | cortado=${payload.cortado}`;
  } catch (e) {
    info = `ERRO: ${e.message}`;
  }
  const tPipeline = performance.now() - t0;

  console.log(
    `volta ${v} | cru ${cru.ms.toFixed(0)} ms (${cru.status ?? "-"}, ${cru.bytes ?? "-"} bytes) | ` +
      `pipeline ${tPipeline.toFixed(0)} ms | ${info}`
  );
}

// Segunda leitura imediata: cache quente deve ser ~0.
const t2 = performance.now();
await fetchTextCached(URL_FEED, { timeoutMs: 60000 });
console.log(`\ncache quente: ${(performance.now() - t2).toFixed(0)} ms`);
