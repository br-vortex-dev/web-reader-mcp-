# Relatório da rodada 2 — web-reader-mcp

Data: 14/10/2026
Ponto de partida: `b6f9c9d` (fim da rodada 1). `server.js`: **1887 → 2207 linhas**. Zero dependências novas (só `node:crypto`, built-in). Total: 11 arquivos, +1328/−113.

| Commit | Item |
| --- | --- |
| `0824573` | 1. Cache com teto em bytes |
| `1a56035` | 2. Falha do crawl não pode parecer resultado vazio |
| `2d8392b` | correção do teste da rodada 1 que travava o bug do item 2 |
| `6e0a62c` | 3. `tryInternalApi` com teto e orçamento |
| `e31a673` | 4. Cabeçalho duplicado no `read_dynamic_page` |
| `7b3dfe9` | 5. Robustez: 413, token, SIGTERM, `Retry-After`, `.gitignore` |
| `5f04bb4` | correção da corrida no 413 (RST perdia a resposta) |
| `60f8fff` | 6. README |

---

## 1. Cache com teto em bytes

**Onde:** `server.js:924-1000` (config, `cacheDelete`/`cacheSet`/`cacheStats`, varredura), `server.js:785-810` (`readBodyWithLimit`), `server.js:33-44` (constantes), `/health` em `server.js:2004`.

### Antes / depois (heap vivo, com GC forçado, 80 páginas distintas de ~2 MB)

```
ANTES                                              DEPOIS
7,4 MB  (1 pagina pequena)                         7,5 MB
48,5 MB  apos  25 paginas   (delta  41,1 MB)       48,6 MB  (delta  41,2 MB)
90,3 MB  apos  50 paginas   (delta  82,9 MB)       73,6 MB  (delta  66,1 MB)  <- platô
115,4 MB apos  65 paginas   (delta 108,0 MB)       73,7 MB  (delta  66,2 MB)
140,5 MB apos  80 paginas   (delta 133,1 MB)       73,7 MB  (delta  66,2 MB)
GET /health -> "web-reader-mcp v1.1.0 OK"          GET /health -> "... | cache: 38 entradas,
                                                   66414918 bytes / 67108864 bytes (...)"
```

O "antes" cresce ~1,7 MB por página de 2 MB e **não para**; o "depois" estabiliza no teto de 64 MB. O `/health` antes não dizia nada sobre o cache.

### O que mudou

- **`CACHE_MAX_BYTES` (padrão 64 MB)** além do teto de contagem. Contabilidade em bytes centralizada em `cacheDelete`/`cacheSet`, atualizada em **toda** remoção: despejo, expiração (inclusive a encontrada no `get`), e sobrescrita da mesma chave (`cacheSet` chama `cacheDelete` antes de inserir, senão contaria duas vezes).
- **Despejo LRU** até caber nos dois tetos, com guarda para não despejar a entrada recém-inserida quando ela é a única.
- **Entrada grande demais não entra no cache** (mas é devolvida normalmente): o limite é `min(CACHE_MAX_BYTES/4, MAX_RESPONSE_BYTES/2)` = **5 MB** com os padrões. O segundo termo existe porque só `1/4 do teto` daria 16 MB — maior que o download máximo de 10 MB, ou seja, **a regra nunca dispararia**.
- **Varredura periódica** das entradas expiradas (`.unref()`), que seguravam bytes até serem tocadas.
- **Corpo lido em streaming com corte** (`readBodyWithLimit`): antes o `res.arrayBuffer()` carregava a resposta inteira na memória para **só depois** conferir o teto — o limite não protegia nada. Agora corta e cancela o reader assim que passa.
- **`MAX_RESPONSE_BYTES` e `FETCH_CONCURRENCY` configuráveis.** Concorrência já era 6; agora é ajustável e está documentada, junto com a conta de memória: 64 MB (cache) + 6 × 10 MB (pico simultâneo) = 124 MB num plano de 512 MB.
- **`CACHE_TTL_MS` configurável** — acrescentado para dar para testar o caminho de expiração.

---

## 2. Falha do crawl não pode parecer resultado vazio

**Onde:** `server.js:1527-1545` (`classifyFetchError`), `server.js:1547-1567` (`crawlOnePage`), `server.js:1569-1660` (`toolCrawlSite`).

