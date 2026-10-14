# Revisão de código — `web-reader-mcp`

Revisão feita em 14/10/2026 sobre `server.js` (1524 linhas), `package.json`, `render.yaml`, `README.md`, `test-security.mjs` e os 11 scripts em `scripts/`.

Todos os itens marcados com **[verificado]** foram reproduzidos rodando o servidor de verdade (não são dedução de leitura de código).

---

## Resumo executivo

**Nota: 6,0 / 10**

É um projeto acima da média para o que se propõe: 1524 linhas, zero dependências, implementação de MCP e de parser HTML feitas à mão, e que **de fato funciona** (o smoke-test passa as 6 ferramentas, o modo HTTP responde, o auth 401 funciona). A engenharia de transporte e resiliência está bem feita.

O que impede uma nota maior é que **o núcleo do produto — extrair texto de HTML — corrompe a saída em casos comuns**, e há um furo de segurança que só importa porque o serviço está publicado publicamente no Render.

### Os 3 maiores problemas

1. **🔴 SSRF: não há nenhuma validação de IP nem de redirect.** `validateHttpUrl()` só checa o protocolo da URL inicial e o `fetch` usa `redirect: "follow"`. Uma URL pública que devolva `302 → http://169.254.169.254/...` faz o seu servidor buscar endereço interno. **[verificado]**: `read_page` leu `http://127.0.0.1:4111/` sem nenhum bloqueio.
2. **🔴 O parser perde e corrompe conteúdo.** `<` solto no texto engole trechos inteiros ("Compare 3 < 5" virou "Compare 3"), blocos de código perdem a indentação, tabelas saem como parágrafo de pipes inválidos e entidades acentuadas pt-BR (`&ccedil;`, `&atilde;`, `&eacute;`) não são decodificadas. **[verificado]**
3. **🔴 Rate limit burlável com um header + memory leak.** O limite é chaveado por `x-forwarded-for` cru (controlado pelo cliente) e o `Map` nunca é limpo. **[verificado]**: 61 requisições rotacionando o XFF → **61× HTTP 200, zero 429**.

---

## 1. Explicação geral do projeto

### O que faz

Servidor **MCP (Model Context Protocol)** que dá a uma IA a capacidade de ler a web. A premissa é: **não existe ferramenta de busca**. A IA é que decide as URLs; o MCP só sabe abrir páginas, listar links, varrer sitemaps e fazer crawl. Isso evita API key, scraping de buscador e custo por consulta.

### Arquitetura

Projeto **flat, single-file, zero dependências**. Só há um artefato executável: `server.js`.

```
web-reader-mcp/
├── server.js            # TUDO: parser, HTTP, tools, JSON-RPC, transportes
├── package.json         # sem dependencies (só scripts)
├── render.yaml          # Blueprint do Render (health check + MCP_AUTH_TOKEN gerado)
├── README.md            # onboarding + passo a passo GitHub/Render
├── test-security.mjs    # "teste" que faz grep no server.js (ver §6)
└── scripts/             # 11 scripts e2e/debug, todos clientes MCP manuais
```

`server.js` tem 6 blocos bem delimitados por comentários:

| Bloco | Linhas | Papel |
|---|---|---|
| Constantes + tabelas de entidades | 18–80 | versão, UAs, limites, `NAMED_ENTITIES` |
| Parser HTML | 82–418 | `decodeEntities`, `findTagEnd`, `parseAttrs`, `tokenize`, `htmlToMarkdown`, `extractMeta`, `extractLinks` |
| HTTP + ferramentas | 424–1121 | `fetchText`, cache, as 6 tools |
| `TOOLS` | 1128–1239 | JSON Schema exposto ao cliente MCP |
| `handleMessage` | 1243–1313 | roteador JSON-RPC |
| Transportes | 1317–1524 | `startStdio` e `startHttp` |

### Fluxo de execução (input → output)

```
cliente MCP (IA)  --JSON-RPC-->  handleMessage(method)
                                   │
                    tools/call ────┴──> callTool(name) ──> toolReadPage(args)
                                                              │
                                            validateHttpUrl ──┤ (só valida protocolo!)
                                            fetchTextCached ──┤ (LRU+TTL 10min, retry 3x, UA rotativo)
                                            ensureHtml        │
                                            extractMeta       │
                                            htmlToMarkdown ───┤ tokenize() + regras de emissão
                                            (isDynamicPage?)  │  └─> extractEmbeddedData
                                            truncate(maxChars)│      (__NEXT_DATA__, JSON-LD, APIs internas)
                                            formatReadResult ─┘
                                                              │
                              <-- { content:[{type:"text"}] }
```

O transporte é escolhido na inicialização (linha 1509–1511): `PORT` definido → HTTP; senão → stdio. `--http` / `--stdio` forçam.

### Dependências

**Nenhuma.** Só built-ins do Node: `node:http` (import dinâmico na linha 1361), `fetch`/`AbortController`/`TextDecoder`/`URL` globais. Requer Node ≥ 18 (`package.json:9`). É um ponto genuinamente forte: deploy sem build step, sem supply chain.

---

## 2. Erros e bugs

### 🔴 C1 — SSRF: sem validação de IP e redirects seguidos cegamente

**Arquivo:** `server.js:424-435` (`validateHttpUrl`) e `server.js:446-463` (`fetch` com `redirect: "follow"`)

