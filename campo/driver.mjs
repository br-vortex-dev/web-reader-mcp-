// campo/driver.mjs - bateria de campo do web-reader-mcp (somente teste).
// Sobe o server.js local em modo HTTP e chama as ferramentas MCP por JSON-RPC,
// como uma IA faria. NAO altera o produto. Saidas brutas em campo/raw/.
//
// Desvio de config documentado: RATE_LIMIT_MAX=1000000 nesta instancia local,
// para que a propria bateria (+-65 chamadas) nao seja travada pelo limite de
// 60/min. O limite padrao e verificado a parte, numa segunda instancia, no
// teste de rate limit (categoria H). NENHUMA variavel de codigo e alterada.
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORTA = 8899;
const TOKEN = "token-local-de-campo";
const BASE = `http://127.0.0.1:${PORTA}`;

const PAUSA_MS = 1500;          // pausa entre chamadas (bom cidadao)
const PAUSA_MESMO_HOST_MS = 2500;

const CASOS = [
  // ---- A. documentacao tecnica e codigo ----
  ["A", "mdn-array-filter", "read_page", { url: "https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/filter", maxChars: 9000 }, "blocos de codigo + tabela de compatibilidade"],
  ["A", "python-classes", "read_page", { url: "https://docs.python.org/3/tutorial/classes.html", maxChars: 9000 }, "pagina longa com codigo indentado"],
  ["A", "github-readme-render", "read_page", { url: "https://github.com/br-vortex-dev/web-reader-mcp-", maxChars: 6000 }, "README renderizado no GitHub"],
  ["A", "github-readme-raw", "read_page", { url: "https://raw.githubusercontent.com/br-vortex-dev/web-reader-mcp-/main/README.md", maxChars: 6000 }, "mesmo README, versao raw"],
  ["A", "github-blob-package", "read_page", { url: "https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/package.json", maxChars: 3000 }, "pagina de arquivo de codigo no GitHub"],
  ["A", "github-raw-package", "read_page", { url: "https://raw.githubusercontent.com/br-vortex-dev/web-reader-mcp-/main/package.json", maxChars: 3000 }, "mesmo arquivo, versao raw"],
  ["A", "stackoverflow", "read_page", { url: "https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array", maxChars: 6000 }, "pergunta com resposta aceita e codigo"],
  ["A", "wiki-matematica", "read_page", { url: "https://pt.wikipedia.org/wiki/Equa%C3%A7%C3%A3o_quadr%C3%A1tica", maxChars: 6000 }, "artigo com formulas (LaTeX/MathML)"],
  ["A", "arxiv-abs", "read_page", { url: "https://arxiv.org/abs/1706.03762", maxChars: 4000 }, "abstract de paper"],

  // ---- B. paginas dinamicas e SPAs ----
  ["B", "nextjs-read-page", "read_page", { url: "https://nextjs.org/docs", maxChars: 5000 }, "site Next.js, leitura normal"],
  ["B", "nextjs-read-dynamic", "read_dynamic_page", { url: "https://nextjs.org/docs", maxChars: 5000 }, "mesma URL, extracao dinamica"],
  ["B", "react-read-page", "read_page", { url: "https://react.dev/learn", maxChars: 5000 }, "React docs, leitura normal"],
  ["B", "react-read-dynamic", "read_dynamic_page", { url: "https://react.dev/learn", maxChars: 5000 }, "mesma URL, extracao dinamica"],
  ["B", "vue-read-page", "read_page", { url: "https://vuejs.org/guide/introduction.html", maxChars: 5000 }, "Vue docs, leitura normal"],
  ["B", "vue-read-dynamic", "read_dynamic_page", { url: "https://vuejs.org/guide/introduction.html", maxChars: 5000 }, "mesma URL, extracao dinamica"],
  ["B", "npm-spa-read-page", "read_page", { url: "https://www.npmjs.com/package/express", maxChars: 4000 }, "SPA que carrega por API (__NEXT_DATA__)"],
  ["B", "npm-spa-read-dynamic", "read_dynamic_page", { url: "https://www.npmjs.com/package/express", maxChars: 4000 }, "mesma URL, extracao dinamica"],
  ["B", "hn-algolia", "read_page", { url: "https://hn.algolia.com/?query=javascript", maxChars: 3000 }, "listagem carregada por API"],
  ["B", "old-reddit", "read_page", { url: "https://old.reddit.com/r/programming/", maxChars: 3000 }, "lista com paginacao/comentarios"],

  // ---- C. noticias, blogs e ruido ----
  ["C", "uol-home", "read_page", { url: "https://www.uol.com.br/", maxChars: 5000 }, "portal BR com banners e anuncios"],
  ["C", "bbc-news", "read_page", { url: "https://www.bbc.com/news", maxChars: 5000 }, "portal internacional"],
  ["C", "wordpress-news", "read_page", { url: "https://wordpress.org/news/", maxChars: 4000 }, "blog WordPress oficial"],
  ["C", "folha-paywall", "read_page", { url: "https://www1.folha.uol.com.br/mercado/", maxChars: 4000 }, "paywall parcial"],

  // ---- D. tabelas e dados estruturados ----
  ["D", "wiki-japao", "read_page", { url: "https://pt.wikipedia.org/wiki/Jap%C3%A3o", maxChars: 9000 }, "infobox + tabelas + CJK"],
  ["D", "wiki-tabela-periodica", "read_page", { url: "https://pt.wikipedia.org/wiki/Tabela_peri%C3%B3dica", maxChars: 9000 }, "tabela grande e complexa"],
  ["D", "ibge-sao-paulo", "read_page", { url: "https://www.ibge.gov.br/cidades-e-estados/sp/sao-paulo.html", maxChars: 6000 }, "muitos numeros e tabelas"],

  // ---- E. idiomas, encodings e caracteres ----
  ["E", "bcb-antigo", "read_page", { url: "https://www.bcb.gov.br/", maxChars: 4000 }, "portal antigo, possivel ISO-8859-1"],
  ["E", "wiki-ja", "read_page", { url: "https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC", maxChars: 4000 }, "japones (CJK)"],
  ["E", "wiki-zh", "read_page", { url: "https://zh.wikipedia.org/wiki/Linux", maxChars: 4000 }, "chines (CJK)"],
  ["E", "wiki-ar", "read_page", { url: "https://ar.wikipedia.org/wiki/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA", maxChars: 4000 }, "arabe (RTL)"],
  ["E", "wiki-he", "read_page", { url: "https://he.wikipedia.org/wiki/%D7%9E%D7%AA%D7%9E%D7%98%D7%99%D7%A7%D7%94", maxChars: 4000 }, "hebraico (RTL)"],
  ["E", "emoji-unicode", "read_page", { url: "https://www.unicode.org/emoji/charts/full-emoji-list.html", maxChars: 6000 }, "emojis e simbolos"],

  // ---- F. formatos que nao sao HTML comum ----
  ["F", "sitemap-xml", "read_page", { url: "https://nodejs.org/sitemap.xml", maxChars: 3000 }, "sitemap.xml real"],
  ["F", "sitemap-index", "read_page", { url: "https://g1.globo.com/sitemap.xml", maxChars: 3000 }, "sitemap index"],
  ["F", "rss-frontpage", "read_page", { url: "https://hnrss.org/frontpage", maxChars: 4000 }, "feed Atom"],
  ["F", "json-placeholder", "read_page", { url: "https://jsonplaceholder.typicode.com/posts/1", maxChars: 1000 }, "endpoint JSON publico"],
  ["F", "pdf-amostra", "read_page", { url: "https://www.africau.edu/images/default/sample.pdf", maxChars: 1000 }, "PDF publico"],
  ["F", "robots-txt", "read_page", { url: "https://www.google.com/robots.txt", maxChars: 2000 }, "texto puro"],
  ["F", "imagem-png", "read_page", { url: "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png", maxChars: 500 }, "imagem PNG"],
  ["F", "wiki-gigante", "read_page", { url: "https://pt.wikipedia.org/wiki/Segunda_Guerra_Mundial", maxChars: 50000 }, "pagina muito grande -> truncamento"],

  // ---- G. rede, redirects e erros reais ----
  ["G", "redirect-3", "read_page", { url: "https://httpbin.org/redirect/3", maxChars: 800 }, "cadeia de 3 redirects"],
  ["G", "redirect-9", "read_page", { url: "https://httpbin.org/redirect/9", maxChars: 800 }, "9 saltos, limite eh 5"],
  ["G", "status-404", "read_page", { url: "https://httpbin.org/status/404", maxChars: 500 }, "404 real"],
  ["G", "status-403", "read_page", { url: "https://httpbin.org/status/403", maxChars: 500 }, "403 real"],
  ["G", "status-429", "read_page", { url: "https://httpbin.org/status/429", maxChars: 500 }, "429 real"],
  ["G", "status-500", "read_page", { url: "https://httpbin.org/status/500", maxChars: 500 }, "500 real"],
  ["G", "status-503", "read_page", { url: "https://httpbin.org/status/503", maxChars: 500 }, "503 real"],
  ["G", "delay-15", "read_page", { url: "https://httpbin.org/delay/15", maxChars: 800 }, "resposta lenta (15 s)"],
  ["G", "badssl-selfsigned", "read_page", { url: "https://self-signed.badssl.com/", maxChars: 500 }, "certificado invalido"],
  ["G", "badssl-expired", "read_page", { url: "https://expired.badssl.com/", maxChars: 500 }, "certificado expirado"],
  ["G", "cern-antigo", "read_page", { url: "http://info.cern.ch/hypertext/WWW/TheProject.html", maxChars: 2000 }, "HTML antigo/minimo"],

  // ---- H. seguranca (somente servicos de teste) ----
  ["H", "redirect-para-127", "read_page", { url: "https://httpbin.org/redirect-to?url=http://127.0.0.1/", maxChars: 500 }, "redirect publico -> 127.0.0.1"],
  ["H", "redirect-para-169", "read_page", { url: "https://httpbin.org/redirect-to?url=http://169.254.169.254/", maxChars: 500 }, "redirect publico -> metadata"],
  ["H", "redirect-para-localhost", "read_page", { url: "https://httpbin.org/redirect-to?url=http://localhost/", maxChars: 500 }, "redirect publico -> localhost"],
  ["H", "ipv6-loopback", "read_page", { url: "http://[::1]/", maxChars: 500 }, "IPv6 loopback direto"],
  ["H", "ipv4-mapeado-ipv6", "read_page", { url: "http://[::ffff:127.0.0.1]/", maxChars: 500 }, "IPv4 mapeado em IPv6"],

  // ---- I. ferramentas compostas ----
  ["I", "multiple-misto", "read_multiple_pages", { urls: ["https://example.com/", "https://httpbin.org/status/404", "http://169.254.169.254/", "https://httpbin.org/delay/5", "https://httpbin.org/status/500"], maxChars: 400 }, "5 URLs: boa, 404, bloqueada, lenta, 500"],
  ["I", "extract-links-wiki", "extract_links", { url: "https://pt.wikipedia.org/wiki/Node.js", limit: 50 }, "links relativos, ancoras, externos"],
  ["I", "discover-site", "discover_urls", { url: "https://motherfuckingwebsite.com/", limit: 30 }, "site minusculo, sem sitemap"],
  ["I", "crawl-site", "crawl_site", { url: "https://motherfuckingwebsite.com/", maxPages: 5, maxChars: 600 }, "crawl leve em site permissivo"],
  ["I", "crawl-host-bloqueado", "crawl_site", { url: "http://169.254.169.254/", maxPages: 3, maxChars: 300 }, "crawl contra host interno -> tem de ser isError"],
  ["I", "cache-1a-leitura", "read_page", { url: "https://example.com/", maxChars: 300 }, "uso repetido: 1a chamada"],
  ["I", "cache-2a-leitura", "read_page", { url: "https://example.com/", maxChars: 300 }, "uso repetido: 2a chamada (cache)"],
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
  await rm(path.join(RAIZ, "campo", "raw"), { recursive: true, force: true });
  await mkdir(path.join(RAIZ, "campo", "raw"), { recursive: true });

  const log = await (await import("node:fs/promises")).open(path.join(RAIZ, "campo", "server.log"), "w");
  const { ALLOW_PRIVATE_HOSTS: _descarta, ...envLimpo } = process.env; // garantia: nunca ativa
  const filho = spawn(process.execPath, [path.join(RAIZ, "server.js")], {
    env: {
      ...envLimpo,
      PORT: String(PORTA),
      MCP_AUTH_TOKEN: TOKEN,
      RATE_LIMIT_MAX: "1000000", // desvio documentado: a bateria tem +-65 chamadas
      TRUST_PROXY_HOPS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const banner = [];
  filho.stdout.on("data", (d) => { banner.push(d.toString()); log.write(d); });
  filho.stderr.on("data", (d) => { banner.push(d.toString()); log.write(d); });

  const health0 = await esperarServidor(BASE);
  console.log("servidor no ar. /health inicial:", health0.slice(0, 120), "\n");

  const resultados = [];
  let ultimoHost = "";
  for (let i = 0; i < CASOS.length; i++) {
    const [cat, nome, tool, args, nota] = CASOS[i];
    const host = new URL(args.url || args.urls?.[0] || "http://x").host;
    const pausa = host === ultimoHost ? PAUSA_MESMO_HOST_MS : PAUSA_MS;
    ultimoHost = host;
    if (i > 0) await sleep(pausa);

    const t0 = Date.now();
    let status = 0, json = null, erroDriver = "";
    try {
      const res = await fetch(BASE + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: { name: tool, arguments: args } }),
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

    let rss = "";
    try {
      const h = await fetch(BASE + "/health", { signal: AbortSignal.timeout(5000) });
      const ht = await h.text();
      rss = (ht.match(/rss: (\d+ MB)/) || [])[1] || "";
    } catch { /* segue */ }

    const arq = `${String(i + 1).padStart(2, "0")}-${slug(cat + "-" + nome)}.md`;
    await writeFile(
      path.join(RAIZ, "campo", "raw", arq),
      [
        `# caso ${i + 1}: [${cat}] ${nome}`,
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

    resultados.push({ i: i + 1, cat, nome, tool, url: args.url || args.urls, nota, status, ms, isError, erroDriver, chars: texto.length, tabelas, cercas, truncado, mojibake, cjk, rtl, links, rss, arquivo: "raw/" + arq });
    const sinal = isError ? "ERRO " : "ok   ";
    console.log(`${sinal} ${String(i + 1).padStart(2)} [${cat}] ${nome.padEnd(24)} ${String(ms).padStart(6)} ms  ${String(texto.length).padStart(6)} chars${truncado ? " TRUNC" : ""}${mojibake ? " MOJIBAKE" : ""}`);
  }

  const healthFim = await (await fetch(BASE + "/health", { signal: AbortSignal.timeout(10000) })).text();
  await writeFile(path.join(RAIZ, "campo", "resultados.json"), JSON.stringify({ health0, healthFim, casos: resultados }, null, 2));
  console.log("\n/health final:", healthFim.slice(0, 160));

  /* --- teste de rate limit: segunda instancia, limite padrao (60/min) --- */
  console.log("\n--- teste de rate limit (instancia propria, 65 chamadas em serie) ---");
  const PORTA2 = PORTA + 1;
  const { ALLOW_PRIVATE_HOSTS: _descarta2, ...envLimpo2 } = process.env;
  const filho2 = spawn(process.execPath, [path.join(RAIZ, "server.js")], {
    env: { ...envLimpo2, PORT: String(PORTA2), MCP_AUTH_TOKEN: TOKEN, TRUST_PROXY_HOPS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log2 = [];
  filho2.stdout.on("data", (d) => log2.push(d.toString()));
  filho2.stderr.on("data", (d) => log2.push(d.toString()));
  await esperarServidor(`http://127.0.0.1:${PORTA2}`);
  let primeira429 = null, cont429 = 0;
  for (let n = 1; n <= 65; n++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORTA2}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: n, method: "tools/list" }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 429) { cont429++; if (primeira429 === null) primeira429 = n; }
    } catch (e) {
      console.log(`  chamada ${n}: falhou no cliente: ${e.message}`);
    }
  }
  console.log(`  primeira resposta 429 na chamada: ${primeira429} | total de 429: ${cont429}/65`);
  await writeFile(path.join(RAIZ, "campo", "ratelimit.json"), JSON.stringify({ primeira429, cont429, banner: log2.join("") }, null, 2));

  filho2.kill();
  filho.kill();
  await sleep(500);
  filho2.kill("SIGKILL"); filho.kill("SIGKILL");
  log.close();
  console.log("\nbateria concluida. saidas em campo/raw/, metricas em campo/resultados.json");
}

main().catch((e) => { console.error("driver falhou:", e); process.exit(1); });