```
ANTES
  crawl_site(127.0.0.1) -> isError=false
  "Crawl de http://127.0.0.1:4211/: 0 paginas lidas (limite 3, dominio 127.0.0.1).
   # Erro ao ler http://127.0.0.1:4211/"
   ^ a IA nao distingue "site vazio" de "site bloqueado"

DEPOIS
  crawl_site(127.0.0.1) -> isError=true
  "Erro: Nao foi possivel iniciar o crawl em http://127.0.0.1:4211/:
   Host bloqueado: endereco privado/interno (127.0.0.1)"
```

### O que mudou

- **Pre-flight da URL inicial:** `crawlOnePage` lança e o `toolCrawlSite` propaga. Se a URL inicial falha (bloqueio SSRF, DNS, timeout, HTTP), é `isError: true` — não "0 páginas lidas".
- **Falha no meio do crawl continua isolada** (uma página ruim não derruba o crawl), mas o cabeçalho passa a marcar resultado parcial com os motivos agrupados:
  `RESULTADO PARCIAL: 3 pagina(s) falharam — 1 com HTTP 404, 1 com timeout, 1 com conteudo nao-HTML.`
- **`classifyFetchError`** agrupa: bloqueio interno, timeout, DNS, `HTTP <status>`, conexão recusada, não-HTML, resposta grande demais, redirects em excesso, outros.
- A contagem de páginas lidas e de falhas deixou de ser inferida do texto (`p.startsWith("# Erro")`), que era frágil.
- `visited` marca na hora de enfileirar (antes marcava ao desenfileirar), então a mesma URL não entra duas vezes na fila.
- **`discover_urls`, `extract_links` e `read_multiple_pages` já faziam certo** — verifiquei em vez de mexer. Os três viraram teste: `discover_urls`/`extract_links` já devolviam `isError` para host bloqueado, e o `read_multiple_pages` já rotulava cada falha com `# Erro ao ler <url>` sem derrubar a chamada. Esses 3 testes passam no código antigo de propósito: são trava contra regressão.

> Efeito colateral: a correção invalidou um teste da rodada 1 que afirmava o comportamento antigo (`crawl_site` devolvendo "0 paginas lidas"). Corrigido no commit `2d8392b` — o teste estava travando o bug.

---

## 3. `tryInternalApi` com teto e orçamento

**Onde:** `server.js:46-47` (constantes), `server.js:1223-1240` (`scoreApiCandidate`), `server.js:1242-1300` (`tryInternalApi`), `server.js:812-871` (parâmetro `signal` no `fetchText`), `server.js:982` (`fetchTextCached` propaga `signal`/`retries`).

```
ANTES:  read_page com 8 candidatos /api/ que nao respondem e timeout de 4s cada: 32,2s
DEPOIS: 10,1s  (orcamento de 10s)
```

### O que mudou

- **`API_MAX_CANDIDATES` (padrão 3, `0` desliga)** e **`API_TOTAL_BUDGET_MS` (padrão 10 s)** com um `AbortController` compartilhado.
- **`signal` propagado** por `fetchTextCached → fetchTextWithFallback → fetchText`, combinado com o timeout normal da requisição (o controller interno aborta quando o externo aborta, e o listener é removido no `finally`). Cada candidato usa o **tempo que sobra** do orçamento, e com `retries: 0` — o orçamento manda mais que a insistência.
- **Dedupe pela URL já resolvida** (antes o `Set` guardava o caminho cru, então variações do mesmo destino passavam).
- **Priorização (`scoreApiCandidate`):** `graphql`/`json`/`api`/`wp-json`/`data` ganham pontos; asset estático (`.png`, `.css`, `.js`, `.woff`, `.mp4`…) perde 5 e **não ocupa vaga**. Empate mantém a ordem de aparição no HTML.
- Ao estourar o orçamento, **devolve o que já obteve e segue, sem erro**.
- Continua só o mesmo host da página, e a guarda SSRF segue rodando dentro do `fetch`.

> Achado: os padrões de regex só capturam caminhos **raiz-relativos** (a aspa é seguida de `/`). Então o ramo `path.startsWith("http")` do código antigo era **inalcançável** — o filtro de mesmo host nunca era exercitado de verdade. Agora a resolução é explícita (`new URL(bruto, baseUrl)`) e o filtro é uma guarda real.

---

## 4. Cabeçalho duplicado no `read_dynamic_page`

**Onde:** `server.js:1330-1341`.