```js
function validateHttpUrl(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { throw new Error(`URL invalida: ${url}`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Protocolo nao suportado (${parsed.protocol}). Use http/https.`);
  }
  return parsed;   // <-- nao olha host, porta nem IP
}
```

**Por que é um problema:** é a definição de SSRF. Qualquer um que consiga chamar o MCP (com ou sem token) consegue fazer o **seu** servidor emitir requisições para a rede interna: `127.0.0.1`, RFC1918, `169.254.169.254` (metadata), portas internas. Como está no Render, isso vale para o metadata endpoint e para serviços da VPC. E pior: o resultado da requisição interna é devolvido como texto no output da tool — ou seja, **é exfiltração, não só um request cego**.

**[verificado]** — `read_page({url:"http://127.0.0.1:4111/"})` retornou o HTML do serviço local sem erro.

**Correção:** validar o IP resolvido **e** cada hop de redirect.

```js
import { lookup } from "node:dns/promises";
import net from "node:net";

const BLOCKED_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^224\./, /^255\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./, // CGNAT
];

async function assertPublicUrl(rawUrl) {
  const u = new URL(rawUrl);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Protocolo nao suportado");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = net.isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (ips.length === 0) throw new Error("Host nao resolve");
  for (const ip of ips) {
    if (net.isIP(ip) === 6) {
      const l = ip.toLowerCase();
      if (l === "::1" || l.startsWith("fe80") || /^f[cd]/.test(l) || l.startsWith("::ffff:")) {
        throw new Error(`Host bloqueado (${ip})`);
      }
      continue;
    }
    if (BLOCKED_V4.some((re) => re.test(ip))) throw new Error(`Host bloqueado (${ip})`);
  }
}
```

E trocar `redirect: "follow"` por um loop que revalida cada hop:

```js
let currentUrl = url;
let res;
for (let hop = 0; hop <= 5; hop++) {
  await assertPublicUrl(currentUrl);                 // revalida o destino
  res = await fetch(currentUrl, {
    redirect: "manual",                              // <- nao segue sozinho
    signal: controller.signal,
    headers,
  });
  const loc = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && loc) {
    currentUrl = new URL(loc, currentUrl).href;
    continue;
  }
  break;
}
if (res.status >= 300 && res.status < 400) throw new Error("Redirects em excesso");
```

> Caveat honesto: validar por DNS e depois conectar ainda deixa uma janela de DNS rebinding. O ideal é resolver o IP você mesmo e conectar nesse IP com `Host:` header — mas o `fetch` do Node não expõe isso. Para este projeto, validar IP + redirect já elimina o ataque prático.

---

### 🔴 C2 — O parser corrompe a saída em casos comuns

Todos os itens abaixo foram **[verificados]** servindo um HTML local e chamando `read_page`.

#### C2.1 — `<` solto no texto engole conteúdo

**Arquivo:** `server.js:146-151` e `162-163`

```js
const nextChar = html[lt + 1];
if (nextChar === "!" || nextChar === "?") { /* ... */ }   // so trata ! e ?
const gt = findTagEnd(html, lt);                          // qualquer outra coisa vira "tag"
const raw = html.slice(lt + 1, gt).trim();
...
const nameMatch = body.match(/^([A-Za-z][A-Za-z0-9:_-]*)/);
if (!nameMatch) continue;                                 // descarta em silencio
```

Entrada: `<p>Compare 3 < 5 e 5 > 3 neste paragrafo.</p>`
Saída real: `Compare 3 3 neste paragrafo.`

O tokenizer achou `<`, procurou o próximo `>` (que estava em `5 > 3`), o "nome de tag" começava com dígito, e **jogou fora `< 5 e 5`**. Isso acontece em toda documentação técnica, snippet, fórmula e comparação — ou seja, exatamente o caso de uso principal.

**Correção** (inserir logo antes de `const nextChar = ...`):

```js
const nextChar = html[lt + 1];
// "<" solto no texto (ex.: "3 < 5", "a <b> e <c"): nao e tag, emite como texto
if (nextChar !== "/" && nextChar !== "!" && nextChar !== "?" && !/[A-Za-z]/.test(nextChar || "")) {
  tokens.push({ type: "text", value: html.slice(i, lt + 1) });
  i = lt + 1;
  continue;
}
```

#### C2.2 — `cleanMarkdown` destrói a indentação de blocos de código

**Arquivo:** `server.js:186-193`

```js
function cleanMarkdown(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")     // <-- roda no documento INTEIRO, inclusive dentro de ```
    .replace(/\n{3,}/g, "\n\n")     // <-- colapsa linhas em branco do codigo tambem
    .trim();
}
```

Saída real de um `<pre><code>` com 4 e 8 espaços de indentação:

```
```
function x() {
 return 1;
 if (a) {
 return 2;
 }
}
```
```

Todo o aninhamento sumiu. Código colado por uma IA a partir disso fica semanticamente errado em Python, YAML, e em qualquer linguagem com blocos.

**Correção** — proteger os blocos cercados antes de normalizar:

```js
function cleanMarkdown(text) {
  const blocks = [];
  const masked = text.replace(/```[\s\S]*?```/g, (m) => `\u0000${blocks.push(m) - 1}\u0000`);
  const cleaned = masked
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}
```

#### C2.3 — Tabelas não são tabelas markdown

**Arquivo:** `server.js:236-241` (abertura) e `301-303` (fechamento)

```js
case "th": case "td":
  out += " ";      // abertura
...
case "th": case "td":
  out += " |";     // fechamento
```

Saída real de `<table><tr><th>Nome</th><th>Valor</th></tr>...`:

```
 Nome | Valor |

 A | 1 |

 B | 2 |
