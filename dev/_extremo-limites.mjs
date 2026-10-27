#!/usr/bin/env node
/**
 * _extremo-limites.mjs — onde os tetos mordem, com prova do lado do servidor.
 *
 * Mede quatro coisas que a bateria normal nao mostra:
 *
 *   1. DOWNLOAD: uma pagina de 30 MB com maxChars 25000 tem de parar de baixar
 *      perto de 1,5 MB (teto proporcional), nao baixar os 30 MB;
 *   2. DOCUMENTO: extract_links precisa do documento inteiro, mas para no teto
 *      de 24 MB e AVISA — o servidor local registra quantos bytes tentou enviar;
 *   3. TEMPO: servidor que nunca responde e servidor que pinga devagar tem de
 *      terminar no timeout pedido, sem pendurar vaga;
 *   4. PICO: 500 leituras simultaneas de 1,4 MB no servidor MCP de verdade
 *      (admissao 128 + fila 4096), com /health amostrado durante a rajada.
 *
 * O teste de admissao roda com limites BAIXOS de proposito (8 ativos + 16 na
 * fila) para provar o caminho de recusa (503) sem precisar de 4.225 conexoes.
 *
 * ALLOW_PRIVATE_HOSTS=1 vale SO neste processo de desenvolvimento. NUNCA em
 * producao: o render.yaml nao define essa variavel e nao deve definir.
 *
 * Uso: node --expose-gc dev/_extremo-limites.mjs
 */
process.env.ALLOW_PRIVATE_HOSTS = "1";

const { spawn } = await import("node:child_process");
const { startMcp } = await import("../tests/helpers.mjs");
const { callTool } = await import("../src/tools.mjs");

const MB = 1024 * 1024;
const mib = (b) => (b / 1048576).toFixed(1);

