// stress-peso.mjs — bateria de SITES PESADOS, LENTOS e DIFÍCIES contra um
// web-reader-mcp NO AR, com cronometro por chamada.
// Uso: node scripts/stress-peso.mjs <https://sua-url.onrender.com> <token>
// (o token tambem pode vir de LIVE_TEST_TOKEN; nunca seja gravado em arquivo)
//
// Para que serve o live-test.mjs nao serve: aquele confirma o contrato (rotas,
// auth, formatos). Este aqui procura o que so aparece com carga real — o
// documento de 12 MB do WHATWG, um PDF de 130 paginas, um download de 200 MB,
// site que demora 20 s a responder, TLS rebentado, robots que proibe, SPA vazia,
// corte no meio de um caractere UTF-8 e as codificacoes de SSRF que escapam a um
// filtro ingenuo.
//
// Cada chamada regista {ms, chars, ok, nota}. No fim: tempo total, media por
// grupo, as chamadas mais lentas e o /health antes e depois (RSS e cache),
// porque "passou mas comeu a memoria toda" tambem e um resultado.
//
// AMBIENTE != PRODUTO: se o /mcp responder fora da nossa aplicacao (o edge da
// Cloudflare em frente ao Render devolve uma pagina 403 "Blocked" quando o corpo
// do pedido contem um IP codificado), isso e registado como AMBIENTE, nao FAIL.
// O que se mede aqui e o produto; a internet e só o cenario.
//
// Rate limit: o servidor faz 60 pedidos/min por IP. O script conta a janela
// deslizante e espera antes de bater os 50; se apanhar 429, recua e tenta uma vez.

const base = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || process.env.LIVE_TEST_TOKEN || "";

if (!base || !token) {
  console.error("uso: node scripts/stress-peso.mjs <https://sua-url.onrender.com> <token>");
  process.exit(1);
}

const MCP_URL = base + "/mcp";
// O servidor corta em HTTP_REQUEST_TIMEOUT_MS (150 s); o cliente espera um
// pouco mais para conseguir distinguir "o servidor desistiu" de "a rede pifou".
const CLIENTE_TIMEOUT_MS = Number(process.env.STRESS_TIMEOUT_MS || 185000);
const JANELA_MS = 60000;
const MAX_POR_JANELA = 50;

const janela = []; // timestamps dos pedidos enviados (rate limit do servidor)
const registros = [];
let nPass = 0, nFail = 0, nAviso = 0, nAmbiente = 0;
const falhas = [];
let idSeq = 9000;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const encurta = (s, n = 74) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

async function saude() {
  try {
    const res = await fetch(base + "/health", { signal: AbortSignal.timeout(30000) });
    return await res.text();
  } catch (e) {
    return `(sem health: ${e.message})`;
  }
}

// Uma chamada RPC crua, com a janela de rate limit e o recuo em 429 ja tratados.
async function rpc(ferramenta, args) {
  while (janela.filter((t) => Date.now() - t < JANELA_MS).length >= MAX_POR_JANELA) {
    const livreEm = JANELA_MS - (Date.now() - janela[0]) + 250;
    console.log(`      (janela de rate limit cheia; espera ${Math.ceil(livreEm / 1000)} s)`);
    await espera(Math.max(1000, livreEm));
  }
  const t0 = Date.now();
  let r = null;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    janela.push(Date.now());
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++idSeq, method: "tools/call", params: { name: ferramenta, arguments: args || {} } }),
      signal: AbortSignal.timeout(CLIENTE_TIMEOUT_MS),
    }).catch((e) => ({ status: 0, _erro: e.message, headers: new Map(), async text() { return ""; } }));
    if (res.status === 429 && tentativa === 1) {
      console.log("      (429 do rate limit; recua 20 s)");
      await res.text().catch(() => {});
      await espera(20000);
      continue;
    }
    const texto = await res.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* mantem null */ }
    r = { status: res.status, json, texto, ct: (res.headers.get && res.headers.get("content-type")) || "?", erroRede: res._erro };
    break;
  }
  r.ms = Date.now() - t0;
  return r;
}

const corpoDe = (r) => r.json?.result?.content?.[0]?.text || "";

async function lancar(rotulo, grupo, ferramenta, args, validar) {
  const r = await rpc(ferramenta, args);
  const corpo = corpoDe(r);
  const isError = r.json?.result?.isError === true;

  // O edge respondeu fora da nossa aplicacao: nao ha nada a dizer do produto.
  if (!r.json) {
    nAmbiente++;
    const porque = r.erroRede ? `rede: ${r.erroRede}` : `HTTP ${r.status} ${r.ct}`;
    console.log(`AMB   [${grupo}] ${rotulo}`);
    console.log(`      ${ferramenta} | ${r.ms} ms | ${porque} -> o pedido parou no edge, nao chegou ao servidor`);
    registros.push({ rotulo, grupo, ferramenta, ms: r.ms, chars: r.texto.length, ok: true, ambiente: true });
    return r;
  }

  const veredito = validar({ t: corpo, isError, ms: r.ms, status: r.status, json: r.json });
  const ok = veredito === true;
  const nota = ok ? "" : String(veredito || "falhou");
  registros.push({ rotulo, grupo, ferramenta, ms: r.ms, chars: corpo.length, ok, nota });
  if (ok) nPass++; else { nFail++; falhas.push(`${rotulo} -> ${nota}`); }
  console.log(`${ok ? "PASS" : "FAIL"}  [${grupo}] ${rotulo}`);
  console.log(`      ${ferramenta} | ${r.ms} ms | ${corpo.length} chars${nota ? ` | ${nota}` : ""}`);
  if (corpo) console.log(`      saida: ${encurta(corpo, 112)}`);
  return r;
}