```

Não há `|` inicial nem a linha separadora `|---|---|`, então o GFM não reconhece como tabela — vira parágrafo. O comentário na linha 195 promete "tabelas".

**Correção** — montar a linha completa e inserir o separador após a linha de header:

```js
let rowCells = 0;
let rowIsHeader = false;

// abertura
case "tr": out += "\n|"; rowCells = 0; rowIsHeader = false; break;
case "th": rowIsHeader = true; break;
case "td": break;

// fechamento
case "th": case "td": out += " " + cell + " |"; rowCells++; break;
case "tr":
  out += "\n";
  if (rowIsHeader && rowCells > 0) out += "|" + " --- |".repeat(rowCells) + "\n";
  break;
```

#### C2.4 — Entidades acentuadas pt-BR não são decodificadas

**Arquivo:** `server.js:61-80`

A tabela cobre `&copy;`, `&hellip;`, `&euro;`… mas **não tem uma única letra acentuada**. Saída real: `Acentuacao: &ccedil;&atilde;o &eacute; & fim.`

**Correção** — adicionar o bloco Latin-1/Portuguese:

```js
  // Latin-1 / acentos (pt-BR)
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ",
  ccedil: "ç", egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
  igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü",
  yacute: "ý", yuml: "ÿ", szlig: "ß", oelig: "œ", apos: "'",
```

---

### 🔴 C3 — Rate limit burlável com um header + memory leak

**Arquivo:** `server.js:1436-1457`

```js
const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
const now = Date.now();
const requests = (rateLimitMap.get(clientIp) || []).filter((t) => t > windowStart);
if (requests.length >= RATE_LIMIT_MAX) { /* 429 */ }
requests.push(now);
rateLimitMap.set(clientIp, requests);
```

Dois problemas:

1. **`x-forwarded-for` é controlado pelo cliente.** O atacante manda um valor diferente a cada request e cada um vira um bucket novo. **[verificado]**: 61 requests com XFF fixo → o 61º deu 429 (correto); 61 requests rotacionando `10.0.0.N` → **61× 200, zero 429**.
2. **`rateLimitMap` nunca é limpo.** Cada chave nova fica no Map para sempre, com um array de timestamps. Combinado com (1), é crescimento de memória arbitrário controlado por quem chama.

**Correção** — usar o hop confiável do XFF (o último é o que o seu proxy anexou) e adicionar GC:

```js
// Render fica na frente do app: o IP real vem no FIM do XFF (o inicio e forjavel)
const xff = String(req.headers["x-forwarded-for"] || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const clientIp = (xff.length ? xff[xff.length - 1] : req.socket.remoteAddress) || "unknown";

// GC periodico: sem isso o Map cresce pra sempre
const gcTimer = setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, times] of rateLimitMap) {
    const kept = times.filter((t) => t > cutoff);
    if (kept.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, kept);
  }
}, RATE_LIMIT_WINDOW_MS);
gcTimer.unref();
```

> Melhor ainda para este caso: o serviço é autenticado, então **limitar por token** faz mais sentido do que por IP — não depende de header nenhum.

---

### 🟠 I1 — Cache em memória sem limite de bytes (risco de OOM)

**Arquivo:** `server.js:26`, `537-555`

`CACHE_MAX_ENTRIES = 100` com `MAX_RESPONSE_BYTES = 10MB` por página. Pior caso: **~1 GB de HTML em memória**, num plano Render free de 512 MB. O limite é por *quantidade de entradas*, não por tamanho.

```js
const CACHE_MAX_BYTES = 64 * 1024 * 1024;   // 64MB
let cacheBytes = 0;

async function fetchTextCached(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    pageCache.delete(url); pageCache.set(url, hit);        // LRU touch
    return hit.payload;
  }
  const payload = await fetchTextWithFallback(url, { timeoutMs });
  // nao guarda paginas gigantes: envenenam o cache sem trazer beneficio
  if (payload.text.length <= 2 * 1024 * 1024) {
    pageCache.set(url, { at: Date.now(), payload });
    cacheBytes += payload.text.length;
    while (cacheBytes > CACHE_MAX_BYTES && pageCache.size > 0) {
      const oldest = pageCache.keys().next().value;
      cacheBytes -= pageCache.get(oldest).payload.text.length;
      pageCache.delete(oldest);
    }
  }
  return payload;
}
```

Aproveitar para baixar `MAX_RESPONSE_BYTES` de 10 MB para ~3 MB: 10 MB de HTML viram dezenas de MB de tokens, e nenhum consumidor deste MCP aproveita isso.

---

### 🟠 I2 — `read_dynamic_page` duplica o cabeçalho inteiro

**Arquivo:** `server.js:836-847`

```js
if (dynamicMarkdown) {
  const fullText = `# ${meta.title || "(sem titulo)"}\nURL: ${finalUrl}\nPagina dinamica — dados extraidos do HTML embutido:\n\n${dynamicMarkdown}`;
  const { text, truncated } = truncate(fullText, maxChars);
  return formatReadResult({
    finalUrl, meta, text, truncated,
    fullLength: fullText.length,
    extraLabel: "Pagina dinamica — dados extraidos do HTML embutido",   // <-- e ele adiciona de novo
  });
}
```

`formatReadResult` (`server.js:579-594`) já emite `# titulo`, `URL:` e `extraLabel`. Como `fullText` também traz tudo isso, o resultado sai assim **[verificado]**:

```
# Dyn
URL: http://127.0.0.1:4111/dyn
Pagina dinamica — dados extraidos do HTML embutido
Conteudo: 190 caracteres

# Dyn
URL: http://127.0.0.1:4111/dyn
Pagina dinamica — dados extraidos do HTML embutido:

## __NEXT_DATA__
- **props**:
  ...
```

