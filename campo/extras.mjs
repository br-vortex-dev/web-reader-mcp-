// campo/extras.mjs - chamadas extras da bateria de campo (somente teste).
// Fecha lacunas deixadas pela bateria principal:
//   - PDF com URL viva (a original caiu: africau.edu devolveu 404)
//   - endpoint JSON via read_dynamic_page (a original so testou read_page)
//   - cache A/B com URL fresca (na bateria principal a URL ja estava em
//     cache por ter sido usada no read_multiple_pages -> leituras
//     "primeira" e "segunda" eram ambas cache hit, teste invalido)
//   - tabela complexa com colspan/rowspan (Copa do Mundo FIFA) e
//     tabela periodica com maxChars bem maior (além da grade-em-imagem)
//   - site BR legado em ISO-8859-1 de verdade (BCB virou SPA: 0 chars)
// NAO altera o produto. Saidas brutas em campo/raw/ (numeracao 64+).
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORTA = 8899;
const TOKEN = "token-local-de-campo";
const BASE = `http://127.0.0.1:${PORTA}`;
const PAUSA_MS = 2500;

const CASOS = [
  ["F", "pdf-w3c-vivo", "read_page", { url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", maxChars: 1000 }, "PDF publico real (SUBSTITUI o africau.edu que morreu: 404)"],
  ["F", "json-dynamic", "read_dynamic_page", { url: "https://jsonplaceholder.typicode.com/posts/1", maxChars: 1000 }, "endpoint JSON publico via read_dynamic_page"],
  ["I", "cache-fresco-1a", "read_page", { url: "https://example.com/?campo-fit=cache-1", maxChars: 300 }, "uso repetido: 1a chamada, URL fresca (nunca lida)"],
  ["I", "cache-fresco-2a", "read_page", { url: "https://example.com/?campo-fit=cache-1", maxChars: 300 }, "uso repetido: 2a chamada, mesma URL (cache)"],
  ["D", "fifa-tabela", "read_page", { url: "https://pt.wikipedia.org/wiki/Copa_do_Mundo_FIFA", maxChars: 30000 }, "tabela grande com colspan/rowspan (resultados por edicao)"],
  ["D", "tabela-periodica-60k", "read_page", { url: "https://pt.wikipedia.org/wiki/Tabela_peri%C3%B3dica", maxChars: 60000 }, "tabela periodica com maxChars 60k: tabelas de dados depois da grade-em-imagem"],
  ["E", "ipea-iso88591", "read_page", { url: "http://www.ipea.gov.br/portal/", maxChars: 4000 }, "site BR legado em ISO-8859-1 (content-type confirmado por curl)"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();

async function esperarServidor(url, tempoMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < tempoMs) {
    try {
      const r = await fetch(url + "/health", { signal: AbortSignal.timeout(3000) });
      if (r.ok) return await r.text();
    } catch { /* ainda nao */ }
    await sleep(400);
  }
  throw new Error("servidor nao subiu em " + tempoMs + "ms");
}

async function main() {
  await mkdir(path.join(RAIZ, "campo", "raw"), { recursive: true });
  const { ALLOW_PRIVATE_HOSTS: _descarta, ...envLimpo } = process.env; // garantia: nunca ativa
  const filho = spawn(process.execPath, [path.join(RAIZ, "server.js")], {
    env: { ...envLimpo, PORT: String(PORTA), MCP_AUTH_TOKEN: TOKEN, RATE_LIMIT_MAX: "1000000", TRUST_PROXY_HOPS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await esperarServidor(BASE);
  console.log("servidor no ar para as chamadas extras.\n");

  const resultados = [];
  const base = 63; // numeracao continua a bateria principal
  for (let i = 0; i < CASOS.length; i++) {
    const [cat, nome, tool, args, nota] = CASOS[i];
    if (i > 0) await sleep(PAUSA_MS);
    const num = base + i + 1;
    const t0 = Date.now();
    let status = 0, json = null, erroDriver = "";
    try {
      const res = await fetch(BASE + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: num, method: "tools/call", params: { name: tool, arguments: args } }),
        signal: AbortSignal.timeout(150000),
      });
      status = res.status;
      json = await res.json().catch(() => null);
    } catch (e) { erroDriver = e.message; }
    const ms = Date.now() - t0;

    const result = json?.result || {};
    const texto = result.content?.[0]?.text || "";
    const isError = result.isError === true;
    const mojibake = /Ã.|Â[^\s]|â€|Ã‚/.test(texto);
    const cjk = /[\u3040-\u30ff\u4e00-\u9fff]/.test(texto);
    const rtl = /[\u0590-\u05FF\u0600-\u06FF]/.test(texto);
    const tabelas = (texto.match(/\| --- \|/g) || []).length;
    const cercas = (texto.match(/```/g) || []).length;
    const truncado = /\[\.\.\. conteudo truncado/.test(texto);
    const links = (texto.match(/https?:\/\//g) || []).length;

    const arq = `${String(num).padStart(2, "0")}-${slug(cat + "-" + nome)}.md`;
    await writeFile(
      path.join(RAIZ, "campo", "raw", arq),
      [
        `# caso ${num}: [${cat}] ${nome}`,
        `ferramenta: ${tool}`,
        `argumentos: ${JSON.stringify(args)}`,
        `nota do teste: ${nota}`,
        `status HTTP: ${status} | tempo: ${ms} ms | isError: ${isError}`,
        `sinais: chars=${texto.length} tabelas=${tabelas} cercas=${cercas} truncado=${truncado} mojibake=${mojibake} cjk=${cjk} rtl=${rtl} links=${links}`,
        "",
        "## resposta crua (JSON-RPC)",
        "```json",
        JSON.stringify(json ?? { erroDriver }, null, 2).slice(0, 20000),
        "```",
        "",
        "## texto extraido",
        "```",
        texto.slice(0, 12000),
        "```",
      ].join("\n"),
    );

    resultados.push({ i: num, cat, nome, tool, url: args.url, nota, status, ms, isError, erroDriver, chars: texto.length, tabelas, cercas, truncado, mojibake, cjk, rtl, links, arquivo: "raw/" + arq });
    const sinal = isError ? "ERRO " : "ok   ";
    console.log(`${sinal} ${String(num).padStart(2)} [${cat}] ${nome.padEnd(24)} ${String(ms).padStart(6)} ms  ${String(texto.length).padStart(6)} chars${truncado ? " TRUNC" : ""}${mojibake ? " MOJIBAKE" : ""}`);
  }

  await writeFile(path.join(RAIZ, "campo", "extras.json"), JSON.stringify({ casos: resultados }, null, 2));
  filho.kill();
  await sleep(300);
  filho.kill("SIGKILL");
  console.log("\nextras concluidos. saidas em campo/raw/ (64+), metricas em campo/extras.json");
}

main().catch((e) => { console.error("extras falhou:", e); process.exit(1); });
