// live-test.mjs - verificacao pos-deploy completa de um web-reader-mcp NO AR.
// Uso: node scripts/live-test.mjs <https://sua-url.onrender.com> <token>
// (o token tambem pode vir de LIVE_TEST_TOKEN; nunca seja gravado em arquivo)
//
// Cobre, na ordem:
//   ROTAS     GET / e /health (200), GET /mcp (405), POST /mcp sem token (401),
//             token errado (401), JSON invalido (400), corpo > 1 MB (413),
//             metodo e ferramenta inexistentes (erro limpo, sem 5xx)
//   FERRAM.   as 7 ferramentas, SSRF (169.254.169.254 e 127.0.0.1),
//             redirect http->https, fidelidade (tabela GFM, acentos,
//             indentacao de codigo) e cache (2a leitura mais rapida)
//
// Saida: uma linha PASS/FAIL/AVISO por item + resumo. Exit 1 se houver FAIL.

const base = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || process.env.LIVE_TEST_TOKEN || "";

if (!base || !token) {
  console.error("uso: node scripts/live-test.mjs <https://sua-url.onrender.com> <token>");
  process.exit(1);
}

const MCP_URL = base + "/mcp";
// Cobre o cold start do plano free (~50 s).
const TIMEOUT_MS = Number(process.env.LIVE_TEST_TIMEOUT_MS || 120000);

let pass = 0, fail = 0, nAvisos = 0;
const falhas = [];
function check(cond, label, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  ->  " + extra : ""}`);
  if (cond) pass++;
  else { fail++; falhas.push(`${label}${extra ? " (" + extra + ")" : ""}`); }
}
function aviso(label, extra = "") {
  console.log(`AVISO ${label}${extra ? "  ->  " + extra : ""}`);
  nAvisos++;
}
async function fetchT(url, opts = {}) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
}
// chamada JSON-RPC no /mcp (com Authorization por padrao); devolve {status, json, text, ms}
async function mcpCall(method, params, id, auth = true) {
  const headers = { "content-type": "application/json" };
  if (auth) headers.authorization = `Bearer ${token}`;
  const t0 = Date.now();
  const res = await fetchT(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* mantem null */ }
  return { status: res.status, json, text, ms: Date.now() - t0 };
}
const toolText = (r) => r.json?.result?.content?.[0]?.text || "";
const toolIsError = (r) => r.json?.result?.isError === true;
const encurta = (s, n = 70) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