Além de feio, queima tokens do cliente e o `fullLength` reportado fica errado (conta o cabeçalho duplicado).

**Correção:**

```js
if (dynamicMarkdown) {
  const { text, truncated } = truncate(dynamicMarkdown, maxChars);
  return formatReadResult({
    finalUrl, meta, text, truncated,
    fullLength: dynamicMarkdown.length,
    extraLabel: "Pagina dinamica — dados extraidos do HTML embutido",
  });
}
```

---

### 🟠 I3 — `tryInternalApi` dispara requisições sem limite

**Arquivo:** `server.js:775-807`

```js
const candidates = new Set();
for (const re of apiPatterns) { /* ... */ }     // sem teto: quantos matches o HTML tiver
...
for (const path of candidates) {                 // sequencial, timeout de 25s CADA
  const { text, contentType } = await fetchTextCached(url, { timeoutMs });
```

Uma página com 200 strings `/api/...` gera 200 requisições sequenciais, cada uma com até 25 s de timeout. E isso não é chamada explícita: `toolReadPage` (`server.js:614`) chama `extractEmbeddedData` **automaticamente** sempre que o markdown tiver menos de 300 caracteres — ou seja, uma página curta qualquer pode virar centenas de requests.

**Correção:**

```js
const MAX_API_CANDIDATES = 5;
const API_TIMEOUT_MS = 4000;

const lista = [...candidates].slice(0, MAX_API_CANDIDATES);
const settled = await Promise.allSettled(
  lista.map(async (path) => {
    const url = path.startsWith("http") ? path : `${origin}${path}`;
    if (hostOf(url) !== baseHost) return null;
    const { text, contentType } = await fetchTextCached(url, { timeoutMs: API_TIMEOUT_MS });
    return contentType && /json/.test(contentType) ? { url, data: text.slice(0, 5000) } : null;
  })
);
return settled.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
```

---

### 🟠 I4 — O transporte HTTP não cumpre a spec do MCP

**Arquivo:** `server.js:1459-1463` (GET → 405) e `1490-1494` (resposta)

A spec *Streamable HTTP* exige:

- Header **`Mcp-Session-Id`** na resposta do `initialize` (o cliente devolve nas chamadas seguintes). Aqui não é emitido em lugar nenhum.
- `GET /mcp` com `Accept: text/event-stream` abre o stream SSE. Aqui retorna 405.
- `Accept: application/json, text/event-stream` no request.

Um cliente MCP estrito (SDK oficial) pode recusar a conexão. Clientes tolerantes aceitam — mas é uma incompatibilidade real, não hipotética.

**Correção mínima** (session id + expor o header no CORS):

```js
import { randomUUID } from "node:crypto";
const sessionId = randomUUID();
...
res.writeHead(200, {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "mcp-session-id": sessionId,
  "access-control-expose-headers": "mcp-session-id",
});
```

E aceitar `GET /mcp` com `Accept: text/event-stream` respondendo um stream SSE (mesmo que vazio, com keep-alive), em vez de 405.

---

### 🟠 I5 — Sem teto de saída total nas tools de múltiplas páginas

**Arquivo:** `server.js:863` (`limit` 200), `896` (`maxChars` até 50000), `921-923` (join de tudo)

`read_multiple_pages` aceita 30 URLs × `maxChars` 50000 = **1,5 milhão de caracteres** numa única resposta. `crawl_site` tem o mesmo padrão. Não existe orçamento total, só por página. Isso estoura o contexto de qualquer LLM e o corpo da resposta HTTP.

**Correção:**

```js
const TOTAL_OUTPUT_BUDGET = 200_000;                       // teto global
const porPagina = Math.min(maxChars, Math.floor(TOTAL_OUTPUT_BUDGET / urls.length));
```

E, em paralelo, um deadline global: com 30 páginas, concorrência 6 e timeout de 25 s, o pior caso é ~125 s — acima do timeout de vários clientes MCP. Um `AbortSignal` com prazo total resolve.

---

### 🟠 I6 — `readBody`: corpo grande vira "Parse error" e escreve em socket destruído

**Arquivo:** `server.js:1373-1388` e `1465-1475`

```js
if (size > 2_000_000) {
  reject(new Error("corpo muito grande"));
  req.destroy();          // <-- destroi o socket
  return;
}
...
} catch {
  res.writeHead(400, { "content-type": "application/json" });   // <-- 400 "Parse error"
  res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, ... } }));
}
```

Dois defeitos: (a) o cliente recebe **`-32700 Parse error` / 400** quando o problema real é payload grande — devia ser **413**; (b) depois de `req.destroy()` o `catch` tenta escrever na resposta de um socket já destruído, o que pode emitir erro de stream.

**Correção:**

```js
} catch (err) {
  if (res.writableEnded || res.destroyed) return;
  const tooBig = err && /corpo muito grande/.test(err.message);
  res.writeHead(tooBig ? 413 : 400, { "content-type": "application/json" });
  res.end(JSON.stringify({
    jsonrpc: "2.0", id: null,
    error: { code: tooBig ? -32600 : -32700, message: tooBig ? "Payload muito grande (max 2MB)" : "Parse error" },
  }));
  return;
}
```

---

### 🟠 I7 — `extract_links` ignora `<nav>`, `<header>` e `<footer>`

**Arquivo:** `SKIP_TAGS` em `server.js:55-59`, usado por `extractLinks` em `server.js:378-386`