```
ANTES                                              DEPOIS
"# ComDados" = 2x   "URL:" = 2x   rotulo = 2x      "# ComDados" = 1x   "URL:" = 1x   rotulo = 1x
"Conteudo: 205 caracteres"                         "Conteudo: 100 caracteres"

| # ComDados                                       | # ComDados
| URL: .../dinamica-next                           | URL: .../dinamica-next
| Pagina dinamica — dados extraidos...             | Pagina dinamica — dados extraidos...
| Conteudo: 205 caracteres                         | Conteudo: 100 caracteres
|                                                  |
| # ComDados            <- duplicado               | ## __NEXT_DATA__
| URL: ...              <- duplicado               | - **props**:
| Pagina dinamica — ...  <- duplicado              |   - **pageProps**:
```

O tool montava um `fullText` com título/URL/rótulo e passava para o `formatReadResult`, que adiciona os mesmos campos. Agora passa o markdown direto. **Nada foi removido:** título, URL, rótulo, descrição, autor, publicado e contagem continuam na saída — e a contagem passou a ser a real (100, não 205).

---

## 5. Robustez de borda

**Onde:** `server.js:772-783` (`parseRetryAfter`), `server.js:857-864` (uso no retry), `server.js:1917-1928` (token), `server.js:1974-2000` (`readBody`), `server.js:2095-2120` (413), `server.js:2151-2190` (encerramento), `.gitignore`.

| Item | Antes | Depois |
| --- | --- | --- |
| Corpo do POST grande | `400 Parse error`, e o `req.destroy()` acontecia **antes** de responder (podia escrever em socket destruído) | **413** com mensagem clara, leitura interrompida, conexão descartada só **depois** da resposta sair |
| Comparação do token | `token !== AUTH_TOKEN` (tempo variável) | `timingSafeEqual` sobre o **sha256 dos dois lados**: buffers sempre com 32 bytes, sem exceção por tamanho diferente e sem vazar tamanho nem quantos bytes bateram |
| SIGTERM/SIGINT | sem handler — o processo morria no meio das requisições | encerramento limpo: para de aceitar, espera as em andamento, sai com 0; prazo de 5 s |
| `Retry-After` em 429/503 | ignorado (backoff fixo de 400 ms) | respeitado em segundos **ou** data HTTP, com teto de 10 s |
| `.gitignore` | não existia | criado; `server.log`, `server.err` e `.workbuddy-ai/` deixaram de aparecer como untracked |

Detalhes que valem registrar:

- **`MAX_BODY_BYTES` (padrão 1 MB)**, configurável.
- **O `closeIdleConnections()` sozinho não bastava.** Verifiquei a lógica separadamente: a requisição em andamento terminava, conexões novas eram recusadas, mas o `close()` **nunca completava** — o keep-alive dos clientes mantinha a conexão aberta depois da resposta, e o encerramento sempre gastava os 5 s do prazo. Corrigido reaplicando `closeIdleConnections()` a cada 100 ms durante o encerramento: agora sai em **~1,2 s** com código 0.
- **Nenhum segredo rastreado.** Varri os 22 arquivos: o único match é a linha do README que lê o token de `process.env`. O `render.yaml` usa `generateValue: true`.
- Aviso no boot quando `MCP_AUTH_TOKEN` não está definido (o endpoint fica aberto).

### Uma corrida que só apareceu sob carga

Depois de tudo verde, a suíte completa começou a falhar **de forma intermitente** (1 em ~3 execuções) no teste `o servidor sobrevive a um corpo grande demais` — que passava sempre quando rodado isolado.

Causa: o `req.destroy()` que eu chamava logo depois do `res.end()` do 413 manda **RST**, e o cliente podia perder a resposta que tinha acabado de ser enviada. Isolado o timing dá certo; com o `node --test` rodando os arquivos em paralelo (uma CPU por arquivo), a corrida aparecia.

Correção (`5f04bb4`): o corpo continua sem ser lido (a leitura é interrompida no `readBody` e o request fica pausado), mas quem fecha a conexão agora é o próprio Node, de forma limpa (**FIN**), por causa do `connection: close`. Verificado com **5 execuções seguidas da suíte completa, 0 falhas**.

**Limitação registrada:** com corpo **muito** acima do limite (testei 20 MB) o cliente pode ver `ECONNRESET` em vez do 413, porque o upload dele é cortado no meio. É inerente a "interromper a leitura" — o servidor responde e segue saudável (`/health` 200 e `tools/list` 200 depois disso). Para os tamanhos realistas de uma mensagem JSON-RPC, o 413 chega limpo (5 MB → 413).

---

## 6. README