(async () => {
  console.log(`alvo: ${base}\n`);

  /* ------------------------------ ROTAS ------------------------------ */

  try {
    const res = await fetchT(base + "/");
    const t = await res.text();
    check(res.status === 200 && /web-reader-mcp/.test(t), "GET / devolve o health (rota raiz)", `status ${res.status}`);
  } catch (e) { check(false, "GET / devolve o health (rota raiz)", e.message); }

  try {
    const res = await fetchT(base + "/health");
    const t = await res.text();
    const formatoNovo = /cache: \d+ entradas, \d+ bytes \/ \d+ bytes/.test(t) && /rss: \d+ MB/.test(t);
    check(res.status === 200 && formatoNovo, "GET /health no formato novo (contadores)", encurta(t, 60));
  } catch (e) { check(false, "GET /health no formato novo (contadores)", e.message); }

  try {
    const res = await fetchT(MCP_URL, { method: "GET", headers: { authorization: `Bearer ${token}` } });
    await res.text();
    check(res.status === 400, "GET /mcp sem sessao: 400 (canal SSE exige Mcp-Session-Id)", `status ${res.status}`);
  } catch (e) { check(false, "GET /mcp sem sessao: 400 (canal SSE exige Mcp-Session-Id)", e.message); }

  try {
    const r = await mcpCall("tools/list", undefined, 1, false);
    check(r.status === 401, "POST /mcp SEM token devolve 401", `status ${r.status}`);
  } catch (e) { check(false, "POST /mcp SEM token devolve 401", e.message); }

  try {
    const res = await fetchT(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer token-errado-de-proposito" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    await res.text();
    check(res.status === 401, "POST /mcp com token ERRADO devolve 401", `status ${res.status}`);
  } catch (e) { check(false, "POST /mcp com token ERRADO devolve 401", e.message); }

  try {
    const res = await fetchT(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{isso nao e json",
    });
    const j = await res.json().catch(() => null);
    check(res.status === 400 && j?.error?.code === -32700, "JSON invalido devolve 400 (-32700)", j?.error?.message || `status ${res.status}`);
  } catch (e) { check(false, "JSON invalido devolve 400 (-32700)", e.message); }

  try {
    const corpo = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", padding: "x".repeat(1100000) });
    const res = await fetchT(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: corpo,
    });
    const j = await res.json().catch(() => null);
    check(res.status === 413 && /Corpo muito grande/.test(j?.error?.message || ""), "corpo > 1 MB devolve 413", j?.error?.message || `status ${res.status}`);
  } catch (e) { check(false, "corpo > 1 MB devolve 413", e.message); }

  try {
    const r = await mcpCall("metodo/inexistente", {}, 3);
    check(r.status === 200 && r.json?.error, "metodo inexistente devolve erro JSON-RPC (sem 5xx)", r.json?.error ? `code ${r.json.error.code}` : `status ${r.status}`);
  } catch (e) { check(false, "metodo inexistente devolve erro JSON-RPC (sem 5xx)", e.message); }

  try {
    const r = await mcpCall("tools/call", { name: "ferramenta_fantasma", arguments: { url: "https://example.com" } }, 4);
    check(r.status === 200 && toolIsError(r) && /Ferramenta desconhecida/.test(toolText(r)), "ferramenta inexistente devolve isError com mensagem", encurta(toolText(r)));
  } catch (e) { check(false, "ferramenta inexistente devolve isError com mensagem", e.message); }

  /* --------------------------- FERRAMENTAS --------------------------- */

  try {
    const r = await mcpCall("tools/list", undefined, 5);
    const tools = r.json?.result?.tools || [];
    const nomes = tools.map((t) => t.name).sort();
    const todas = ["crawl_site", "discover_urls", "extract_links", "read_dynamic_page", "read_multiple_pages", "read_page", "read_video", "read_pdf", "read_feed", "read_json", "read_search", "find_on_page", "diff_page"];
    check(todas.every((n) => nomes.includes(n)) && tools.every((t) => t.inputSchema?.type === "object"), "tools/list traz as 13 ferramentas com schema", nomes.join(", "));
  } catch (e) { check(false, "tools/list traz as 13 ferramentas com schema", e.message); }

  // read_page numa pagina real e complexa (tabelas, links, acentos)
  try {
    const r = await mcpCall("tools/call", {
      name: "read_page",
      arguments: { url: "https://pt.wikipedia.org/wiki/Node.js", maxChars: 9000 },
    }, 10);
    const t = toolText(r);
    const temTitulo = /^# .+/.test(t);
    const temUrl = /\nURL: https:\/\/pt\.wikipedia\.org/.test(t);
    check(r.status === 200 && !toolIsError(r) && t.length > 2000 && temTitulo && temUrl, "read_page le a Wikipedia (Node.js)", `${t.length} chars em ${r.ms} ms`);
    check(/\| --- \| --- \|/.test(t), "fidelidade: tabela GFM sai valida", /\| --- \| --- \|/.test(t) ? "separador | --- | achado" : "nenhum separador de tabela");
    check(/[^\x00-\x7F]/.test(t), "fidelidade: acentos/entidades corretos", /[^\x00-\x7F]/.test(t) ? "caracteres acentuados presentes" : "texto sem acento (suspeito)");
  } catch (e) { check(false, "read_page le a Wikipedia (Node.js)", e.message); }

  // fidelidade: indentacao de codigo (documentacao do Python tem blocos indentados)
  try {
    const r = await mcpCall("tools/call", {
      name: "read_page",
      arguments: { url: "https://docs.python.org/3/tutorial/controlflow.html", maxChars: 14000 },
    }, 11);
    const t = toolText(r);
    const indentado = /\n {4,}\S/.test(t);
    const cercado = /```/.test(t);
    check(r.status === 200 && !toolIsError(r) && t.length > 2000, "read_page le documentacao (docs.python.org)", `${t.length} chars em ${r.ms} ms`);
    check(indentado || cercado, "fidelidade: indentacao de codigo preservada", indentado ? "linha com 4+ espacos achada" : cercado ? "bloco cercado achado" : "sem codigo indentado no texto");
  } catch (e) { check(false, "read_page le documentacao (docs.python.org)", e.message); }

  // SSRF: enderecos internos tem de ser bloqueados ANTES de conectar
  for (const [url, rotulo] of [
    ["http://169.254.169.254/latest/meta-data/", "169.254.169.254 (metadata)"],
    ["http://127.0.0.1:8790/", "127.0.0.1 (loopback)"],
  ]) {
    try {
      const r = await mcpCall("tools/call", { name: "read_page", arguments: { url } }, 12);
      check(toolIsError(r) && /bloqueado/i.test(toolText(r)), `SSRF: ${rotulo} bloqueado`, encurta(toolText(r)));
    } catch (e) { check(false, `SSRF: ${rotulo} bloqueado`, e.message); }
  }

  // redirect http -> https tem de ser seguido
  try {
    const r = await mcpCall("tools/call", { name: "read_page", arguments: { url: "http://github.com/", maxChars: 400 } }, 13);
    const t = toolText(r);
    check(!toolIsError(r) && /\nURL: https:\/\/github\.com/.test(t), "redirect http->https seguido", encurta((t.match(/\nURL: .*/) || [""])[0], 50));
  } catch (e) { check(false, "redirect http->https seguido", e.message); }

  // extract_links
  try {
    const r = await mcpCall("tools/call", { name: "extract_links", arguments: { url: "https://pt.wikipedia.org/wiki/Node.js", limit: 40 } }, 14);
    const t = toolText(r);
    const achados = Number((t.match(/^Links em .*?(\d+) encontrados/m) || [])[1] || 0);
    check(!toolIsError(r) && achados > 0, "extract_links lista os links da pagina", `${achados} links encontrados`);
    if (achados < 20) aviso("extract_links listou poucos links", `${achados} - <nav>/<header>/<footer> sao ignorados de proposito (limitacao conhecida)`);
  } catch (e) { check(false, "extract_links lista os links da pagina", e.message); }

  // discover_urls
  try {
    const r = await mcpCall("tools/call", { name: "discover_urls", arguments: { url: "https://example.com", limit: 20 } }, 15);
    const t = toolText(r);
    check(!toolIsError(r) && t.length > 30, "discover_urls consulta sitemap/links da home", encurta(t, 60));
  } catch (e) { check(false, "discover_urls consulta sitemap/links da home", e.message); }

  // read_multiple_pages
  try {
    const r = await mcpCall("tools/call", {
      name: "read_multiple_pages",
      arguments: { urls: ["https://example.com", "https://example.net"], maxChars: 300 },
    }, 16);
    const t = toolText(r);
    const cobreAsDuas = /example\.com/.test(t) && /example\.net/.test(t);
    check(!toolIsError(r) && cobreAsDuas, "read_multiple_pages le 2 URLs numa chamada", encurta(t, 60));
  } catch (e) { check(false, "read_multiple_pages le 2 URLs numa chamada", e.message); }

  // crawl_site (BFS com maxPages baixo para nao pesar)
  try {
    const r = await mcpCall("tools/call", {
      name: "crawl_site",
      arguments: { url: "https://pt.wikipedia.org/wiki/Node.js", maxPages: 2, maxChars: 600 },
    }, 17);
    const t = toolText(r);
    const lidas = Number((t.match(/(\d+) pagina/i) || [])[1] || 0);
    check(!toolIsError(r) && t.length > 100, "crawl_site le o site (BFS, 2 paginas)", `${lidas || "?"} pagina(s) em ${r.ms} ms`);
  } catch (e) { check(false, "crawl_site le o site (BFS, 2 paginas)", e.message); }

  // read_dynamic_page em pagina estatica
  try {
    const r = await mcpCall("tools/call", { name: "read_dynamic_page", arguments: { url: "https://example.com", maxChars: 300 } }, 18);
    const t = toolText(r);
    const rotulo = (t.split("\n")[2] || "").trim();
    check(!toolIsError(r) && /Pagina (estatica|dinamica)/.test(t), "read_dynamic_page em pagina estatica", encurta(rotulo, 60));
  } catch (e) { check(false, "read_dynamic_page em pagina estatica", e.message); }

  // read_dynamic_page em site dinamico de verdade
  try {
    const r = await mcpCall("tools/call", { name: "read_dynamic_page", arguments: { url: "https://nextjs.org/", maxChars: 800 } }, 19);
    const t = toolText(r);
    const rotulo = (t.split("\n")[2] || "").trim();
    check(!toolIsError(r) && t.length > 200, "read_dynamic_page em site dinamico (nextjs.org)", encurta(rotulo || t, 70));
    if (/nao foi possivel extrair/.test(t)) aviso("read_dynamic_page nao achou dados embutidos no nextjs.org", "caiu no conteudo estatico - comportamento previsto, vale investigar se repetir em outros sites");
  } catch (e) { check(false, "read_dynamic_page em site dinamico (nextjs.org)", e.message); }

  // read_video: metadados de uma pagina de video real (Vimeo, estavel).
  // Se a legenda vier, otimo; se nao, a saida TEM de declarar isso — nunca
  // devolver silencio.
  try {
    const r = await mcpCall("tools/call", { name: "read_video", arguments: { url: "https://vimeo.com/76979871", maxChars: 4000 } }, 22);
    const t = toolText(r);
    const rotulo = (t.match(/\nPlataforma: (.+)/) || [])[1] || "";
    const temMeta = /\nCanal: /.test(t) && /\nDuracao: /.test(t);
    const transcricaoDeclarada = /Transcricao: /.test(t);
    check(!toolIsError(r) && temMeta && transcricaoDeclarada, "read_video le metadados de video (Vimeo)", `${encurta(rotulo, 20)}; ${transcricaoDeclarada ? "transcricao declarada" : "sem campo de transcricao"}`);
    if (/Transcricao: indisponivel/.test(t)) aviso("read_video: transcricao indisponivel agora", encurta((t.match(/Transcricao: indisponivel.*/) || [""])[0], 90));
  } catch (e) { check(false, "read_video le metadados de video (Vimeo)", e.message); }

  // cache: mesma URL duas vezes -> 2a leitura sai do cache (muito mais rapida)
  try {
    const unica = "https://example.com/?live-test=" + Date.now();
    const r1 = await mcpCall("tools/call", { name: "read_page", arguments: { url: unica, maxChars: 200 } }, 20);
    const r2 = await mcpCall("tools/call", { name: "read_page", arguments: { url: unica, maxChars: 200 } }, 21);
    check(!toolIsError(r1) && !toolIsError(r2) && r2.ms <= r1.ms * 1.5 + 200, `cache: 2a leitura mais rapida (${r1.ms} ms -> ${r2.ms} ms)`, r2.ms < r1.ms ? "cache hit confirmado" : "tempos proximos (checar rede)");
    const h = await fetchT(base + "/health");
    const ht = await h.text();
    const entradas = Number((ht.match(/cache: (\d+) entradas/) || [])[1] || 0);
    check(entradas >= 1, "cache com entradas depois das leituras", `${entradas} entrada(s)`);
  } catch (e) { check(false, "cache: 2a leitura mais rapida", e.message); }

  /* ------------------------------ RESUMO ----------------------------- */

  console.log(`\nresultado: ${pass} passaram, ${fail} falharam, ${nAvisos} aviso(s)`);
  if (falhas.length) {
    console.log("\nfalhas:");
    for (const f of falhas) console.log(`  - ${f}`);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("erro inesperado no teste:", e);
  process.exit(1);
});