```js
const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "canvas", "iframe",
  "object", "audio", "video", "nav", "header", "footer", "aside", "form",   // <-- links somem aqui
  "head", "select", "button",
]);
```

Para gerar markdown isso está certo (tira menu e rodapé). Mas `extractLinks` usa o **mesmo** conjunto, então em sites que colocam a navegação principal em `<nav>` ou `<header>` a ferramenta devolve muito menos links do que existem. O README promete "lista os links da página" e o `discover_urls` depende disso no fallback (`server.js:988`).

**Correção** — dois conjuntos:

```js
// conteudo inutil para markdown
const SKIP_TAGS = new Set([...]);

// para extracao de links so o que nao contem links uteis
const SKIP_TAGS_LINKS = new Set([
  "script", "style", "noscript", "template", "svg", "canvas", "iframe", "head", "select",
]);
```

E `extractLinks` usa `SKIP_TAGS_LINKS`.

---

### 🟠 I8 — Sem `robots.txt` e sem respeitar `Retry-After`

`crawl_site` (`server.js:1028`) e `discover_urls` (`server.js:928`) varrem sites sem consultar `/robots.txt`. O `fetchText` (`server.js:482-484`) retenta 429 com backoff fixo `400 * 2**attempt`, **ignorando o header `Retry-After`** que o servidor mandou — o que costuma piorar o bloqueio.

Mínimo viável: ler `robots.txt` uma vez por host, cachear, e não seguir `Disallow` no crawl; e em 429 respeitar `Retry-After` (com teto).

---

### 🟡 Bugs menores

| Item | Local | Problema |
|---|---|---|
| Retry em 401/403 | `server.js:482` | Retentar autenticação negada 2× com outro UA só aumenta a chance de ban. Só 429/500/502/503/504 deveriam ser retriáveis. |
| `published.slice(0, 25)` | `server.js:357` | Trunca data em 25 chars arbitrários; pode cortar ISO 8601 válido. |
| `window.__INITIAL_STATE__` | `server.js:703-705` | Exige `}` imediatamente antes de `</script>`; falha se houver código depois do objeto. |
| `extractPrimitives` no Nuxt 3 | `server.js:721-737` | No payload `(function(a,b){return {...}})(...)` o regex captura pares de chave dos parâmetros da função → lixo no output. |
| `openStack` é código morto | `server.js:200, 219, 285-290` | É mantido e truncado, mas nunca é lido para nada. Sugere que o auto-fechamento de tags órfãs foi planejado e não implementado. |
| `<a>` aninhado / não fechado | `server.js:387-393` | `current` é sobrescrito sem tratar o anterior → link perdido em HTML malformado. |
| `isNavigationUrl` filtra demais | `server.js:1005-1026` | `\/api\/`, `\/about`, `\/archive` e `/\/#.*$/` casam contra a URL inteira; `/about-us-our-history` é descartado. Deveria casar só contra `pathname` e com segmento ancorado. |
| Listas ordenadas viram `-` | `server.js:233-234` | `<ol>` produz `- ` igual a `<ul>`; listas aninhadas achatam. |
| `blockquote` multi-linha | `server.js:230-232` | Só a primeira linha ganha `> `. |
| `tokenize` materializa tudo | `server.js:131-173` | Array de todos os tokens de um documento de até 10 MB → pico de memória e GC. Um iterador generator resolveria. |
| Tokenização dupla no crawl | `server.js:1062-1064` | `htmlToMarkdown` e `extractLinks` chamam `tokenize(html)` cada um. |
| Comparação de token não é constant-time | `server.js:1419` | `token !== AUTH_TOKEN`. Usar `crypto.timingSafeEqual`. |
| `uncaughtException` não encerra | `server.js:1513-1515` | Só loga e segue rodando em estado indefinido. O correto é logar e `process.exit(1)`. |
| Sem SIGTERM | `server.js:1497` | Render manda SIGTERM no deploy; sem handler, requisições em voo são cortadas. |
| Versões divergentes | `package.json:3` = 1.0.0, `server.js:19` = 1.1.0, `README.md:150` = v1.0.0, `server.err` = v1.0.0 | Quatro fontes de verdade. |

---

## 3. Furos e pontos fracos

**Tratamento de erro: razoável, não ótimo.**
O ponto forte: em `read_multiple_pages` cada URL falha isolada (`server.js:906-912`) e o erro vira conteúdo, não exceção — o cliente recebe "29/30 OK". Isso está certo.
O que falta: não há retry por página, não há distinção entre "falhou por anti-bot", "falhou por timeout" e "404" no resumo final, e o `crawl_site` mistura páginas OK e erros no mesmo array de texto (`server.js:1084-1093`) — o cliente tem que parsear string para saber o que falhou.

**Estados vazios e inputs hostis.**

- `read_page` numa página que é só `<div id="root"></div>` (SPA) devolve "Pagina dinamica detectada, mas nao foi possivel extrair dados embutidos" — honesto, mas não sugere próximo passo ao cliente. Vale emitir uma dica (`tente outra URL, ou use extract_links`).
- `args.url` ausente → `validateHttpUrl(undefined)` → `new URL("undefined")` falha → "URL invalida: undefined". Funciona, mas a mensagem não diz que o parâmetro é obrigatório.
- `read_multiple_pages` aceita a mesma URL 30 vezes (o próprio smoke-test faz isso em `scripts/smoke-test.mjs:140`): são 30 seções idênticas na saída, queimando o orçamento de saída. Falta dedupe.
- `maxChars` negativo, `NaN` ou string são tratados por `clampMaxChars` — bom.
- O parser não tem teste de fuzzing; HTML malformado é a regra na web e o comportamento atual é "descartar em silêncio" (C2.1).