async function iniciarServidorLocal() {
  const filho = spawn(process.execPath, ["dev/_extremo-servidor.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let saida = "";
  let erro = "";
  filho.stderr.on("data", (d) => {
    erro += d;
  });
  return new Promise((resolve, reject) => {
    const prazo = setTimeout(() => reject(new Error(`servidor local nao subiu: ${erro}`)), 10000);
    filho.stdout.on("data", (d) => {
      saida += d;
      const m = saida.match(/URL (http:\/\/127\.0\.0\.1:\d+)/);
      if (!m) return;
      clearTimeout(prazo);
      resolve({
        url: m[1],
        fechar: () =>
          new Promise((r) => {
            filho.once("exit", r);
            filho.kill("SIGTERM");
            setTimeout(() => {
              filho.kill("SIGKILL");
              r();
            }, 2000);
          }),
      });
    });
    filho.once("exit", (code) => reject(new Error(`servidor local saiu (${code}): ${erro || saida}`)));
  });
}

async function stats(base) {
  const res = await fetch(`${base}/__stats`);
  return res.json();
}

async function medir(fn) {
  if (global.gc) global.gc();
  const rss0 = process.memoryUsage().rss;
  let pico = rss0;
  const timer = setInterval(() => {
    const r = process.memoryUsage().rss;
    if (r > pico) pico = r;
  }, 10);
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  let saida = "";
  let err = null;
  try {
    saida = await fn();
  } catch (e) {
    err = e;
  }
  const parede = performance.now() - t0;
  const d = process.cpuUsage(c0);
  clearInterval(timer);
  pico = Math.max(pico, process.memoryUsage().rss);
  return { parede, cpu: (d.user + d.system) / 1000, rssPico: pico, saida, err };
}

function primeiraLinha(s) {
  return (s.split("\n")[0] || "").slice(0, 150);
}
function avisoDe(s) {
  return (s.split("\n").find((l) => /^(AVISO|Aviso|PRAZO|Erro)/.test(l)) || "").slice(0, 180);
}
function statusTeto(r) {
  return r.err ? `ERRO ${r.err.name}: ${r.err.message}` : primeiraLinha(r.saida);
}

console.log("==============================================================");
console.log("LIMITES LOCAIS — download, documento, timeout");
console.log("==============================================================");

const local = await iniciarServidorLocal();
const U = local.url;
const resultados = [];

async function caso(nome, id, fn) {
  const r = await medir(fn);
  const lista = await stats(U);
  const st = lista.find((s) => s.id === id);
  const bytes = st ? st.bytes : 0;
  console.log(
    `\n## ${nome}\n   parede ${r.parede.toFixed(0)} ms | cpu ${r.cpu.toFixed(0)} ms | rss pico ${mib(r.rssPico)} MB | ` +
      `saida ${r.saida.length} ch\n   servidor tentou enviar ${(bytes / MB).toFixed(2)} MB ` +
      `(completo=${st?.completo}, abortado=${st?.abortado})\n   ${statusTeto(r)}`
  );
  const aviso = avisoDe(r.saida);
  if (aviso) console.log(`   -> ${aviso}`);
  resultados.push({
    nome,
    id,
    paredeMs: Math.round(r.parede),
    cpuMs: Math.round(r.cpu),
    rssPicoMiB: Number(mib(r.rssPico)),
    saidaChars: r.saida.length,
    erro: r.err ? `${r.err.name}: ${r.err.message}` : "",
    servidorBytes: bytes,
    servidorCompleto: st?.completo || false,
    servidorAbortado: st?.abortado || false,
  });
  return r;
}

try {
  // 1. read_page com teto proporcional: NAO pode baixar 30 MB para entregar 25k.
  const rp25 = await caso("read_page, 30 MB, maxChars 25000", "rp25", () =>
    callTool("read_page", { url: `${U}/forte?mb=30&id=rp25`, maxChars: 25000, timeoutMs: 60000 })
  );
  const stRp25 = resultados.at(-1);
  // Prova dupla: o servidor PAROU de mandar perto do teto proporcional (1,5 MB)
  // e a saída marcou o corte no `Conteudo:` (com `+`). O limite superior leva
  // em conta o buffer do socket, que sempre aceita um pouco além do corte.
  const rp25Marcou = /Conteudo: \d+\+/.test(rp25.saida);
  console.log(
    `   veredito: ${
      stRp25.servidorBytes >= 1.4 * MB && stRp25.servidorBytes < 4 * MB && stRp25.servidorAbortado && rp25Marcou
        ? "PASSOU"
        : "FALHOU"
    } — ${(stRp25.servidorBytes / MB).toFixed(2)} MB tentados para 25.000 ch entregues ` +
      `(abortado=${stRp25.servidorAbortado}, Conteudo com "+"=${rp25Marcou})`
  );

  // 2. maxChars mínimo: o teto proporcional tem piso de 256 KB.
  await caso("read_page, 30 MB, maxChars 200", "rp200", () =>
    callTool("read_page", { url: `${U}/forte?mb=30&id=rp200`, maxChars: 200, timeoutMs: 60000 })
  );
  const stRp200 = resultados.at(-1);
  console.log(
    `   veredito: ${
      stRp200.servidorBytes >= 256 * 1024 && stRp200.servidorBytes < 1 * MB && stRp200.servidorAbortado
        ? "PASSOU"
        : "FALHOU"
    } — ${(stRp200.servidorBytes / MB).toFixed(2)} MB tentados para 200 ch entregues (piso de 256 KB)`
  );

  // 3. extract_links: precisa do documento inteiro, mas o teto de documento e 24 MB.
  const rLinks = await caso("extract_links, 30 MB (teto de documento 24 MB)", "links30", () =>
    callTool("extract_links", { url: `${U}/forte?mb=30&id=links30`, limit: 50, timeoutMs: 120000 })
  );
  const stLinks = resultados.at(-1);
  // A prova do corte e o AVISO na propria saida + o servidor tendo sido
  // abortado; os bytes "tentados" variam com o buffer do socket e sozinhos
  // nao provam nada (ficavam ate 6 MB acima antes do ritmo no /forte).
  const avisouCorte = /AVISO: documento maior que o teto/.test(rLinks.saida);
  console.log(
    `   veredito: ${
      avisouCorte && stLinks.servidorAbortado && stLinks.servidorBytes >= 23 * MB && stLinks.servidorBytes < 26 * MB
        ? "PASSOU"
        : "FALHOU"
    } — ${(stLinks.servidorBytes / MB).toFixed(2)} MB tentados (teto 24 MB), ` +
      `AVISO na saida=${avisouCorte}, abortado=${stLinks.servidorAbortado}`
  );

  // 4. timeout: servidor que nunca responde.
  const tNunca = await caso("read_page, servidor que nunca responde (timeout 1000 ms)", "nunca", () =>
    callTool("read_page", { url: `${U}/nunca?id=nunca`, maxChars: 500, timeoutMs: 1000 })
  );
  console.log(
    `   veredito: ${tNunca.err && tNunca.parede < 6000 ? "PASSOU" : "FALHOU"} — ` +
      `${tNunca.err?.name || "SEM ERRO"} em ${tNunca.parede.toFixed(0)} ms`
  );

  // 5. timeout no MEIO do corpo: o servidor respondeu e depois pinga devagar.
  const tLenta = await caso("read_page, corpo lento (timeout 1000 ms)", "lenta", () =>
    callTool("read_page", { url: `${U}/lenta?id=lenta`, maxChars: 500, timeoutMs: 1000 })
  );
  console.log(
    `   veredito: ${tLenta.err && tLenta.parede < 6000 ? "PASSOU" : "FALHOU"} — ` +
      `${tLenta.err?.name || "SEM ERRO"} em ${tLenta.parede.toFixed(0)} ms`
  );

  /* ================== PICO: servidor MCP de verdade ================== */
  console.log("\n==============================================================");
  console.log("PICO NO SERVIDOR MCP — 500 leituras de 1,4 MB ao mesmo tempo");
  console.log("==============================================================");

  const mcp = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    RATE_LIMIT_MAX: "1000000",
    MAX_INFLIGHT_REQUESTS: "128",
    MAX_WAITING_REQUESTS: "4096",
  });

  const saude = { rss: 0, ativos: 0, fila: 0, recusadas: 0, dlAtivos: 0, dlFila: 0, memPico: 0, conexoes: 0, ultimoHealth: "" };
  const amostrarSaude = async () => {
    try {
      const res = await fetch(`${mcp.base}/health`);
      const txt = await res.text();
      saude.ultimoHealth = txt;
      const n = (re) => {
        const m = txt.match(re);
        return m ? Number(m[1]) : 0;
      };
      saude.rss = Math.max(saude.rss, n(/rss: (\d+) MB/));
      saude.ativos = Math.max(saude.ativos, n(/requisicoes: (\d+) ativas/));
      saude.fila = Math.max(saude.fila, n(/requisicoes: \d+ ativas, (\d+) na fila/));
      saude.recusadas = Math.max(saude.recusadas, n(/requisicoes: .*?recusadas (\d+)\)/));
      saude.dlAtivos = Math.max(saude.dlAtivos, n(/downloads: (\d+) ativos/));
      saude.dlFila = Math.max(saude.dlFila, n(/downloads: \d+ ativos, (\d+) na fila/));
      saude.memPico = Math.max(saude.memPico, n(/memoria de download: .*?\(pico (\d+) MB/));
      saude.conexoes = Math.max(saude.conexoes, n(/conexoes: (\d+)/));
    } catch {
      // /health pode estar sob carga; a proxima amostra tenta de novo
    }
  };
  const timerSaude = setInterval(amostrarSaude, 100);

  const N = 500;
  const inicioRajada = performance.now();
  const chamadas = Array.from({ length: N }, (_, i) => {
    const t0 = performance.now();
    return mcp
      .raw({
        jsonrpc: "2.0",
        id: i + 1,
        method: "tools/call",
        params: {
          name: "read_page",
          arguments: { url: `${U}/pagina?i=A${i}`, maxChars: 25000, timeoutMs: 120000 },
        },
      })
      .then((r) => ({
        ok: r.status === 200 && r.json?.result && !r.json.result.isError,
        status: r.status,
        ms: performance.now() - t0,
        erro: r.json?.error?.message || (r.json?.result?.isError ? String(r.json.result.content?.[0]?.text).slice(0, 100) : ""),
      }))
      .catch((e) => ({ ok: false, status: 0, ms: performance.now() - t0, erro: e.message }));
  });
  const respostas = await Promise.all(chamadas);
  const paredeRajada = performance.now() - inicioRajada;
  await amostrarSaude();
  clearInterval(timerSaude);

  const ok = respostas.filter((r) => r.ok);
  const falhas = respostas.filter((r) => !r.ok);
  const tempos = ok.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q) => (tempos.length ? tempos[Math.min(tempos.length - 1, Math.floor(tempos.length * q))] : 0);
  console.log(
    `\n${ok.length}/${N} OK em ${(paredeRajada / 1000).toFixed(1)} s | latencia min ${tempos[0]?.toFixed(0)} ms ` +
      `p50 ${p(0.5).toFixed(0)} p95 ${p(0.95).toFixed(0)} max ${tempos.at(-1)?.toFixed(0)} ms`
  );
  console.log(
    `pico no servidor: rss ${saude.rss} MB | admissao ${saude.ativos} ativas / ${saude.fila} na fila / ` +
      `${saude.recusadas} recusadas | downloads ${saude.dlAtivos} ativos / ${saude.dlFila} na fila | ` +
      `memoria de download pico ${saude.memPico} MB | conexoes ${saude.conexoes}`
  );
  console.log(`health final: ${saude.ultimoHealth.split(" | ").filter((p) => /requisicoes|downloads|memoria|conexoes|rss/.test(p)).join(" | ")}`);
  if (falhas.length) {
    console.log(`falhas (${falhas.length}):`);
    for (const f of falhas.slice(0, 5)) console.log(`  - HTTP ${f.status}: ${f.erro}`);
  }
  resultados.push({
    nome: `pico ${N}x1,4MB`,
    paredeMs: Math.round(paredeRajada),
    ok: ok.length,
    falhas: falhas.length,
    p50Ms: Math.round(p(0.5)),
    p95Ms: Math.round(p(0.95)),
    maxMs: Math.round(tempos.at(-1) || 0),
    saude,
  });

  /* ============ recusa de admissao com limites reduzidos ============ */
  console.log("\n==============================================================");
  console.log("ADMISSAO — 40 pedidos com 8 vagas e fila de 16 (prova do 503)");
  console.log("==============================================================");
  const mcpLimite = await startMcp({
    ALLOW_PRIVATE_HOSTS: "1",
    RATE_LIMIT_MAX: "1000000",
    MAX_INFLIGHT_REQUESTS: "8",
    MAX_WAITING_REQUESTS: "16",
    MAX_WAIT_MS: "2000",
  });
  const pedidos = Array.from({ length: 40 }, (_, i) =>
    mcpLimite
      .raw({
        jsonrpc: "2.0",
        id: 1000 + i,
        method: "tools/call",
        params: {
          name: "read_page",
          arguments: { url: `${U}/mini?i=B${i}&ms=200`, maxChars: 300, timeoutMs: 10000 },
        },
      })
      .then((r) => ({ status: r.status, erro: r.json?.error?.message || "" }))
      .catch((e) => ({ status: 0, erro: e.message }))
  );
  const respostasLimite = await Promise.all(pedidos);
  const porStatus = new Map();
  for (const r of respostasLimite) porStatus.set(r.status, (porStatus.get(r.status) || 0) + 1);
  console.log([...porStatus.entries()].map(([s, n]) => `HTTP ${s}: ${n}`).join(" | "));
  const recusa = respostasLimite.find((r) => r.status === 503);
  if (recusa) console.log(`exemplo de recusa: ${recusa.erro}`);
  const saudeLimite = await (await fetch(`${mcpLimite.base}/health`)).text();
  console.log(`health: ${saudeLimite.split(" | ").filter((p) => /requisicoes|rss/.test(p)).join(" | ")}`);
  resultados.push({
    nome: "admissao reduzida (8/16)",
    porStatus: Object.fromEntries(porStatus),
    exemploRecusa: recusa?.erro || "",
  });

  mcpLimite.close();
  mcp.close();
} finally {
  await local.fechar();
}

const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync("dev/load", { recursive: true });
writeFileSync(
  "dev/load/extremo-limites.json",
  JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 2)
);
console.log("\ngravado: dev/load/extremo-limites.json");