- Seção de **Playwright removida** (o código nunca usou) e a nota de `.gitignore` que agora existe de verdade.
- `maxChars` padrão **8000** (era 5000); versão lida de `SERVER_VERSION`, e o exemplo de `/health` mostra o cache.
- Nova seção **"Variáveis de ambiente"** com as 11 variáveis, padrão e efeito.
- Nova seção **"Como as falhas aparecem na saída"** — o contrato de erro de cada ferramenta, incluindo `RESULTADO PARCIAL`.
- Nova seção de **orçamento de memória** no plano free, com a conta explícita.
- `read_dynamic_page` reescrita para o que ela faz (dados embutidos, sem navegador) + a busca de APIs internas com o orçamento.
- Limitações: acrescentados DNS rebinding e "só o que o site embute no HTML é extraído".

---

## 7. Testes

**60 testes, 8 arquivos**, todos com `node:test` e sem dependências. `npm test` roda tudo em ~25 s.

| Arquivo | Testes | Falham no código anterior |
| --- | --- | --- |
| `tests/cache.test.mjs` (novo) | 6 | **6 de 6** |
| `tests/crawl.test.mjs` (novo) | 7 | **4 de 7** (os 3 que passam confirmam que as outras ferramentas já estavam certas) |
| `tests/internal-api.test.mjs` (novo) | 7 | **5 de 7** |
| `tests/dynamic.test.mjs` (novo) | 3 | **1 de 3** (o da duplicação; os outros travam a não-perda de informação) |
| `tests/robustness.test.mjs` (novo) | 8 | **4 de 8** |
| `tests/parser.test.mjs` | 12 | — (rodada 1) |
| `tests/security.test.mjs` | 13 | — (rodada 1) |
| `tests/integration.test.mjs` | 4 | — (rodada 1, pulam sem internet) |

**20 dos 31 testes novos falham no `server.js` da rodada 1** — não são testes vazios. O que passa dos novos é sempre uma asserção de "não piorou".

Uma ressalva honesta: a troca para `timingSafeEqual` **não é comprovável por teste de comportamento** — o teste só mostra que tokens de tamanhos diferentes devolvem 401 sem exceção, e isso já valia antes. A garantia de tempo constante é do algoritmo, não observável de fora; por isso esse teste passa nas duas versões.

Detalhes:

- `tests/helpers.mjs` ganhou: páginas com **contador de requisições** (deixa visível de fora se a resposta veio do cache), páginas de crawl que falham de propósito (404 / timeout / não-HTML), página com candidatos `/api/` configuráveis por query, endpoint de `Retry-After` e um **registro de quais `/api` foram realmente buscados**.
- **`robustness.test.mjs`**: o teste de SIGTERM é **pulado no Windows** — confirmei empiricamente que o Windows mata o processo filho sem rodar o handler (`HANDLER_SIGTERM_RODOU` nunca imprime). O Render é Linux, onde o teste roda. A lógica em si foi verificada à parte (ver item 5).

---

## 8. Validação final

**Smoke-test: 17/17 OK**, as 6 ferramentas.

**Web pública continua legível** (o princípio que governa tudo):

| Caso | Resultado |
| --- | --- |
| `https://example.com` | OK, 0,1 s |
| `http://github.com/` (redirect http→https) | OK, 10012 chars |
| `http://pt.wikipedia.org/wiki/Node.js` (redirect http→https + www) | OK, 30252 chars, **4 tabelas válidas** |
| `https://pt.wikipedia.org/wiki/Brasil` (página grande) | OK, 30251 chars, 1 tabela |
| `https://en.wikipedia.org/wiki/Elon_Musk` (página grande) | OK, 30235 chars, 3 tabelas |
| `https://developer.mozilla.org/pt-BR/docs/Web/JavaScript` | OK, 13191 chars |
| `https://news.ycombinator.com/` | OK, 17366 chars |
| `https://httpbin.org/redirect/3` | chegou no destino (JSON → recusado por não ser HTML, correto) |
| `discover_urls` na Wikipedia | OK, 201 links internos |
| `crawl_site` em example.com | OK, `1 pagina(s) lida(s)` |
| `extract_links` no HN | OK, 196 links |
| `/health` após tudo | `cache: 9 entradas, 6034804 bytes / 67108864 bytes` |

Nenhuma allowlist de domínio. Nenhum teto reduzido a ponto de quebrar página grande (30 mil caracteres de markdown continuam saindo).

---