**Funcionalidades inconsistentes.**

- `read_dynamic_page` e `read_page` fazem praticamente a mesma coisa (o `read_page` já chama `extractEmbeddedData` sozinho em `server.js:614`). São duas ferramentas com 90% de sobreposição e contratos de saída diferentes — o que confunde o LLM na hora de escolher.
- `extract_links` lista links mas não diz nada sobre `rel=nofollow`, `target` ou se o link está visível.
- Não existe paginação: `discover_urls` devolve no máximo 300 URLs e não há como pedir a página 2.

---

## 4. Segurança

### O que está bom (e é bom de verdade)

- **Nenhum segredo commitado.** Varri o repositório: nenhum token, key ou senha em código, README ou YAML. `render.yaml:19-20` usa `generateValue: true`, ou seja, o Render gera o token e ele nunca passa pelo repositório. Certo.
- **`resolveUrl` bloqueia esquemas perigosos** (`server.js:178`): `javascript:`, `data:`, `file:`, `ftp:`, `mailto:`, `tel:`. Isso é o que impede XSS quando o markdown é renderizado a jusante.
- **`eval()` foi removido de verdade** e substituído por `extractPrimitives` (`server.js:721`), que faz parsing por regex sem executar código. Foi a correção certa.
- **`jsonToMarkdown` protege contra referência circular e profundidade** (`server.js:741-771`) — inclusive com `finally { seen.delete(data) }`, que é o detalhe que quase todo mundo erra.
- **Auth com Bearer + 401** funciona e está testado em dois lugares (`scripts/smoke-test.mjs:206-217` e `scripts/live-test.mjs:57-76`).

### Vulnerabilidades

| # | Severidade | Vulnerabilidade | Local |
|---|---|---|---|
| 1 | 🔴 | **SSRF** — sem validação de IP nem de redirect. Permite ler rede interna e exfiltrar o resultado. | `server.js:424-435`, `446-463` |
| 2 | 🔴 | **Rate limit burlável** via `x-forwarded-for` forjado; combinado com Map sem GC = DoS de memória. | `server.js:1437-1457` |
| 3 | 🟠 | **OOM remoto** — cache de até ~1 GB com 100 entradas de 10 MB. | `server.js:26`, `537-555` |
| 4 | 🟠 | **Amplificação** — uma chamada a `read_page` pode disparar centenas de requisições internas. | `server.js:775-807`, `614` |
| 5 | 🟠 | **CORS `*` em endpoint autenticado.** `access-control-allow-origin: *` + `allow-headers: authorization` deixa qualquer site chamar o MCP do browser se o token estiver no cliente. O README já diz "nunca chame do browser" (`README.md:215`), mas o servidor não impede. | `server.js:1393-1398`, `1490-1494` |
| 6 | 🟡 | **Comparação de token não constant-time** (timing attack teórico). | `server.js:1419` |
| 7 | 🟡 | **Auth é opcional e falha aberta.** Se `MCP_AUTH_TOKEN` não existir, o endpoint fica público sem nenhum aviso no boot. | `server.js:1366`, `1415` |
| 8 | 🟡 | **Cache compartilhado entre clientes** no modo HTTP: a página lida pelo cliente A é servida ao cliente B. Baixo impacto (é web pública), mas é vazamento de padrão de uso. | `server.js:539` |
| 9 | 🟡 | **Sem `robots.txt`** em `crawl_site`/`discover_urls` — risco legal/ético e de bloqueio. | `server.js:928`, `1028` |
| 10 | 🟡 | **`validateHttpUrl` aceita `http://user:pass@host`** — credenciais na URL seriam enviadas e podem vazar em logs. | `server.js:424` |

**Sobre o #7:** vale adicionar no boot:

```js
if (!AUTH_TOKEN) {
  console.error(`[${SERVER_NAME}] AVISO: MCP_AUTH_TOKEN nao definido — o endpoint /mcp esta ABERTO.`);
}
```

---

## 5. Performance

**O que já está bom:** cache LRU+TTL (`server.js:541`), lotes paralelos com concorrência 6 em vez de 30 (`server.js:901`), retry com backoff exponencial, `AbortController` por requisição, e preservação da ordem de saída apesar do paralelismo (`server.js:914-916`). Isso é cuidado real.

**Gargalos identificados:**

| # | Impacto | Problema | Sugestão |
|---|---|---|---|
| P1 | Alto | `tokenize` materializa um array com todos os tokens de páginas de até 10 MB. | Transformar em generator (`function* tokenize()`), consumido por `for...of`. Zero mudança de lógica. |
| P2 | Alto | `tryInternalApi` sequencial, até centenas de requests de 25 s. | Cap de 5 candidatos + `Promise.allSettled` + timeout de 4 s (ver I3). |
| P3 | Médio | `crawl_site` tokeniza cada página **duas vezes** (`htmlToMarkdown` + `extractLinks`). | `htmlToMarkdown` pode devolver também os links que já encontrou no mesmo passe. |
| P4 | Médio | `cleanMarkdown` roda 4 regex sobre o documento inteiro, inclusive dentro de `pre`. | Já resolvido ao corrigir C2.2 (mascarar blocos antes). |
| P5 | Médio | Sem deadline global: 30 páginas podem levar ~125 s. | `AbortSignal` com prazo total + teto de saída (I5). |
| P6 | Baixo | `isDynamicPage` recomputa `markdown.replace(/\s+/g," ")` que o caller já calculou (`server.js:614` vs `664`). | Passar `visibleText` já computado. |
| P7 | Baixo | Sem compressão na resposta HTTP (Render faz na borda, ok) e sem `ETag`. | Não crítico. |