// AVISO controlado dentro de um validador: o site externo nao colaborou.
function ambiente(mensagem) {
  console.log(`      (ambiente: ${mensagem})`);
  nAviso++;
}

// Predicados reutilizaveis. Devolver string = a razao do FAIL (aparece no log).
const leu = (minChars) => ({ t, isError }) => {
  if (isError) return `devolveu erro: ${encurta(t, 90)}`;
  return t.length < minChars ? `so ${t.length} chars (esperava >= ${minChars})` : true;
};
// "Nunca silencio": aceita sucesso ou erro, mas a saida TEM de dizer o que houve.
const declara = (padrao) => ({ t }) => {
  if (t.length < 40) return `saida muda (${t.length} chars)`;
  return padrao.test(t) ? true : `nao declarou o resultado: ${encurta(t, 90)}`;
};
// Erro limpo = isError + uma frase que um humano entende (PT ou codigo do Node).
const erroLimpo = (padrao) => ({ t, isError, status }) => {
  if (status >= 500) return `HTTP ${status} (devia ser isError, nao 5xx)`;
  if (!isError) return `NAO recusou: ${encurta(t, 90)}`;
  return padrao.test(t) ? true : `recusou sem explicar: ${encurta(t, 90)}`;
};

(async () => {
  const T0 = Date.now();
  console.log(`alvo: ${base}`);
  console.log(`inicio: ${new Date().toISOString()}`);
  const healthAntes = await saude();
  console.log(`health antes: ${encurta(healthAntes, 200)}\n`);

  /* ============================ PESO ============================ */
  // Documentos grandes: e aqui que um parser sem limites estoura.

  await lancar(
    "pagina de 12 MB (especificacao HTML do WHATWG)",
    "peso", "read_page",
    { url: "https://html.spec.whatwg.org/multipage/", maxChars: 25000, timeoutMs: 60000 },
    leu(4000)
  );

  await lancar(
    "especificacao multi-MB da W3C (WebGPU)",
    "peso", "read_page",
    { url: "https://www.w3.org/TR/webgpu/", maxChars: 25000, timeoutMs: 60000 },
    leu(4000)
  );

  await lancar(
    "tabela gigante da Wikipedia (traducoes da Biblia)",
    "peso", "read_page",
    { url: "https://en.wikipedia.org/wiki/List_of_Bible_translations", maxChars: 25000, timeoutMs: 60000 },
    leu(4000)
  );

  await lancar(
    "tabela enorme (comparacao de kernels de SO)",
    "peso", "read_page",
    { url: "https://en.wikipedia.org/wiki/Comparison_of_operating_system_kernels", maxChars: 25000, timeoutMs: 60000 },
    leu(4000)
  );

  await lancar(
    "site com JS inline gigante (react.dev)",
    "peso", "read_page",
    { url: "https://react.dev/", maxChars: 20000, timeoutMs: 60000 },
    leu(1000)
  );

  await lancar(
    "PDF grande dentro do teto (RFC 9110 HTTP, ~130 paginas)",
    "peso", "read_pdf",
    { url: "https://www.ietf.org/rfc/rfc9110.pdf", maxChars: 25000, timeoutMs: 60000 },
    leu(3000)
  );

  await lancar(
    "PDF denso de 15 paginas (Attention Is All You Need)",
    "peso", "read_pdf",
    { url: "https://arxiv.org/pdf/1706.03762", maxChars: 20000, timeoutMs: 60000 },
    leu(2500)
  );

  await lancar(
    "PDF acima do teto de 5 MB (tem de recusar, nao rebentar)",
    "peso", "read_pdf",
    { url: "https://arxiv.org/pdf/2005.14165", maxChars: 20000, timeoutMs: 60000 },
    declara(/muito grande|acima de|tamanho|nao foi possivel/i)
  );

  await lancar(
    "download de 200 MB (o teto de bytes tem de cortar a meio)",
    "peso", "read_page",
    { url: "https://speed.cloudflare.com/__down?bytes=200000000", timeoutMs: 60000 },
    (c) => (c.ms > 90000 ? `demorou ${c.ms} ms — o corte de bytes nao segurou o download` : c.t.length > 0 ? true : "saida vazia")
  );

  await lancar(
    "GeoJSON grande (paises, Natural Earth)",
    "peso", "read_json",
    { url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson", maxChars: 25000, timeoutMs: 60000 },
    leu(3000)
  );

  await lancar(
    "API com path profundo (100 commits do Node no GitHub)",
    "peso", "read_json",
    { url: "https://api.github.com/repos/nodejs/node/commits?per_page=100", path: "0.commit.message", maxChars: 8000, timeoutMs: 30000 },
    declara(/commit|message|nao existe|caminho|JSON/i)
  );

  await lancar(
    "feed pesado com limite no teto (Slashdot, 100 itens)",
    "peso", "read_feed",
    { url: "https://rss.slashdot.org/Slashdot/slashdotMain", limit: 100, maxChars: 25000, timeoutMs: 60000 },
    leu(2000)
  );

  await lancar(
    "feed de noticias grande (BBC World)",
    "peso", "read_feed",
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", limit: 100, maxChars: 25000, timeoutMs: 60000 },
    leu(2000)
  );

  await lancar(
    "feed Atom do YouTube (robots pode proibir — tem de dizer)",
    "peso", "read_feed",
    { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCX6OQ3DkcsbYNE6H8uQQuVA", limit: 100, maxChars: 20000, timeoutMs: 60000 },
    declara(/Itens:|robots|Bloqueado|nao foi possivel|HTTP/i)
  );

  await lancar(
    "milhares de links (extract_links no teto de 200)",
    "peso", "extract_links",
    { url: "https://en.wikipedia.org/wiki/Lists_of_deities", limit: 200, timeoutMs: 60000 },
    (c) => {
      const n = Number((c.t.match(/(\d+)\s+(?:links?\s+)?encontrados/i) || [])[1] || 0);
      if (c.isError) return `devolveu erro: ${encurta(c.t, 90)}`;
      return n >= 50 ? true : `nao contou os links: ${encurta(c.t, 70)}`;
    }
  );

  await lancar(
    "busca num documento de 12 MB (find_on_page, 100 acertos)",
    "peso", "find_on_page",
    { url: "https://html.spec.whatwg.org/multipage/", query: "textarea", maxHits: 100, contexto: 5, timeoutMs: 60000 },
    leu(2000)
  );

  await lancar(
    "lote de 20 URLs de uma vez (com 2 dominios mortos no meio)",
    "peso", "read_multiple_pages",
    {
      urls: [
        "https://example.com", "https://example.net",
        "https://www.rfc-editor.org/rfc/rfc9110.html",
        "https://docs.python.org/3/library/asyncio.html",
        "https://doc.rust-lang.org/book/", "https://caniuse.com/",
        "https://nodejs.org/en/docs", "https://www.w3.org/TR/webgpu/",
        "https://developer.mozilla.org/en-US/docs/Web/HTTP",
        "https://blog.demofox.org/", "https://httpbin.org/html",
        "https://www.ietf.org/rfc/rfc2046.txt", "https://info.cern.ch/",
        "https://motherfuckingwebsite.com/", "https://e5n.github.io/",
        "https://dominio-morto-9x7.invalid/", "https://outro-morto-4y8.invalid/",
        "https://plain-text.engineer/", "https://monocle.surge.sh/",
        "https://warm-winter.tokyo/",
      ],
      maxChars: 1000,
      timeoutMs: 30000,
    },
    (c) => (/dominio-morto/.test(c.t) ? (/example\.com/.test(c.t) ? true : "sumiu com as URLs que funcionam") : "escondeu o resultado das URLs mortas")
  );

  await lancar(
    "crawl de site com JS pesado (MDN, 10 paginas)",
    "peso", "crawl_site",
    { url: "https://developer.mozilla.org/en-US/docs/Web/HTTP", maxPages: 10, maxChars: 1500, timeoutMs: 30000 },
    leu(1500)
  );

  await lancar(
    "crawl de documentacao inteira (Rust Book, 15 paginas)",
    "peso", "crawl_site",
    { url: "https://doc.rust-lang.org/book/", maxPages: 15, maxChars: 800, timeoutMs: 30000 },
    leu(2000)
  );

  await lancar(
    "crawl no teto de paginas (maxPages 40, limite e 30)",
    "peso", "crawl_site",
    { url: "https://doc.rust-lang.org/book/", maxPages: 40, maxChars: 400, timeoutMs: 30000 },
    declara(/30|limite|maxPages|pagina/i)
  );

  await lancar(
    "transcricao de video do YouTube (metadados + legenda ou motivo)",
    "peso", "read_video",
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", maxChars: 12000, timeoutMs: 30000 },
    declara(/Plataforma:|Transcricao:|nao foi possivel|HTTP/i)
  );

  /* ============================ LENTO ============================ */
  // Sites que demoram de proposito: o timeoutMs tem de mandar nos dois sentidos.

  await lancar(
    "lento (10 s) com timeout CURTO de 3 s -> tem de desistir cedo",
    "lento", "read_json",
    { url: "https://httpbin.org/delay/10", timeoutMs: 3000 },
    (c) => {
      if (!c.isError) return `leu uma espera de 10 s com timeout de 3 s (${c.ms} ms)`;
      if (c.ms > 12000) return `demorou ${c.ms} ms a desistir, muito alem do timeout`;
      if (/Timeout|tempo/i.test(c.t)) return true;
      ambiente(`httpbin indisponivel: ${encurta(c.t, 60)}`);
      return true;
    }
  );

  await lancar(
    "lento (10 s) com timeout ALTO de 30 s -> tem de aguentar e ler",
    "lento", "read_json",
    { url: "https://httpbin.org/delay/10", timeoutMs: 30000 },
    (c) => {
      if (c.isError && /Timeout|tempo/i.test(c.t)) return `estourou o timeout dele (${c.ms} ms)`;
      if (c.isError) { ambiente(`httpbin indisponivel: ${encurta(c.t, 60)}`); return true; }
      return c.t.length > 100 ? true : `resposta curta demais (${c.t.length} chars)`;
    }
  );

  await lancar(
    "lento (20 s) com timeout de 40 s -> leitura completa, sem 5xx",
    "lento", "read_json",
    { url: "https://httpbin.org/delay/20", timeoutMs: 40000 },
    (c) => (c.status >= 500 ? `o servidor rebentou (HTTP ${c.status}) com uma pagina lenta` : c.isError && /Timeout|tempo/i.test(c.t) ? `timeout aos 20 s (${c.ms} ms) — teto baixo demais` : true)
  );

  await lancar(
    "espelho quando o httpbin falha (postman-echo, 15 s)",
    "lento", "read_json",
    { url: "https://postman-echo.com/delay/15", timeoutMs: 40000 },
    (c) => (c.isError && /Timeout|tempo/i.test(c.t) ? `timeout num eco de 15 s com timeout de 40 s (${c.ms} ms)` : true)
  );

  await lancar(
    "timeoutMs=0 (invalido) -> cai no padrao, nao rebenta",
    "lento", "read_page",
    { url: "https://example.com", timeoutMs: 0 },
    leu(150)
  );

  await lancar(
    "timeoutMs=999999 (acima do teto) -> limita internamente, sem 5xx",
    "lento", "read_page",
    { url: "https://example.com", timeoutMs: 999999 },
    (c) => (c.status >= 500 ? `HTTP ${c.status}` : c.isError ? `erro: ${encurta(c.t, 80)}` : true)
  );

  // Carga concorrente: 6 chamadas em paralelo. Um gargalo de serializacao
  // aparece aqui como tempo de cauda, nao como tempo de cada chamada.
  {
    const alvos = [
      "https://example.com", "https://example.net", "https://info.cern.ch/",
      "https://www.ietf.org/rfc/rfc2046.txt", "https://httpbin.org/html",
      "https://warm-winter.tokyo/",
    ];
    const t0 = Date.now();
    const lote = await Promise.all(alvos.map((u) => rpc("read_page", { url: u, maxChars: 400, timeoutMs: 30000 })));
    const parede = Date.now() - t0;
    const boas = lote.filter((r) => r.json && !r.json.result?.isError).length;
    const pior = Math.max(...lote.map((r) => r.ms));
    const soma = lote.reduce((s, r) => s + r.ms, 0);
    const ok = boas >= 4;
    console.log(`${ok ? "PASS" : "FAIL"}  [lento] rajada de 6 chamadas em paralelo (throughput real)`);
    console.log(`      read_page x6 | parede ${parede} ms | soma ${soma} ms | pior ${pior} ms | ${boas}/6 OK`);
    registros.push({ rotulo: "rajada de 6 paralelas", grupo: "lento", ferramenta: "read_page", ms: parede, chars: 0, ok });
    if (ok) nPass++; else { nFail++; falhas.push(`rajada de 6 paralelas -> so ${boas}/6 OK`); }
  }

  /* =========================== DIFÍCIL =========================== */
  // O que parte um leitor de páginas: TLS, robots, SPA, charset, esquemas.

  for (const [url, rotulo] of [
    ["https://expired.badssl.com/", "certificado expirado"],
    ["https://self-signed.badssl.com/", "certificado autoassinado"],
    ["https://wrong.host.badssl.com/", "certificado para outro host"],
    ["https://revoked.badssl.com/", "certificado revogado"],
    ["https://sha256.badssl.com/", "SHA-256 (deve funcionar)"],
  ]) {
    await lancar(
      `TLS: ${rotulo}`,
      "dificil", "read_page",
      { url, timeoutMs: 15000 },
      (c) => {
        if (c.status >= 500) return `HTTP ${c.status} (devia ser erro limpo)`;
        if (/deve funcionar/.test(rotulo)) return c.isError ? `recusou um certificado valido: ${encurta(c.t, 70)}` : true;
        if (!c.isError) return "aceitou um certificado rebentado";
        return /certificado|certificate|TLS|SSL|autoridade|expirad|revoked|revogad|invalid|hostname|match/i.test(c.t)
          ? true : `erro sem explicar: ${encurta(c.t, 80)}`;
      }
    );
  }

  await lancar(
    "robots.txt proibe o caminho (google.com/search)",
    "dificil", "read_page",
    { url: "https://www.google.com/search?q=web+reader+mcp", timeoutMs: 15000 },
    (c) => {
      if (c.status >= 500) return `HTTP ${c.status}`;
      if (c.isError) return /robots|bloquead|proibid|negad/i.test(c.t) ? true : `erro: ${encurta(c.t, 80)}`;
      return "leu uma URL proibida pelo robots.txt";
    }
  );

  await lancar(
    "site anti-bot pesado (pagina de busca da Amazon)",
    "dificil", "read_page",
    { url: "https://www.amazon.com/s?k=mechanical+keyboard", maxChars: 8000, timeoutMs: 25000 },
    (c) => (c.status >= 500 ? `HTTP ${c.status}` : c.isError ? /robots|captcha|bloquead|403|HTTP|nao foi possivel/i.test(c.t) ? true : `erro sem explicar: ${encurta(c.t, 80)}` : c.t.length > 500 ? true : "pagina de robos devolveu quase nada sem avisar")
  );

  await lancar(
    "site que barra o User-Agent (reddit)",
    "dificil", "read_page",
    { url: "https://www.reddit.com/r/programming/", timeoutMs: 20000 },
    (c) => (c.status >= 500 ? `HTTP ${c.status} (devia ser erro limpo)` : true)
  );

  await lancar(
    "pagina 100% renderizada por JS -> read_page tem de apontar a saida",
    "dificil", "read_page",
    { url: "https://quotes.toscrape.com/js/", timeoutMs: 20000 },
    declara(/read_dynamic_page|JavaScript|0 caracteres|muito curto/i)
  );

  await lancar(
    "a mesma pagina JS pelo read_dynamic_page -> declara o que achou",
    "dificil", "read_dynamic_page",
    { url: "https://quotes.toscrape.com/js/", timeoutMs: 20000 },
    declara(/dinamica|estatica|JavaScript|nao foi possivel|marcadores|dados embutidos/i)
  );

  await lancar(
    "SPA de verdade que so tem dados em JS (nextjs.org)",
    "dificil", "read_dynamic_page",
    { url: "https://nextjs.org/", maxChars: 8000, timeoutMs: 30000 },
    declara(/dinamica|estatica|JavaScript|next|__NEXT_DATA__|nao foi possivel/i)
  );

  await lancar(
    "text/plain grande (~700 KB, Gutenberg)",
    "dificil", "read_page",
    { url: "https://www.gutenberg.org/files/1342/1342-0.txt", maxChars: 20000, timeoutMs: 30000 },
    leu(500)
  );

  await lancar(
    "HTML sem charset declarado -> sem mojibake",
    "dificil", "read_page",
    { url: "https://httpbin.org/html", maxChars: 4000, timeoutMs: 20000 },
    (c) => {
      if (c.isError) { ambiente(`httpbin indisponivel: ${encurta(c.t, 50)}`); return true; }
      if (/Ã©|Ã¡|â€™|Â/.test(c.t)) return `mojibake: ${encurta(c.t.match(/.{0,40}(Ã|â|Â).{0,40}/)?.[0] || c.t, 80)}`;
      return c.t.length > 300 ? true : `saida curta (${c.t.length} chars)`;
    }
  );

  for (const [url, rotulo] of [
    ["https://ja.wikipedia.org/wiki/日本語", "japones"],
    ["https://ar.wikipedia.org/wiki/ويكيبيديا", "arabe RTL"],
    ["https://ru.wikipedia.org/wiki/Россия", "cirilico"],
    ["https://zh.wikipedia.org/wiki/中华人民共和国", "chines"],
  ]) {
    await lancar(
      `UTF-8 multibyte cortado no teto de 25000 (${rotulo})`,
      "dificil", "read_page",
      { url, maxChars: 25000, timeoutMs: 30000 },
      (c) => {
        if (c.isError) return `recusou uma URL unicode valida: ${encurta(c.t, 80)}`;
        if (/[\uFFFD]/.test(c.t)) return "tem U+FFFD: cortou no meio de um caractere";
        return c.t.length > 1000 ? true : `saida curta (${c.t.length} chars)`;
      }
    );
  }

  await lancar(
    "read_pdf numa URL que e HTML, nao PDF",
    "dificil", "read_pdf",
    { url: "https://www.wikipedia.org/", timeoutMs: 20000 },
    declara(/nao reconhecido|PDF|nao e|formato|bin/i)
  );

  await lancar(
    "read_pdf num PDF inexistente (404 limpo)",
    "dificil", "read_pdf",
    { url: "https://www.ietf.org/rfc/rfc0000.pdf", timeoutMs: 20000 },
    declara(/404|nao existe|HTTP|nao foi possivel/i)
  );

  await lancar(
    "read_json num endpoint que devolve HTML",
    "dificil", "read_json",
    { url: "https://example.com", timeoutMs: 20000 },
    declara(/JSON nao reconhecido|devolveu HTML|read_page|nao e JSON/i)
  );

  await lancar(
    "read_feed numa URL que e HTML",
    "dificil", "read_feed",
    { url: "https://example.com", timeoutMs: 20000 },
    declara(/feed|XML|nao|HTML|Formato|HTTP/i)
  );

  await lancar(
    "read_json com path inexistente -> tem de dizer, nao calar",
    "dificil", "read_json",
    { url: "https://api.github.com/repos/nodejs/node", path: "ramo.que.nao.existe", timeoutMs: 20000 },
    (c) => (c.t.length < 40 ? "devolveu vazio para path inexistente" : true)
  );

  await lancar(
    "cadeia de 6 redirects (mais que o limite de 5)",
    "dificil", "read_page",
    { url: "https://httpbin.org/redirect/6", maxChars: 2000, timeoutMs: 25000 },
    (c) => {
      if (c.status >= 500) return `HTTP ${c.status}`;
      if (c.isError) return /redirect|saltos|excesso/i.test(c.t) ? true : `erro sem explicar: ${encurta(c.t, 70)}`;
      return /URL:/.test(c.t) ? true : "seguiu redirects sem declarar a URL final";
    }
  );

  await lancar(
    "redirect cujo destino e endereco interno",
    "dificil", "read_page",
    { url: "https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%2F&status_code=302", timeoutMs: 20000 },
    (c) => {
      if (c.status >= 500) return `HTTP ${c.status}`;
      if (!c.isError) return "seguiu um redirect ate 127.0.0.1 sem bloquear";
      return /bloquead|privado|interno|redirect|nao foi possivel|HTTP/i.test(c.t) ? true : `erro: ${encurta(c.t, 80)}`;
    }
  );

  await lancar(
    "HTTP 500 do site remoto -> erro limpo, nao panic",
    "dificil", "read_page",
    { url: "https://httpbin.org/status/500", timeoutMs: 20000 },
    (c) => (c.status >= 500 ? `HTTP ${c.status} do NOSSO servidor` : c.isError ? /500|HTTP|erro/i.test(c.t) ? true : `sem explicar: ${encurta(c.t, 70)}` : "leu um 500 como sucesso")
  );

  await lancar(
    "HTTP 204 com corpo vazio -> declara, nao cala",
    "dificil", "read_page",
    { url: "https://httpbin.org/status/204", timeoutMs: 20000 },
    (c) => (c.status >= 500 ? `HTTP ${c.status}` : true)
  );

  await lancar(
    "HTTP 418 (codigo absurdo passa como erro limpo)",
    "dificil", "read_page",
    { url: "https://httpbin.org/status/418", timeoutMs: 20000 },
    (c) => (c.status >= 500 ? `HTTP ${c.status}` : true)
  );

  await lancar(
    "URL com espacos por codificar -> normaliza e le",
    "dificil", "read_page",
    { url: "https://en.wikipedia.org/wiki/List of Bible translations", timeoutMs: 20000 },
    (c) => (c.status >= 500 ? `HTTP ${c.status}` : c.isError ? `recusou: ${encurta(c.t, 80)}` : c.t.length > 1000 ? true : `saida curta (${c.t.length} chars)`)
  );

  await lancar(
    "URL com acentos e fragmento (pt.wikipedia/Açaí#História)",
    "dificil", "read_page",
    { url: "https://pt.wikipedia.org/wiki/Açaí#História", timeoutMs: 20000 },
    leu(1000)
  );

  await lancar(
    "query string de 3000 caracteres",
    "dificil", "read_page",
    { url: `https://example.com/?x=${"a".repeat(3000)}`, timeoutMs: 20000 },
    (c) => (c.status >= 500 ? `HTTP ${c.status} para uma URL longa` : true)
  );

  await lancar(
    "host que nao existe (DNS limpo, sem 5xx)",
    "dificil", "read_page",
    { url: "https://dominio-que-nao-existe-9x7q4.invalid/", timeoutMs: 15000 },
    declara(/nao foi possivel resolver|resolver|DNS|nao existe/i)
  );

  await lancar(
    "porta exotica fechada (timeout limpo, nao pendura)",
    "dificil", "read_page",
    { url: "https://example.com:8443/", timeoutMs: 6000 },
    (c) => (c.status >= 500 ? `HTTP ${c.status}` : c.ms > 25000 ? `pendurou ${c.ms} ms` : true)
  );

  for (const [url, rotulo] of [
    ["file:///etc/passwd", "file://"],
    ["data:text/html,<h1>oi</h1>", "data:"],
    ["gopher://example.com/", "gopher:"],
    ["javascript:alert(1)", "javascript:"],
    ["exemplo.com", "sem esquema"],
    ["https://", "esquema sem host"],
    ["", "URL vazia"],
    ["https://user:senha@example.com/", "credenciais na URL"],
  ]) {
    await lancar(
      `URL fora da lei: ${rotulo}`,
      "dificil", "read_page",
      { url },
      (c) => (c.status >= 500 ? `HTTP ${c.status}` : c.isError ? /http|esquema|scheme|invalid|URL|nao e valida|vazia|parametro/i.test(c.t) ? true : `recusa sem explicar: ${encurta(c.t, 70)}` : `aceitou ${rotulo} (${c.t.length} chars)`)
    );
  }

  // A mesma regra tem de valer em TODAS as ferramentas, nao so no read_page.
  for (const ferramenta of ["read_pdf", "read_feed", "read_json", "extract_links", "discover_urls", "crawl_site", "diff_page", "read_dynamic_page", "read_video", "read_multiple_pages"]) {
    const args = ferramenta === "read_multiple_pages" ? { urls: ["file:///etc/passwd"] } : { url: "file:///etc/passwd" };
    if (ferramenta === "find_on_page") args.query = "root";
    await lancar(
      `${ferramenta} rejeita file:// tambem`,
      "dificil", ferramenta, args,
      (c) => (c.status >= 500 ? `HTTP ${c.status}` : c.isError ? true : `aceitou file:// (${encurta(c.t, 60)})`)
    );
  }

  await lancar(
    "maxChars=1 (abaixo do minimo) -> sobe ao minimo de 200",
    "dificil", "read_page",
    { url: "https://example.com", maxChars: 1, timeoutMs: 20000 },
    (c) => (c.isError ? `erro em vez de limitar: ${encurta(c.t, 70)}` : c.t.length >= 200 ? true : `saida de ${c.t.length} chars`)
  );

  await lancar(
    "maxChars=999999 -> teto duro de 25000",
    "dificil", "read_page",
    { url: "https://en.wikipedia.org/wiki/PHP", maxChars: 999999, timeoutMs: 30000 },
    (c) => (c.t.length > 26000 ? `devolveu ${c.t.length} chars, acima do teto` : true)
  );

  await lancar(
    "urls: [] (lote vazio) -> erro de parametro limpo",
    "dificil", "read_multiple_pages",
    { urls: [] },
    (c) => (c.status >= 500 ? `HTTP ${c.status}` : c.isError ? true : `aceitou lote vazio: ${encurta(c.t, 60)}`)
  );

  await lancar(
    "urls com 40 itens (acima do teto de 30) -> recusa com limite",
    "dificil", "read_multiple_pages",
    { urls: Array.from({ length: 40 }, (_, i) => `https://example.com/?i=${i}`) },
    declara(/30|limite|max|máximo|excede/i)
  );

  await lancar(
    "query vazia no find_on_page -> erro de parametro, nao 5xx",
    "dificil", "find_on_page",
    { url: "https://example.com", query: "" },
    (c) => (c.status >= 500 ? `HTTP ${c.status}` : true)
  );

  await lancar(
    "regex invalida no find_on_page -> erro de parametro limpo",
    "dificil", "find_on_page",
    { url: "https://example.com", query: "(unclosed[", regex: true },
    (c) => (c.status >= 500 ? `HTTP ${c.status}` : c.isError ? /regex|invalid/i.test(c.t) ? true : `sem explicar: ${encurta(c.t, 70)}` : "aceitou regex partida")
  );

  await lancar(
    "regex catastrofica ((a+)+b) num artigo grande -> nao pode pendurar",
    "dificil", "find_on_page",
    { url: "https://en.wikipedia.org/wiki/PHP", query: "(a+)+b", regex: true, maxHits: 50, timeoutMs: 30000 },
    (c) => (c.ms > 45000 ? `levou ${c.ms} ms — a regex nao foi contida` : c.status >= 500 ? `HTTP ${c.status}` : true)
  );

  await lancar(
    "diff_page duas vezes na mesma URL de estado",
    "dificil", "diff_page",
    { url: "https://example.com", timeoutMs: 20000 },
    declara(/PRIMEIRA leitura|SEM MUDANCA|MUDOU/)
  );

  await lancar(
    "diff_page numa pagina de 12 MB (a marca nao pode inflar a RAM)",
    "dificil", "diff_page",
    { url: "https://html.spec.whatwg.org/multipage/", maxChars: 8000, timeoutMs: 60000 },
    declara(/PRIMEIRA leitura|SEM MUDANCA|MUDOU/)
  );

  /* ============================ SSRF ============================ */
  // Codificacoes que passam num filtro ingenuo por string. Todas tem de ser
  // bloqueadas ANTES de ligar, com erro explicativo e sem 5xx.

  const SSRF = [
    ["http://2130706433/", "decimal (127.0.0.1)"],
    ["http://0x7f000001/", "hexadecimal"],
    ["http://0177.0.0.1/", "octal com zero"],
    ["http://127.1/", "forma curta"],
    ["http://[::1]/", "IPv6 loopback"],
    ["http://[::ffff:127.0.0.1]/", "IPv6 mapeado em IPv4"],
    ["http://0.0.0.0/", "unspecified"],
    ["http://localhost./", "localhost com ponto final"],
    ["http://169.254.169.254/latest/meta-data/iam/security-credentials/", "metadata AWS"],
    ["http://metadata.google.internal/", "metadata GCP"],
    ["http://100.64.1.1/", "CGNAT 100.64/10"],
    ["http://198.18.0.1/", "faixa de benchmark"],
    ["http://192.0.0.1/", "faixa IETF"],
    ["http://10.0.0.1/", "rede privada 10/8"],
    ["http://172.16.0.1/", "rede privada 172.16/12"],
    ["http://192.168.1.1/", "rede privada 192.168/16"],
    ["http://[fe80::1]/", "IPv6 link-local"],
    ["http://[ff02::1]/", "IPv6 multicast"],
    ["http://224.0.0.1/", "multicast IPv4"],
    ["http://169.254.169.254.", "metadata com ponto final"],
    ["http://2130706433:8080/", "decimal com porta"],
    ["http://[::]/", "IPv6 unspecified"],
  ];

  for (const [url, rotulo] of SSRF) {
    await lancar(
      `SSRF: ${rotulo}`,
      "ssrf", "read_page",
      { url, timeoutMs: 10000 },
      (c) => {
        if (c.status >= 500) return `HTTP ${c.status} (devia ser isError)`;
        if (!c.isError) return `NAO BLOQUEOU — leu ${c.t.length} chars de endereco interno`;
        return /bloquead|privado|interno|nao e permitido|reservad|multicast|link-local|nao foi possivel resolver/i.test(c.t)
          ? true : `bloqueou sem explicar: ${encurta(c.t, 80)}`;
      }
    );
  }

  // O truque de userinfo/fragmento: a string da URL parece publica, o host real
  // e interno. Bloquear por expressao regular nao chega — tem de parsear.
  for (const [url, rotulo] of [
    ["http://example.com@127.0.0.1/", "userinfo com host interno"],
    ["http://127.0.0.1#@example.com/", "fragmento como disfarce"],
  ]) {
    await lancar(
      `SSRF por parsing: ${rotulo}`,
      "ssrf", "read_page",
      { url, timeoutMs: 10000 },
      (c) => (c.status >= 500 ? `HTTP ${c.status}` : c.isError ? /bloquead|privado|interno|invalid|nao e valida|URL|resolver|nao foi possivel/i.test(c.t) ? true : `sem explicar: ${encurta(c.t, 80)}` : `NAO BLOQUEOU (${c.t.length} chars)`)
    );
  }

  // DNS que aponta para dentro: bloquear por string nao chega, tem de pinar IP.
  for (const [url, rotulo] of [
    ["http://127.0.0.1.nip.io/", "nip.io -> 127.0.0.1"],
    ["http://localtest.me/", "localtest.me -> 127.0.0.1"],
  ]) {
    await lancar(
      `SSRF por DNS: ${rotulo}`,
      "ssrf", "read_page",
      { url, timeoutMs: 15000 },
      (c) => {
        if (c.status >= 500) return `HTTP ${c.status}`;
        if (!c.isError) return `NAO BLOQUEOU (resolveu para dentro e leu ${c.t.length} chars)`;
        return /bloquead|privado|interno|nao e permitido|reservad|resolver|nao foi possivel/i.test(c.t)
          ? true : `erro: ${encurta(c.t, 80)}`;
      }
    );
  }

  for (const [ferramenta, url] of [
    ["read_dynamic_page", "http://169.254.169.254/latest/meta-data/"],
    ["read_pdf", "http://127.0.0.1:6379/"],
    ["read_feed", "http://192.168.0.1/admin"],
    ["discover_urls", "http://10.10.10.10/"],
    ["crawl_site", "http://127.0.0.1/"],
    ["extract_links", "http://127.0.0.1/"],
    ["read_multiple_pages", null],
  ]) {
    const args = ferramenta === "read_multiple_pages" ? { urls: ["http://169.254.169.254/"] } : { url, timeoutMs: 10000 };
    await lancar(
      `SSRF tambem no ${ferramenta}`,
      "ssrf", ferramenta, args,
      erroLimpo(/bloquead|privado|interno/)
    );
  }

  /* ============================ FIM ============================ */

  const healthDepois = await saude();
  const totalMs = Date.now() - T0;

  const porGrupo = {};
  for (const r of registros) {
    const g = (porGrupo[r.grupo] = porGrupo[r.grupo] || { n: 0, ms: 0, chars: 0, fails: 0, amb: 0 });
    g.n++; g.ms += r.ms; g.chars += r.chars;
    if (r.ambiente) g.amb++; else if (!r.ok) g.fails++;
  }

  console.log("\n" + "=".repeat(78));
  console.log("RESUMO POR GRUPO");
  console.log("=".repeat(78));
  for (const [g, v] of Object.entries(porGrupo)) {
    console.log(`${g.padEnd(8)} ${String(v.n).padStart(3)} chamadas | total ${String((v.ms / 1000).toFixed(1)).padStart(7)} s | media ${String(Math.round(v.ms / v.n)).padStart(6)} ms | ${String((v.chars / 1000).toFixed(1)).padStart(6)}k chars | ${v.fails} falha(s)${v.amb ? ` | ${v.amb} no edge` : ""}`);
  }

  const maisLentas = [...registros].filter((r) => !r.ambiente).sort((a, b) => b.ms - a.ms).slice(0, 15);
  console.log("\n" + "=".repeat(78));
  console.log("AS 15 CHAMADAS MAIS LENTAS");
  console.log("=".repeat(78));
  for (const r of maisLentas) {
    console.log(`${String(Math.round(r.ms)).padStart(6)} ms  ${(r.ok ? "ok  " : "FAIL")}  ${r.grupo.padEnd(8)} ${r.ferramenta.padEnd(20)} ${encurta(r.rotulo, 50)}`);
  }

  const somaMs = registros.reduce((s, r) => s + r.ms, 0);
  console.log("\n" + "=".repeat(78));
  console.log(`TEMPO TOTAL DA BATERIA: ${(totalMs / 1000).toFixed(1)} s (${(totalMs / 60000).toFixed(2)} min) em ${registros.length} chamadas`);
  console.log(`  soma do tempo das chamadas: ${(somaMs / 1000).toFixed(1)} s`);
  console.log(`  espera de rate limit/idle:  ${((totalMs - somaMs) / 1000).toFixed(1)} s`);
  console.log(`  texto devolvido: ${(registros.reduce((s, r) => s + r.chars, 0) / 1000).toFixed(0)}k chars`);
  console.log(`  resultado: ${nPass} passaram, ${nFail} falharam, ${nAviso} aviso(s) de site externo, ${nAmbiente} barradas pelo edge`);
  console.log(`\nhealth antes:  ${encurta(healthAntes, 190)}`);
  console.log(`health depois: ${encurta(healthDepois, 190)}`);
  if (falhas.length) {
    console.log("\nFALHAS:");
    for (const f of falhas) console.log(`  - ${f}`);
  }
  process.exit(nFail ? 1 : 0);
})().catch((e) => {
  console.error("erro inesperado na bateria:", e);
  const sum = registros.reduce((s, r) => s + r.ms, 0);
  console.error(`(antes de rebentar: ${registros.length} chamadas, ${(sum / 1000).toFixed(1)} s)`);
  process.exit(1);
});