## Valores padrão escolhidos (e por quê)

| Variável | Padrão | Racional |
| --- | --- | --- |
| `CACHE_MAX_BYTES` | 64 MB | Cabe com folga em 512 MB junto com o pico de downloads (6 × 10 MB). |
| limite de entrada única | 5 MB | `min(teto/4, download/2)`. O segundo termo evita uma regra que nunca dispara. |
| `CACHE_TTL_MS` | 10 min | Mantido da rodada 1. |
| `MAX_RESPONSE_BYTES` | 10 MB | **Mantido** — reduzir quebraria páginas grandes legítimas. Agora é streaming com corte. |
| `MAX_BODY_BYTES` | 1 MB | Qualquer mensagem JSON-RPC do MCP cabe em poucos KB. |
| `FETCH_CONCURRENCY` | 6 | Mantido da rodada 1; agora explícito e configurável. |
| `API_MAX_CANDIDATES` | 3 | 3 já cobre os padrões reais (uma API principal + um fallback). |
| `API_TOTAL_BUDGET_MS` | 10 s | ~40% do timeout padrão de 25 s, sem estender o `read_page`. |
| teto do `Retry-After` | 10 s | Sugerido pela tarefa; impede um servidor hostil de nos prender. |

---

## O que ficou de fora (não mexi, conforme combinado)

Split do `server.js` em módulos, `Mcp-Session-Id` e SSE (spec do transporte HTTP do MCP), `robots.txt`, `extract_links` ignorando `<nav>`, scripts `debug-*.mjs` divergentes do server.

## Outros problemas notados e não alterados

1. **`package.json` diz `1.0.0` e `SERVER_VERSION` diz `1.1.0`.** O `/health` responde 1.1.0. A tarefa dizia "a versão é a do package.json", mas o valor que o servidor realmente reporta é o `SERVER_VERSION` — documentei o README referenciando o `SERVER_VERSION` e deixei os dois arquivos como estavam (fora do escopo). **Recomendo alinhar**: são duas fontes de verdade.
2. **`uncaughtException` não encerra o processo** — só loga e segue rodando em estado indefinido. Não estava na lista.
3. **`read_multiple_pages` não deduplica URLs** e não tem teto de saída total (30 × 50000 = 1,5 M caracteres numa resposta).
4. **`NAVIGATION_PATTERNS` do `crawl_site` filtra demais**: `/about`, `/archive`, `/api/` casam contra a URL inteira, então páginas de conteúdo como `/about-us-our-history` são descartadas.
5. **O cache é compartilhado entre clientes** no modo HTTP: a página lida pelo cliente A é servida ao cliente B. Baixo impacto (é web pública), mas é vazamento de padrão de uso.
6. **`read_page` numa página que é só JS sem dados embutidos** devolve `Conteudo: 0 caracteres` com o rótulo explicando. Não é uma "página vazia" silenciosa, mas a IA recebe zero conteúdo sem uma sugestão de próximo passo.
7. **O teste de teto do `Retry-After` leva 10 s** (tem que esperar o teto para provar que ele existe). É o teste mais lento da suíte.
8. **`Retry-After` só é usado em 429/503**; 401/403 continuam sendo retentados com outro User-Agent, o que costuma piorar o bloqueio (herdado da rodada 1, não estava na lista).

---

## Resumo por arquivo

| Arquivo | Mudança |
| --- | --- |
| `server.js` | +320 linhas: cache em bytes, streaming com corte, `classifyFetchError`, `crawlOnePage`, orçamento do `tryInternalApi`, `scoreApiCandidate`, `signal` no fetch, `parseRetryAfter`, `timingSafeEqual`, 413, SIGTERM |
| `tests/cache.test.mjs` | novo — 6 testes |
| `tests/crawl.test.mjs` | novo — 7 testes |
| `tests/internal-api.test.mjs` | novo — 7 testes |
| `tests/dynamic.test.mjs` | novo — 3 testes |
| `tests/robustness.test.mjs` | novo — 8 testes |
| `tests/helpers.mjs` | contador de requisições, páginas de crawl com falha, candidatos `/api`, `Retry-After`, `cacheInfo`, `clearProbes` |
| `tests/security.test.mjs` | asserção do `crawl_site` atualizada para o comportamento correto |
| `package.json` | `test` cobre os 8 arquivos |
| `.gitignore` | novo |
| `README.md` | Playwright removido, 8000 chars, versão, 11 variáveis, contrato de erro, orçamento de memória |