Nenhum problema de re-render, imagem ou import pesado — é backend, e o único "import pesado" é `node:http`, carregado dinamicamente. Está bom.

---

## 6. Qualidade do código

**O problema estrutural número um: `server.js` tem 1524 linhas, não exporta nada e mistura 4 responsabilidades.** Consequências concretas:

1. **Não é testável.** Não dá pra `import { htmlToMarkdown }` — porque o módulo, ao ser importado, sobe um servidor (`server.js:1520-1524`). É por isso que existem 4 scripts `debug-*.mjs` que **copiam** as funções do server. E eles **já divergiram**:

   - `server.js:125`: `attrs[...] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "")`
   - `scripts/debug-html-to-markdown.mjs:76`: `attrs[...] = m[2] ?? m[3] ?? m[4] ?? ""` — **sem `decodeEntities`**

   Ou seja: o "teste" roda contra uma versão do parser que não é a de produção. Duplicação que já quebrou na prática, não é risco teórico.

2. **`test-security.mjs` não testa nada.** Ele lê `server.js` como texto e procura substrings:

   ```js
   const evalCount = (code.match(/\beval\s*\(/g) || []).length;
   ...
   if (code.includes('referência circular') && code.includes('seen.has(data)')) { /* OK */ }
   ```

   Isso passa mesmo se as funções estiverem quebradas — valida a *presença de comentários*, não o comportamento. Pior: **só o check 1 chama `process.exit(1)`** (`test-security.mjs:9-12`); os checks 2 a 5 imprimem "⚠️ não encontrada" e o script termina com **"✅ Todas as correções de segurança aplicadas!"**. É um teste que mente. Ele também lê `'./server.js'` relativo ao CWD (`test-security.mjs:4`), então quebra se executado de outro diretório, e não está em `npm test`.

3. **`openStack`** (`server.js:200`) é mantido, truncado e nunca lido: código morto que dá a falsa impressão de que tags órfãs são tratadas.

**Refatoração sugerida** (mantém zero deps):

```
lib/html.js     -> decodeEntities, tokenize, htmlToMarkdown, extractMeta, extractLinks, cleanMarkdown  (exporta)
lib/extract.js  -> isDynamicPage, extractJsonLd, extractWindowState, extractPrimitives, jsonToMarkdown (exporta)
lib/http.js     -> fetchText, fetchTextCached, decodeBuffer, assertPublicUrl                            (exporta)
lib/tools.js    -> as 6 tools                                                                          (exporta)
server.js       -> só TOOLS, handleMessage, startStdio, startHttp                                       (~300 linhas)
test/parser.test.mjs -> node:test puro, offline, sem rede
```

Com isso, `npm test` roda em 200 ms sem internet e cobre exatamente os casos que hoje estão quebrados (C2.1 a C2.4) — os fixtures do HTML de teste viram testes de regressão permanentes.

**Outros pontos:**

- `package.json` sem `"test"` offline: hoje `npm test` → `scripts/smoke-test.mjs`, que depende de rede e de `example.com`/`pt.wikipedia.org` responderem. Fica vermelho por motivo errado. Separar em `test` (unit, offline) e `test:e2e` (rede).
- Sem linter. Mínimo: `"lint": "node --check server.js"`, ideal: ESLint + Prettier.
- Sem CI (`.github/workflows/`). Com o split acima, um workflow de 15 linhas que roda `node --test` já protege as regressões.
- **Sem `.gitignore`.** `git ls-files` confirma que não existe. `server.log` e `server.err` estão soltos na raiz do projeto (untracked por sorte, não por regra). Se o Playwright entrar um dia, `node_modules/` sobe junto — o próprio README alerta sobre isso (`README.md:72`) em vez de resolver.
- `scripts/debug-*.mjs` (4 arquivos) são cópias do server e devem sair do repositório depois do split.
- `scripts/popular-sites-test.mjs:103` e `scripts/test-youtube.mjs:18` usam `spawn("node")` em vez de `process.execPath` — quebra se o `node` não estiver no PATH. E `popular-sites-test.mjs` não tem timeout no `send()`, então trava para sempre se o servidor não responder.
- `scripts/benchmark.mjs:97` e `scripts/smoke-test.mjs:96` fixam "30" e "6" em regex/assert; quebra silenciosamente se o limite mudar.

---

## 7. UI/UX e acessibilidade

**Não se aplica** — não há front-end. É um servidor MCP sobre stdio/HTTP.

O análogo mais próximo é a **experiência do consumidor das tools (o LLM)**, e aí há pontos válidos:

- **Saída duplicada** em `read_dynamic_page` (I2) queima contexto e confunde.
- **`read_page` e `read_dynamic_page` se sobrepõem** — dois caminhos para o mesmo resultado com formatos diferentes. O LLM não tem como decidir bem.
- **Mensagens de erro não são acionáveis.** "A resposta nao parece ser HTML." não diz o que fazer. "Pagina dinamica detectada, mas nao foi possivel extrair dados embutidos" deveria sugerir o próximo passo.
- **`extract_links` devolve texto formatado para humanos** (`1. texto\n   url (interno)`), não JSON. Um LLM precisa re-parsear isso. Para uma ferramenta consumida por máquina, devolver `structuredContent` (ou JSON no `text`) seria melhor.
- **Boas notícias:** o `instructions` do `initialize` (`server.js:1263-1266`) e as `description` das tools são claras e explicam a ausência de busca — isso é acima da média.

---

## 8. Melhorias e próximos passos

**Correções estruturais (fazer antes de qualquer feature nova):**

1. Split de `server.js` em `lib/*` com exports — habilita todo o resto.
2. Suíte `node:test` offline para o parser, com fixtures dos casos de C2.
3. `assertPublicUrl` + redirect manual (C1).
4. Rate limit por token + GC do Map (C3).
5. Cache com teto em bytes (I1).
6. Substituir `test-security.mjs` por testes reais.

**Features que fariam sentido:**

- **`read_page` com `format: "json" | "markdown"`** devolvendo `structuredContent` — hoje a IA precisa parsear texto.
- **`search_within_page(url, termo)`** — devolve o trecho em volta do termo. Hoje a IA lê 8000 chars para achar uma frase.
- **Paginação em `discover_urls`** (`offset`) e dedupe em `read_multiple_pages`.
- **Cache de conteúdo por hash** para o `crawl_site` não reler páginas idênticas.
- **Suporte a `Accept-Language` configurável** por chamada.
- **Modo `--json-logs`** para observar taxa de bloqueio por site.
- **Playwright de verdade** (opcional, atrás de flag) para o caso SPA. Hoje o README promete isso e o código não faz — ver abaixo.

**Documentação — o README tem afirmações falsas e precisa ser corrigido:**

| README | Realidade |
|---|---|
| Linha 17: `read_dynamic_page` = "Playwright, instalação opcional" | **Não existe Playwright em nenhum lugar do código.** A ferramenta usa extração de dados embutidos. |
| Linhas 230-240: seção inteira "read_dynamic_page (opcional)" com `npm install playwright` e "a ferramenta responde com um erro explicando como instalar" | Falso. O código responde com conteúdo estático + aviso, não com instrução de instalação. |
| Linha 245: "truncado em 5000 caracteres por padrão" | O padrão é **8000** (`server.js:23`). |
| Linhas 66-70: árvore de arquivos com 3 scripts | Existem **11** scripts. |
| Linha 150: "deve voltar `web-reader-mcp v1.0.0 OK`" | A versão real é **1.1.0** (`server.js:19`). |
| `render.yaml:9-11`: comentários sobre instalar Playwright no build | Código morto de configuração. |

O README é bom como onboarding (o passo a passo de GitHub/Render é ótimo), mas documenta um produto que não existe. Isso é pior que documentação ausente: induz o próximo desenvolvedor ao erro.

---

## Lista priorizada do que corrigir primeiro

**Agora (antes de qualquer coisa):**

1. **SSRF** — `assertPublicUrl` + `redirect: "manual"` com revalidação por hop. É o único item que é uma vulnerabilidade explorável remotamente com impacto real. (`server.js:424`, `461`)
2. **Rate limit** — usar o hop confiável do XFF (ou limitar por token) + GC do Map. (`server.js:1437-1457`)
3. **Parser perde conteúdo** — o fix do `<` solto em `tokenize` (C2.1). É 4 linhas e resolve perda silenciosa de texto em toda página técnica. (`server.js:146`)
4. **Cache sem teto em bytes** — evita crash do processo. (`server.js:537-555`)

**Depois (esta semana):**

5. `cleanMarkdown` protegendo blocos de código (C2.2) e entidades acentuadas pt-BR (C2.4).
6. Tabelas GFM válidas (C2.3).
7. Cabeçalho duplicado em `read_dynamic_page` (I2).
8. Cap de 5 candidatos + paralelismo em `tryInternalApi` (I3).
9. Teto de saída total em `read_multiple_pages` / `crawl_site` (I5).
10. `readBody`: 413 em vez de "Parse error" + guarda de socket destruído (I6).
11. **Split de `server.js` em `lib/*`** e suíte `node:test` offline com fixtures dos bugs acima.

**Depois disso:**

12. `Mcp-Session-Id` + `GET /mcp` com SSE (I4).
13. `SKIP_TAGS_LINKS` para o `extract_links` (I7).
14. `robots.txt` + `Retry-After` (I8).
15. Deletar `test-security.mjs` e `scripts/debug-*.mjs`; adicionar `.gitignore` (`node_modules/`, `*.log`, `*.err`, `demo-output.txt`, `.env`).
16. Reescrever a seção do Playwright no README e corrigir versão/limites/árvore de arquivos.
17. CI no GitHub Actions rodando `node --test` + `node --check`.
18. Rate limit por token, comparação constant-time, aviso no boot sem token, handler de SIGTERM.

---

## O que está bom (e não precisa mexer)

- Zero dependências de verdade, com MCP e parser implementados à mão — e funcionando.
- Semântica do JSON-RPC correta: notificações sem `id` ignoradas, códigos `-32700`/`-32601`/`-32603`, `isError: true` em falha de tool.
- Isolamento de falha por URL no `read_multiple_pages` — o ponto mais bem resolvido do código.
- `AbortController`, retry com backoff, UA rotativo, cache LRU+TTL: resiliência acima do esperado.
- `jsonToMarkdown` com proteção de circularidade e profundidade, e o `finally` que remove do `seen`.
- `resolveUrl` bloqueando `javascript:`/`data:`/`file:`.
- Nenhum segredo no repositório; `generateValue` no Render para o token.
- Testes e2e reais que exercitam o limite de 30 URLs, os 401 e o modo HTTP.
