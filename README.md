# web-reader-mcp

Servidor **MCP feito do zero** para ler páginas web.

- **Zero dependências** — nenhum `npm install` necessário (só Node 18+).
- **Sem API key e sem scraping de buscador** — não existe chamada a Google, Bing, DuckDuckGo ou similar. A "pesquisa" é feita pela própria IA: ela descobre URLs com `extract_links` e lê o conteúdo com `read_page`.
- **Protocolo MCP implementado à mão** — JSON-RPC newline-delimited direto no stdio, sem usar o SDK do MCP.
- **Parser HTML → markdown também feito à mão** — tokenizador próprio, sem cheerio/jsdom.

## Arquitetura

O `server.js` é só a entrada: escolhe stdio ou HTTP, liga os sinais de erro fatal e
sai. O produto mora em `src/`, em quinze módulos com uma responsabilidade cada:

| Módulo | Responsabilidade |
| --- | --- |
| `config.mjs` | **Toda** a configuração: tetos, timeouts, defaults e os clamps de variável de ambiente. Nenhum outro módulo lê `process.env` diretamente. |
| `errors.mjs` | As 18 classes de erro e seus códigos. A camada de transporte nunca monta mensagem à mão: ela traduz o erro. |
| `utils.mjs` | Fila FIFO com índice de cabeça, os dois limitadores de carga (concorrência e bytes), o cache LRU com TTL, a **junção de buscas em voo** (single-flight) e a **chave de cache canônica** (descarta rastreio, ordena os parâmetros). |
| `security.mjs` | A guarda de segurança: SSRF (IPv4/IPv6 privado/reservado, NAT64, 6to4) e robots.txt. |
| `net.mjs` | O transporte de saída **com IP fixado**: `node:http`/`node:https` com Agent validado (anti-DNS-rebinding real), descompressão gzip/deflate/br, leitura com teto e descarte de corpos que não interessam. O `fetch` global não é usado — ele ignora a opção `agent`. |
| `fetch.mjs` | O fetch de baixo nível: cache (por chave canônica), **junção de buscas em voo**, revalidação em segundo plano (SWR), **revalidação condicional** (`If-None-Match`/`If-Modified-Since` + 304), redirects manuais, retries com `Retry-After`, teto em bytes em streaming e decodificação de charset. |
| `html-parser.mjs` | O parser HTML → markdown feito à mão (tokenizador + regras de emissão) e a extração de links e metadados. |
| `tools.mjs` | As 12 ferramentas e a lógica de leitura: o pipeline de uma página vive em **um** lugar (`lerPaginaCompleta`), compartilhado por `read_multiple_pages` e `crawl_site` — já com a **memoização da conversão**. `read_feed`/`read_json` moram em `feeds.mjs`; `find_on_page` é a busca dentro da página; `diff_page` compara com a leitura anterior. |
| `video.mjs` | A leitura de vídeo: detecção de plataforma (YouTube/Vimeo/página/legenda), metadados publicados (playerResponse, config do player, og tags, JSON-LD) e a transcrição das legendas VTT/SRT/json3. **Não baixa mídia e não gera quadros** — só o que a plataforma publica como texto acessível. |
| `pdf.mjs` | A leitura de PDF (`read_pdf`): baixa os bytes crus, infla os streams FlateDecode com `node:zlib` e interpreta os operadores de texto (`Tj/TJ/TD/Tm`) para reconstruir espaços e quebras. Sem OCR. |
| `feeds.mjs` | `read_feed` (RSS 2.0/RDF/Atom/JSON Feed) e `read_json` (API pública): parser de XML próprio, com CDATA e entidades tratadas, e formatação de JSON com `path` opcional. |
| `snapshot.mjs` | `diff_page`: marca por URL (hash do conteúdo + texto normalizado) e diff por linhas (LCS com corte de prefixo/sufixo) do que mudou desde a última leitura. |
| `tool-schemas.mjs` | A lista `TOOLS` com os JSON Schemas expostos ao cliente MCP (`tools/list`). |
| `http-transport.mjs` | O transporte HTTP Streamable: rate limiter, autenticação por token, corpo com teto, **compressão da resposta** (gzip/br conforme `Accept-Encoding`), handlers, `/health` e shutdown limpo. |
| `server.mjs` | O roteador JSON-RPC (`handleMessage`), o stdio e a montagem do `startHttp` (que delega ao transporte HTTP). |

**As quatro regras que mantêm o projeto saudável:**

1. **Segurança na origem, não na borda.** `fetchTextCached` valida SSRF e robots **antes**
   de olhar o cache e **antes** de baixar — então toda ferramenta herda a guarda de
   graça, e uma URL bloqueada nunca é servida do cache.
2. **O pipeline de leitura é único.** Quem lê uma página passa pelo mesmo caminho:
   valida URL → busca → garante HTML → converte (ou devolve cru) → trunca → formata.
3. **Erro classificado, mensagem traduzida.** O código de erro (`HTTP_404`,
   `HOST_BLOQUEADO`, `TIMEOUT`…) nasce junto com a exceção; o transporte só decide o
   status HTTP a partir dele.
4. **Trabalho repetido não se multiplica.** Junção de buscas em voo, cache com
   revalidação em segundo plano e memoização da conversão andam juntos: uma rajada de
   milhares de pedidos nas **mesmas** URLs vira pouquíssimos downloads e quase zero
   conversão redundante (ver *Capacidade e carga*).

## Ferramentas

| Ferramenta                  | O que faz                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `read_page(url)`            | Lê uma página e devolve título, meta descrição e o conteúdo em markdown                 |
| `extract_links(url)`        | Lista os links da página (texto + URL absoluta, marca interno/externo)                  |
| `read_multiple_pages(urls)` | Lê até 30 páginas por chamada (em lotes paralelos), com status por URL                  |
| `read_dynamic_page(url)`    | Lê páginas que dependem de JavaScript extraindo os dados embutidos no HTML (sem navegador) |
| `read_video(url, lang?)`    | Lê um vídeo (YouTube, Vimeo, página com vídeo ou legenda .vtt/.srt): metadados publicados + capítulos (YouTube) + transcrição da legenda com timestamps, quando acessível |
| `read_pdf(url)`             | Extrai o **texto** de um PDF público (sem OCR): reconstrói espaços e quebras pelos operadores de texto. PDF escaneado avisa que não há camada de texto |
| `read_feed(url)`            | Lê um feed RSS/Atom/JSON Feed e lista os itens (título, link, data, autor, resumo)       |
| `read_json(url, path?)`     | Lê uma resposta JSON pública, declara a forma e aceita `path` (ex.: `data.items`)        |
| `find_on_page(url, query)`  | Busca um termo na página e devolve só os trechos com contexto (literal ou regex)         |
| `diff_page(url)`            | Compara com a leitura anterior e devolve só o que mudou (linhas + e -)                  |
| `discover_urls(url)`        | Descobre as URLs de um site pelo sitemap.xml (ou links internos da home)                |
| `crawl_site(url)`           | Varre um site sozinho: lê a URL inicial e segue os links internos (BFS), até 30 páginas |

## Como testar

### Testes automatizados (`node:test`, sem dependências)

```bash
npm test
```

Roda os arquivos de `tests/` (30 arquivos, 241 testes, ~90 s, sem rede na maioria):

| Arquivo | O que cobre |
| --- | --- |
| `tests/parser.test.mjs` | o parser HTML → markdown: `<` solto no texto, indentação de blocos de código (Python/YAML), tabelas GFM válidas, entidades acentuadas e numéricas |
| `tests/security.test.mjs` | SSRF (hosts privados, IPv4 mapeado, redirects, limite de saltos) e rate limit (não burlável por `x-forwarded-for`) |
| `tests/robots.test.mjs` | robots.txt: Allow/Disallow, regra mais longa, curingas, fail-open em erro de rede |
| `tests/cache.test.mjs` | cache: teto em bytes, despejo LRU, entrada grande demais, contabilidade correta na expiração, **SWR (vencido serve na hora; rajada no vencimento = 1 revalidação)** |
| `tests/coalesce.test.mjs` | **junção de buscas em voo**: rajada de N leituras da mesma URL = 1 acesso, série continua do cache, falha compartilhada não derruba o servidor |
| `tests/chave-canonica.test.mjs` | **chave de cache canônica**: URL com `utm_*`/`gclid` acerta o cache da URL limpa (1 download), ordem dos parâmetros e fragmento não criam entradas, parâmetros reais (`?page=2`) continuam distintos |
| `tests/compressao.test.mjs` | **compressão da resposta do `/mcp`**: gzip/br conforme `Accept-Encoding`, corpo descomprimido idêntico ao puro, `vary` presente, sem `Accept-Encoding` = JSON puro, resposta pequena não comprime, ganho de ponta a ponta |
| `tests/revalidacao.test.mjs` | **revalidação condicional**: `304` reaquece a entrada sem baixar o corpo de novo (contador no `/health`), servidor sem `ETag` volta a baixar (sem regressão) |
| `tests/memo.test.mjs` | **memoização da conversão**: acerto de cache reaproveita, conteúdo novo reconverte, `MEMO_CONVERSAO=0` desliga, ferramentas compartilham o memo do mesmo payload |
| `tests/campo-fixes.test.mjs` | regressões dos bugs encontrados na rodada de campo (fidelidade de conteúdo, charset, tabelas) |
| `tests/defaults.test.mjs` | trava os padrões de leitura: `maxChars` 8000, `MAX_REDIRECTS` 5 e `DEFAULT_TIMEOUT_MS` 8000 |
| `tests/crawl.test.mjs` | `crawl_site` com a URL inicial bloqueada devolve `isError`; crawl parcial resume os motivos das falhas |
| `tests/internal-api.test.mjs` | busca automática de `/api/...` do `read_page`: teto de candidatos, dedupe, priorização e orçamento de tempo |
| `tests/dynamic.test.mjs` | `read_dynamic_page`: cabeçalho aparece uma única vez, sem perder informação |
| `tests/video.test.mjs` | `read_video`: metadados + transcrição de `<track>` com timestamps, capítulos do YouTube (extração do `ytInitialData`, dedupe, ordem) e a seção na saída, bloqueio pelo robots declarado, legenda direta `.vtt` e página sem vídeo |
| `tests/robustness.test.mjs` | 413 no corpo grande, token de tamanho diferente sem exceção, `Retry-After`, SIGTERM |
| `tests/limits.test.mjs` | controle de carga: limite de downloads respeitado, fila cheia recusa com erro claro, orçamento de memória reservado e devolvido, 503 sob saturação, `/health` isento do controle |
| `tests/host-limit.test.mjs` | teto por host: um host lento não monopoliza as vagas, fila do host cheia devolve erro claro, estado por host não vaza |
| `tests/cluster.test.mjs` | `WEB_CONCURRENCY=2` sobe workers, atende e encerra; sem a variável, processo único |
| `tests/parada-antecipada.test.mjs` | parada do parse no teto de saída: página gigante idêntica à conversão completa, páginas pequenas intactas, cercas pareadas no prefixo |
| `tests/endurecimento.test.mjs` | transporte pinado com DNS quebrado, gzip/br, redirect/erro com corpo infinito, robots não toca host bloqueado, faixas reservadas, `%` malformado, teto do stdio |
| `tests/integration.test.mjs` | a web pública de verdade: ler página https, seguir redirect http→https, extrair tabelas |
| `tests/pdf.test.mjs` | `read_pdf`: extração de texto com espaços/quebras, contagem de páginas, não-PDF avisa sem erro cru, truncamento, cache |
| `tests/feeds.test.mjs` | `read_feed` (RSS/Atom/JSON Feed, CDATA, página que anuncia feed) e `read_json` (formatação, `path`, JSON inválido) |
| `tests/find-on-page.test.mjs` | `find_on_page`: literal com caractere de regex, regex de verdade, termo ausente, `maxHits` |
| `tests/snapshot.test.mjs` | `diff_page`: primeira leitura grava, idêntica sem mudança, mudou devolve só a linha, `force`, normalização e LCS |
| `tests/http-transport.test.mjs` | caracterização do HTTP: status, headers e corpos de `/health`, 401, 405, 413, 404 e 400; sessão (`Mcp-Session-Id`) e canal SSE (400 sem sessão) |
| `tests/tools-list.test.mjs` | `tools/list` bate com o snapshot em `tests/snapshot/tools-list.json` (JSON exato) |
| `tests/golden.test.mjs` | `htmlToMarkdown` bate com os 20 golden files em `tests/golden/` (saída byte a byte) |
| `tests/helpers.mjs` | infraestrutura compartilhada: servidor de fixture local e cliente MCP para os testes |

Cada teste sobe o servidor MCP de verdade (`--http`) numa porta livre, mais um
servidor de fixture local com as páginas de teste. Os testes que precisam do
fixture usam `ALLOW_PRIVATE_HOSTS=1`; os testes de bloqueio rodam com ele
**desligado**, como em produção. Os de `integration.test.mjs` se **pulam
sozinhos** quando não há internet, e o de SIGTERM se pula no Windows (que não
entrega o sinal a processo filho — o Render é Linux).

Para apontar a suíte para outra cópia do servidor (útil para conferir que os
testes realmente falham numa versão antiga):

```bash
TEST_SERVER_PATH=/caminho/para/server-antigo.js npm test
```

### Teste ponta a ponta

```bash
npm run test:e2e      # cliente MCP mínimo: lista e exercita as 12 ferramentas
npm run test:live     # verificação pós-deploy: passa a URL e o token do serviço no ar
```

Roda um cliente MCP mínimo que conecta no servidor, lista as ferramentas e exercita todas elas.

### Medir latência em sites reais

```bash
npm run bench     # latência de leitura em 5 sites (3 leituras cada)
npm run bench:20  # 20 sites em 2 chamadas paralelas de read_multiple_pages
```

## Como usar no WorkBuddy

O servidor já está registrado em `C:\Users\Administrator\.workbuddy-ai\mcp.json`:

```json
{
  "mcpServers": {
    "web-reader": {
      "command": "C:\\Users\\Administrator\\.workbuddy-ai\\binaries\\node\\versions\\22.22.2-6\\node.exe",
      "args": ["C:\\Users\\Administrator\\Desktop\\FORA lula\\web-reader-mcp\\server.js"]
    }
  }
}
```

Depois de criado, o MCP **não ativa sozinho**: abra o menu de conectores (canto superior direito da página de conectores), encontre `web-reader` e clique em **Trust/Confiar** para confiar no servidor.

### Exemplos de uso no chat

- "Leia a página <https://pt.wikipedia.org/wiki/Node.js> e me resuma"
- "Extraia os links de <https://news.ycombinator.com> e me diga quais valem a pena ler"
- "Leia estas 3 páginas: URL1, URL2, URL3"

## Subir no GitHub (passo a passo)

Os passos abaixo foram feitos nesta maquina e funcionaram. O `render.yaml` precisa
ficar **na raiz do repositorio** pro Blueprint do Render, entao os comandos rodam
**dentro da pasta `web-reader-mcp`** (nao na pasta `FORA lula`).

Estrutura que deve estar na pasta antes do push:

```
web-reader-mcp/
├── server.js          <- entrada: escolhe stdio ou HTTP e trata erro fatal
├── src/               <- o produto, em modulos (ver "Arquitetura" abaixo)
│   ├── config.mjs     <- todos os tetos, timeouts e defaults
│   ├── errors.mjs     <- classes de erro e seus codigos
│   ├── utils.mjs      <- fila FIFO, limitadores de carga, cache LRU
│   ├── security.mjs   <- SSRF e robots.txt (guarda de segurança)
│   ├── net.mjs        <- transporte pinado: IP fixado, gzip/br, teto de leitura
│   ├── fetch.mjs      <- fetch com cache, redirects, retries e teto de bytes
│   ├── html-parser.mjs<- parser HTML -> markdown feito a mao
│   ├── tools.mjs      <- as 12 ferramentas do MCP
│   ├── video.mjs      <- read_video: metadados + transcricao de legendas
│   ├── pdf.mjs        <- read_pdf: extracao de texto de PDF (zero deps)
│   ├── tool-schemas.mjs<- JSON Schemas das ferramentas (tools/list)
│   ├── http-transport.mjs<- HTTP: rate limit, auth, /health, handlers
│   └── server.mjs     <- roteador JSON-RPC, stdio e montagem do HTTP
├── package.json
├── render.yaml        <- config do Render (precisa estar na raiz do repo)
├── .gitignore
├── README.md
├── RELATORIO-CAMPO.md <- relatorio da rodada de campo na web real
├── tests/             <- testes automatizados (node:test, sem dependencias)
├── dev/               <- material de desenvolvimento (nao e produto)
│   ├── campo/         <- bateria de campo: driver + saidas brutas de 70 casos
│   └── load/          <- harness de carga e script k6
└── scripts/           <- clientes MCP manuais (smoke-test, live-test, benchmarks)
```

O `.gitignore` já cobre `node_modules/`, `.env`, logs e arquivos de editor. Se um
dia instalar o Playwright para algum experimento, ele não vai subir por engano.

### 1. Criar o repositorio no GitHub

1. Entre em <https://github.com/new>.
2. **Name**: `web-reader-mcp`.
3. Visibilidade: **Private** (recomendado) ou Public, tanto faz.
4. **Desmarque** "Add a README" e "Add .gitignore" - a pasta ja tem README e
   criar esses arquivos pelo site da conflito no primeiro push.

### 2. Enviar o codigo (linha de comando)

O caminho tem espaco (`FORA lula`), entao use **aspas** no `cd`:

```bash
cd "C:\Users\Administrator\Desktop\FORA lula\web-reader-mcp"
```

Depois, na ordem:

```bash
git init                                                    # cria o repo git local
git add .                                                   # marca todos os arquivos
git commit -m "web-reader MCP"                              # grava o 1o commit
git branch -M main                                          # renomeia o branch pra main
git remote add origin https://github.com/br-vortex-dev/web-reader-mcp-.git  # liga no GitHub
git push -u origin main                                     # envia tudo
```

Recarregue a pagina do repositorio no GitHub: os arquivos vao estar la.
Pronto - agora e so ir no Render (**New + -> Blueprint**) e apontar pra esse repositorio.

### 3. Se travar pedindo usuario/senha (Windows)

Se o `git push` abrir pop-up de login ou nao sair do lugar, use o GitHub CLI
(`gh`, ja instalado e autenticado nesta maquina):

```bash
gh auth setup-git
```

Isso faz o git usar as credenciais do `gh` e o push passa a funcionar.

### 4. Mandar mudancas no futuro

Toda vez que alterar um arquivo:

```bash
git status            # ver o que mudou
git add .
git commit -m "descreva a mudanca aqui"
git push
```

## Rodar no Render (como servico web)

MCP em stdio **so roda local** (depende de stdin/stdout de um processo pai). Por isso o  
servidor tambem fala o transporte **HTTP remoto do MCP** (Streamable HTTP): quando a  
variavel `PORT` existe (o Render define automaticamente), ele sobe um servidor HTTP com:

- `POST /mcp` — endpoint MCP (JSON-RPC; aceita 1 mensagem ou lote)
- `GET /health` — health check do Render

O modo e escolhido sozinho: local sem `PORT` → stdio; no Render → HTTP.  
Para forcar: `node server.js --http` ou `node server.js --stdio`.

### Deploy

1. Suba o codigo no GitHub (veja a secao *Subir no GitHub* acima deste README).
2. No Render: **New + → Blueprint** e aponte para o repositorio (o `render.yaml`  
   ja esta configurado) — ou **New + → Web Service**, com:
   - Runtime: **Node**
   - Build Command: *(vazio — nao ha dependencias)*
   - Start Command: `node server.js`
   - Health Check Path: `/health`
3. O Render gera uma URL tipo `https://web-reader-mcp.onrender.com`.
4. Teste: `curl https://SEU-APP.onrender.com/health` deve voltar algo como  
   `web-reader-mcp v1.7.0 OK | cache: 0 entradas, 0 bytes / 33554432 bytes (max 100 entradas, ttl 7.5 min)`.
   A versão vem da constante `SERVER_VERSION` em `src/config.mjs`, e o `/health` também
   informa o uso atual do cache (entradas e bytes) — é assim que dá para observar
   o cache em produção. No fim da linha vêm os contadores das otimizações de rajada:
   `coalescidas: N (em voo M)` (pedidos que caronaram na junção de buscas),
   `revalidacoes: N (falhas M)` (atualizações em segundo plano),
   `conversoes: N (reaproveitadas M)` (conversões de fato executadas vs. reaproveitadas)
   e `video: N (reaproveitadas M)` (análises de vídeo executadas vs. reaproveitadas —
   releitura do mesmo vídeo com cache quente não reanalisa).

### Conectar o MCP remoto

Em qualquer cliente MCP que aceite URL remota, cadastre:

```
https://SEU-APP.onrender.com/mcp
```

(no WorkBuddy: menu de conectores → adicionar conector → colar a URL → Trust.)

## Integrar com seu produto (IA dentro do seu site)

A arquitetura são **3 peças independentes** que conversam por HTTP:

```
usuario final → seu site (Cloudflare) → seu backend → LLM (function calling)
                                              ↘ MCP web-reader (Render) → web
```

1. Seu site recebe o pedido do usuário.
2. Seu backend chama o LLM com as **ferramentas** do MCP (a lista vem de `tools/list`).
3. O LLM decide chamar uma ferramenta (ex.: `read_page`) — seu backend faz o POST no  
   MCP no Render e devolve o resultado para o LLM.
4. O LLM responde ao usuário com os dados que leu.

### Snippet do backend (Node)

```js
const MCP_URL = "https://SEU-APP.onrender.com/mcp";

async function mcp(method, params, id = 1) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}`, // token secreto (veja abaixo)
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return res.json();
}

// 1. descobrir as ferramentas (mandar isso pro LLM como "tools")
const { result: tools } = await mcp("tools/list");

// 2. quando o LLM pedir uma tool:
const r = await mcp("tools/call", {
  name: "read_page",
  arguments: { url: "https://exemplo.com" },
}, 2);
const conteudo = r.result.content[0].text; // devolver isso pro LLM
```

### Seguranca (essencial em produto)

Sem proteção, **qualquer pessoa na internet pode usar seu MCP** e gastar seus recursos.  
Pra ligar a autenticação, defina no Render (Environment → Add Environment Variable):

```
MCP_AUTH_TOKEN = um-token-longo-e-aleatorio
```

Com isso, o MCP só aceita chamadas com o header `Authorization: Bearer <token>`  
(sem token → HTTP 401). **Nunca chame o MCP direto do browser** (aí o token vazaria) —  
sempre pelo seu backend, server-side.

### Proteção contra SSRF (leitura da web pública)

Este MCP existe para ler a **web pública**, então **não existe allowlist de domínios** —
qualquer site público é acessível. O que é bloqueado é apenas **endereço privado ou
interno**, que não faz parte da web:

- IPv4: `0.0.0.0/8`, `10/8`, `100.64/10` (CGNAT), `127/8`, `169.254/16` (inclui o
  metadata `169.254.169.254`), `172.16/12`, `192.168/16`, `192.0.0/24` (IETF),
  `192.0.2/24`, `198.51.100/24` e `203.0.113/24` (faixas de documentação/teste),
  `198.18/15` (benchmark), `224/4` (multicast) e acima.
- IPv6: `::1`, `::`, `fe80::/10`, `fc00::/7`, `ff00::/8`, `2001:db8::/32`
  (documentação) e `64:ff9b:1::/48` (NAT64 local), além de IPv4 mapeado/NAT64/6to4
  (nesses casos o IPv4 embutido é validado, e não o IPv6 inteiro).

Redirects continuam funcionando normalmente (`http→https`, `www`, encurtadores), até
**5 saltos**, com o destino de **cada salto** revalidado. A checagem roda no fetch de
baixo nível, então vale para todas as ferramentas: `read_page`, `extract_links`,
`read_multiple_pages`, `discover_urls`, `crawl_site`, `read_dynamic_page` e para a
extração automática de dados embutidos (que busca "APIs internas" citadas na página).
A validação acontece **antes** de consultar o cache, então uma URL bloqueada nunca é
servida do cache.

Se o host for bloqueado, a ferramenta devolve um erro curto, por exemplo:
`Host bloqueado: endereco privado/interno (127.0.0.1)`.

**DNS rebinding (fechado de verdade):** a conexão de saída **não** usa o `fetch` global —
ela sai por `node:http`/`node:https` com um Agent cujo `lookup` devolve **apenas** o IP já
validado (`assertPublicHost` + `agentValidado`, agora em `src/net.mjs`). O nome do host
nunca é resolvido uma segunda vez entre a validação e a conexão. Isso importa porque o
`fetch` do Node **ignora** a opção `agent` (prova: `dev/_probe-agent.mjs`) — confiar nele
deixava a janela de rebinding aberta. O teste
`transporte pinado: conecta no IP validado mesmo com o DNS do host quebrado` conecta num
hostname que nunca resolve e prova que a conexão chega mesmo assim.

### Respeito ao robots.txt

Este MCP também é um **crawler** (`discover_urls` e `crawl_site` seguem links sozinhos), e a
web tem uma convenção para crawler: o `robots.txt`. Ignorar o que o site pede faz o site
bloquear o cliente — o contrário de ler a web pública em paz. Por isso:

- o `<origem>/robots.txt` é buscado **uma vez por origem**, com TTL (não entra no cache de
  páginas: é metadado de crawling, não conteúdo);
- a busca **só acontece depois** da validação de host, sai pelo **transporte pinado**
  (mesmo Agent com IP fixado) e **não segue redirect** (3xx conta como inacessível =
  fail-open) — antes, um `fetch` global em paralelo escapava do bloqueio e tocava host
  interno; a correção está travada pelo teste
  `com o host bloqueado, o robots.txt não é buscado`;
- vale o grupo **`User-agent: *`** — o User-Agent das requisições gira entre vários valores,
  então grupo por nome seria instável de pedido para pedido;
- entre `Allow` e `Disallow` vence a **regra mais longa** que casar (padrão do Google), com
  `*` e `$` como curingas; `Disallow:` vazio não bloqueia nada;
- **robots.txt inacessível** (erro de rede, 4xx, 5xx, corpo grande demais) = **fail-open**:
  sem regra para cumprir, nada a bloquear — e a falha fica em cache com TTL curto, para não
  martelar o host;
- a checagem roda no mesmo ponto da guarda de SSRF (dentro de `fetchTextCached`), então vale
  para **todas as ferramentas**, e uma URL proibida nunca é servida do cache.

URL bloqueada devolve erro curto e acionável, por exemplo:
`Bloqueado por robots.txt de exemplo.com: o caminho /privado casa com "Disallow: /privado".
Defina ROBOTS_RESPECT=0 para ignorar o robots.txt.`

Para desligar tudo (desenvolvimento, ou quando o uso é explicitamente autorizado pelo site):
`ROBOTS_RESPECT = 0`.

### Variáveis de ambiente

Todas são opcionais menos `MCP_AUTH_TOKEN` (que é obrigatória em produção). No
`render.yaml` já vêm configuradas as duas que importam.

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `MCP_AUTH_TOKEN` | *(vazio)* | Token do header `Authorization: Bearer <token>`. **Vazio = `/mcp` aberto para qualquer um**, e o servidor avisa isso no boot. No Render o `render.yaml` usa `generateValue: true`, então o valor é gerado e fica só no dashboard. |
| `PORT` | `3000` | Porta do modo HTTP. O Render define sozinha; a presença dela é o que escolhe o modo HTTP (sem `PORT` → stdio). |
| `ALLOW_PRIVATE_HOSTS` | desligada | `1` **desliga** o bloqueio de hosts privados/internos (SSRF). Só para desenvolvimento e testes locais. **No Render fica desligada** — não defina em produção. |
| `TRUST_PROXY_HOPS` | `0` | Quantas entradas do `x-forwarded-for` confiar, contando da **direita**. `render.yaml` usa `1`. Veja *Rate limit* abaixo. |
| `CACHE_MAX_BYTES` | `134217728` (128 MB) | Teto do cache em bytes. É o teto que importa; ao estourar, despeja os menos usados. O valor anterior (32 MB) enchia no próprio teste de carga e despejava página ainda quente. |
| `CACHE_MAX_ENTRIES` | `512` | Teto de entradas do cache (o segundo teto, além dos bytes). Ajustável por env: subir diminui o despejo de páginas ainda quentes. |
| `CACHE_TTL_MS` | `450000` (7,5 min) | Validade de cada entrada do cache. |
| `CACHE_SWR` | desligada | `1` liga a **revalidação em segundo plano**: entrada vencida dentro da janela de graça é servida na hora e atualizada atrás (passando pela junção em voo). O `render.yaml` liga. Desligada, vencida = busca de novo (comportamento conservador). |
| `CACHE_STALE_WINDOW_MS` | `0` (2× o TTL) | Tamanho da janela de graça do SWR em ms. Fora dela, a entrada é descartada e a leitura espera a nova busca. |
| `MEMO_CONVERSAO` | ligada | `0` desliga a memoização da conversão (HTML → markdown/meta/links). Existe para depurar o parser; não há por quê desligar em produção. |
| `ROBOTS_RESPECT` | ligado | `0` **desliga** o respeito ao `robots.txt` (veja a seção acima). |
| `ROBOTS_TTL_MS` | `900000` (15 min) | Validade da leitura do `robots.txt` por origem. Falha em ler vale TTL curto (`ROBOTS_NEGATIVE_TTL_MS`, 60 s fixo). |
| `ROBOTS_TIMEOUT_MS` | `2500` | Timeout da busca do `robots.txt` (0,5 s–15 s). |
| `ROBOTS_MAX_BYTES` | `524288` (512 KB) | Corpo do `robots.txt` acima disso é descartado (fail-open). |
| `ROBOTS_MAX_ORIGINS` | `1000` | Teto de origens com `robots.txt` em cache. |
| `ROBOTS_MAX_CONCURRENCY` | `16` | Quantas buscas de `robots.txt` (uma por origem nova) rodam ao mesmo tempo. |
| `STDIO_MAX_LINE_BYTES` | `4194304` (4 MB) | Teto de UMA linha no modo stdio. Linha maior vira `Parse error` e é descartada — o buffer não cresce sem limite. |
| `MAX_RESPONSE_BYTES` | `5242880` (5 MB) | Teto de download por requisição, lido em streaming com corte. É o teto DURO: acima dele a leitura falha com "Resposta muito grande". |
| `DOWNLOAD_FOLGA_POR_CHAR` | `60` | Teto de download PROPORCIONAL ao `maxChars` pedido, no `read_page`/`read_dynamic_page`: `maxChars × folga`, limitado ao `MAX_RESPONSE_BYTES`. A folga existe porque HTML tem muita marcação em volta do texto. Só corta página grande; abaixo do piso nada muda. |
| `DOWNLOAD_MIN_BYTES` | `262144` (256 KB) | Piso do teto proporcional. Página menor que isto nunca é cortada. **Não subir para 1 MB**: com folga de 60x, todo `maxChars` abaixo de ~17.000 encosta no piso e o teto deixa de ser proporcional — o washingtonpost (3,7 MB) era cortado em 1 MB, tinha de ser relido inteiro e ficava 50% mais lento que sem o recurso. Definir igual ao `MAX_RESPONSE_BYTES` **desliga** o recurso (útil para medir o comportamento antigo). |
| `MAX_BODY_BYTES` | `1048576` (1 MB) | Teto do corpo do POST em `/mcp`. Acima disso responde **413**. |
| `FETCH_CONCURRENCY` | `32` | Quantas páginas são baixadas em paralelo por `read_multiple_pages` e `crawl_site`. É o teto de memória simultânea. |
| `API_MAX_CANDIDATES` | `2` | Máximo de `/api/...` que o `read_page` busca sozinho. `0` desliga essa busca. |
| `API_TOTAL_BUDGET_MS` | `1500` | Orçamento total dessa busca de APIs internas. |
| `ROBOTS_NEGATIVE_TTL_MS` | `60000` | TTL da falha ao ler o `robots.txt` (fail-open), para não martelar o host. |
| `MAX_REDIRECTS` | `5` | Máximo de saltos de redirect seguidos (revalidando o destino de cada um). |
| `RETRY_AFTER_MAX_MS` | `10000` | Teto do `Retry-After` obedecido no retry. |
| `DEFAULT_TIMEOUT_MS` | `8000` | Timeout padrão de cada requisição HTTP. |
| `MULTI_MAX_TOTAL_CHARS` | `250000` | Teto da soma das seções em `read_multiple_pages`. |
| `DEFAULT_MAX_CHARS` | `8000` | Padrão de `maxChars` das ferramentas. |
| `HARD_MAX_CHARS` | `25000` | Teto absoluto de `maxChars` por página. |
| `MAX_PAGES_PER_CALL` | `30` | Teto de páginas por `read_multiple_pages` e por `crawl_site`. |
| `HOST_CHECK_TTL_MS` | `300000` (5 min) | Validade da validação de host (SSRF) por nome. |
| `AGENT_CACHE_MAX` | `256` | Teto de Agents HTTP/HTTPS mantidos por IP (keep-alive). |
| `MAX_INFLIGHT_REQUESTS` | `128` | Quantas requisições são processadas ao mesmo tempo. Calibrado pelo **joelho da curva de capacidade** (~64 no hardware de referência). **Aumentar não aumenta a vazão** — só a fila. |
| `BROTLI_QUALITY` | `4` | Qualidade do brotli na resposta do `/mcp`. O padrão do Node é **11**, o mais caro e **síncrono** (segura o event loop): medido num corpo de `tools/list`, **17,3 ms** por requisição em q11 contra **0,68 ms** em q4 — 25x menos CPU por 10 bytes a mais na saída. Suba para `11` só se quiser o byte a menos. |
| `COMPRESSAO_CACHE_ENTRIES` | `64` | Teto do cache de compressão: guarda a versão comprimida de um corpo que se repete (a chave é o sha256 do corpo). `tools/list` e `initialize` são constantes, então a partir da segunda chamada a compressão é servida pronta (**0,12 ms** contra 16,4 ms). `0` desliga. |
| `MAX_WAITING_REQUESTS` | `4096` | Quantas esperam por uma vaga. `0` = recusa na hora. |
| `MAX_WAIT_MS` | `15000` (15 s) | Teto de espera por uma vaga; depois disso, **503 com `Retry-After`**. Deve ser menor que o timeout do seu cliente MCP. |
| `OUTBOUND_MAX_CONCURRENCY` | `128` | Downloads simultâneos (limita sockets/tarefas). |
| `OUTBOUND_MAX_QUEUE` | `100` | Quantos downloads esperam por vaga. Fila cheia = erro claro e imediato. |
| `HOST_MAX_CONCURRENCY` | `64` | Downloads simultâneos **por host**: um site lento não consome todas as vagas enquanto os outros esperam. Calibrado pelo joelho da curva (com 32, o harness mediu 52 req/s num host único estrangulado; com 64, os mesmos 76 req/s de antes). |
| `HOST_MAX_QUEUE` | `256` | Quantos pedidos do mesmo host esperam por vaga. Fila cheia = erro claro e imediato. Quem espera na fila do host **não** segura vaga global. |
| `OUTBOUND_MEMORY_BUDGET` | `67108864` (64 MB) | **O teto de memória que importa**: cada download reserva `min(content-length, MAX_RESPONSE_BYTES)` **antes** de ler. É por bytes, não por número de downloads — muitas páginas pequenas passam juntas, poucas grandes são limitadas. |
| `WEB_CONCURRENCY` | `1` | Quantos workers do cluster (um servidor por worker, mesma porta). **Opt-in**: sem a variável, processo único como sempre. Em máquina com núcleos sobrando, `2`/`4` multiplicam o teto de CPU (medido: +35% com 2 workers quando a CPU ainda sobra). |
| `HTTP_KEEPALIVE_TIMEOUT_MS` | `32500` | Keep-alive do servidor. O padrão do Node é 5 s, o que causa **churn de conexão** sob carga; e precisa ser **maior que o idle timeout do balanceador**, senão dá 502. |
| `HTTP_HEADERS_TIMEOUT_MS` | `33000` | Precisa ser ≥ keep-alive. |
| `HTTP_REQUEST_TIMEOUT_MS` | `150000` | Precisa ser ≥ headers. |
| `HOST` | *(todos)* | Endereço de escuta do modo HTTP (padrão: todas as interfaces). Útil em testes que precisam fixar `127.0.0.1`. |
| `MAX_CONNECTIONS` | `0` (sem teto) | Teto de conexões aceitas; `0` deixa o limite para o SO. |
| `RATE_LIMIT_MAX` | `60` | Requisições por janela, por cliente. O `render.yaml` usa **10000**: quando quem chama é o backend de um site, todos os usuários chegam pelo mesmo IP e 60/min seria um balde único para o site inteiro. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Tamanho da janela do rate limit. |

Uma variável só de teste, usada pela suíte: `TEST_SERVER_PATH`, que aponta os
testes para outra cópia do `server.js` (serve para provar que os testes falham
numa versão antiga).

**Cache e titularidade.** Um `MCP_AUTH_TOKEN` por deploy significa **um titular**:
todo cliente que consegue chamar o serviço tem a mesma credencial, então não há
fronteira entre "clientes" para isolar — e o cache só guarda **conteúdo público
da web**, que qualquer cliente poderia buscar por conta própria. O cache é
compartilhado dentro da instância por design. Isolar o cache por cliente
exigiria um *roster* de tokens (várias credenciais aceitas no mesmo processo) —
isso é feature nova, não correção, e não está implementado.

### Capacidade e carga

O teto deste serviço é **CPU de um núcleo**. Até a rodada de otimização de
outubro de 2026, cada página custava ~3 ms de `tokenize` + `htmlToMarkdown` e
páginas grandes pagavam caro: o fecho de `<pre>` varria e copiava o buffer
inteiro a cada bloco de código (O(n²)) e a conversão só parava no fim da página,
mesmo quando a saída ia ser truncada em 25 mil caracteres de qualquer jeito.

O que mudou (tudo medido):

| O quê | Antes | Depois |
| --- | --- | --- |
| Fecho de `<pre>` (fim do O(n²)) | 48% do CPU do parse | 0,7% |
| `htmlToMarkdown` numa página de 236 KB | 59 ms | 22,5 ms (2,6x) |
| Conversão de página de 1 MB (só os ~58 KB entregáveis) | 1249 ms | 80 ms (15x) |
| Página gigante: download + parse do rabo que nunca sai | tudo baixado e convertido | para no teto entregável, com prefixo byte a byte idêntico |
| Leitura completa de página de 1,34 MB (markdown + links + meta) | 68,4 ms | 39,1 ms (**1,75x**, 43% menos CPU) |
| `parseAttrs` (atributos de tag) | em toda tag, inclusive nas que ninguém lê | só em `<a>`, `<img>` e tags que contêm `aria-hidden` |

A **passada única** (`htmlToMarkdownComLinks`) existe porque `htmlToMarkdown` e
`extractLinks` liam o HTML inteiro cada um — duas tokenizações completas do mesmo
texto (48,8 ms + 25,4 ms numa página de 1,34 MB). A tokenização é a parte que se
pagava duas vezes, e ela não depende do que se quer extrair: agora um único laço
produz markdown e links, e a `extract_links` de um payload já convertido não
custa nada (os links ficam no memo). Quando a parada antecipada dispara, o
markdown é finalizado naquele ponto e o laço **continua** apenas coletando links,
então a lista de links nunca sai truncada. `tests/passada-unica.test.mjs` prova
que a saída é indistinguível das duas funções separadas, caso a caso.

Junto disso, `parseAttrs` passou a ser **condicional**: de todos os consumidores,
só `<a>` e `<img>` leem atributos de verdade, e o resto do parser só olha
`aria-hidden`. Uma `<div class="…" data-…>` não paga mais por carregar atributos
que ninguém vai ler.

A **parada antecipada** é conservadora por construção: a conversão só para numa
fronteira segura (fora de `<pre>`, de tabela e de bloco ignorado, com as cercas
de código emparelhadas) e só quando a limpeza final já garante os caracteres
entregáveis inteiros — o que o cliente vê é o mesmo prefixo da conversão
completa, o que muda é o trabalho jogado fora. Quando a conversão é
interrompida, o cabeçalho marca `Conteudo: N+ caracteres` (havia mais além do
teto). `HARD_MAX_CHARS` é o teto entregável por leitura; a parada usa ele como
referência.

O **teto por host** (`HOST_MAX_CONCURRENCY`) garante justiça entre sites: um
host lento ou com muitos pedidos não monopoliza as vagas globais de download —
os outros sites continuam sendo atendidos em paralelo, e quem espera na fila do
host não segura vaga global.

Curva medida com o servidor atual (`node dev/load/harness.mjs --mode read --delay 0`):

| Concorrência | Vazão | p50 | Sucesso |
| --- | --- | --- | --- |
| 64 | 94 req/s | 687 ms | 100% |
| 128 | 91 req/s | 1124 ms | 100% |
| 256 | 80 req/s | 2716 ms | 100% |

O **joelho está em ~64–128 simultâneas** (com o harness dividindo a mesma CPU —
o número absoluto varia com a máquina; o que importa é a forma da curva).
Cache quente entrega **205 req/s**. Repare que 10.000 clientes respeitando o
rate limit (60/min cada) geram apenas **166 req/s** — isso é o caso real, e cai
confortavelmente à esquerda do joelho. Já 10.000 requisições *em voo* não cabem
numa instância: o servidor atende o que pode e responde **503 explícito** para o
resto, sem estourar a memória.

**Mais núcleos:** com `WEB_CONCURRENCY=2` o mesmo harness mediu **103 req/s**
(+35% sobre 76 no mesmo momento) — o worker extra só ajuda até a CPU da máquina
acabar; em host de 1 núcleo efetivo (como o plano free do Render), deixe em 1.

#### Rajada nas mesmas URLs: o trabalho não se multiplica

O cenário que importa num produto de IA: **muita gente lendo os mesmos sites
difíceis** ao mesmo tempo. Sem proteção, uma rajada de N pedidos da mesma URL
virava N downloads (o cache só esquenta depois do primeiro terminar) e cada
leitura acerto pagava a conversão HTML → markdown de novo. Três mecanismos
resolvem, e eles trabalham juntos:

1. **Junção de buscas em voo (single-flight).** Pedidos simultâneos da mesma URL
   compartilham **um único download**: o primeiro inicia, os demais caronam e
   recebem a mesma resposta. Vale para todas as ferramentas. No `/health`, o
   campo `coalescidas` conta as caronas (e `em voo`, quantas buscas estão ativas).
2. **Revalidação em segundo plano (stale-while-revalidate, `CACHE_SWR=1`).** No
   vencimento do cache, quem chega recebe a versão guardada **na hora** e a
   atualização acontece atrás — passando pela junção, então uma rajada no
   vencimento vira **uma** revalidação. Sem isso, o instante do vencimento era o
   pior momento possível: todo mundo esperava bloqueado pela mesma nova busca.
3. **Memoização da conversão.** O HTML baixado é convertido **uma vez** por
   conteúdo (meta, markdown e links ficam presos ao objeto do cache via
   `WeakMap`); acerto de cache não paga parser de novo. Conteúdo novo (TTL
   vencido, revalidação) é objeto novo e converte de novo — sem invalidação para
   esquecer. No `/health`: `conversoes: N (reaproveitadas M)`.

Efeito combinado, medido nos testes: **12 leituras simultâneas da mesma URL = 1
acesso** ao site (`tests/coalesce.test.mjs`), **8 pedidos no vencimento = 1
revalidação** (`tests/cache.test.mjs`), e releituras de cache **não reconvertem**
(`tests/memo.test.mjs`).

O que isso **não** muda: o teto físico de conexões simultâneas da instância.
Nenhuma dessas otimizações multiplica hardware — elas garantem que o serviço
**não desperdice** o que tem. 30 mil conexões simultâneas num plano free não
existem; o que existe é uma multidão em cima das mesmas páginas colapsando em
poucos downloads, com o excedente de conexões recebendo 503 explícito e
retentativa que acerta o cache.

Para testar carga:

```bash
node dev/load/harness.mjs --concurrency 64 --seconds 15 --mode read --delay 150
node dev/load/rajada.mjs   # prova de rajada: mesmos sites, muitos leitores, antes × depois
k6 run -e MCP_URL=http://127.0.0.1:3000/mcp -e MCP_TOKEN=t dev/load/k6.js
```

O harness aceita `--server <caminho>` para apontar a outra cópia — é assim que
se compara o servidor atual com o baseline congelado (`dev/_baseline/`) sob a
mesma carga: `node dev/load/harness.mjs --concurrency 64 --seconds 8 --mode read --server dev/_baseline/server.js`.

O `rajada.mjs` compara o servidor atual com a cópia em `dev/_baseline/` sob a
**mesma carga** — é ele que produz os números de "acessos ao site" citados
acima (com a cópia do baseline congelada da rodada anterior).

O `k6` não é dependência do projeto — instale à parte (`winget`/`brew`/`apt`).
Os números antes/depois do tuning e o caminho para 10k req/s ficaram registrados
no histórico de commits do repositório (rodada de capacidade de outubro de 2026);
tudo continua recuperável pelo git.

#### Bytes na volta: compressão da resposta e revalidação condicional

Duas frentes atacam o que ainda trafegava à toa — o texto de uma página é grande,
e baixá-lo duas vezes quando nada mudou é desperdício puro.

- **Compressão da resposta do `/mcp`.** O corpo do `/mcp` saía como JSON puro: o
  texto lido de uma página viajava cru na volta. Agora a resposta é comprimida
  com `brotli`/`gzip`/`deflate` conforme o `Accept-Encoding` do cliente — sempre
  com `vary: accept-encoding`, para nenhum cache intermediário servir a versão
  comprimida a quem não a aceita. Respostas pequenas (abaixo de 1 KB) **não** são
  comprimidas: não vale o custo. Cliente que não declara `Accept-Encoding`
  recebe **exatamente** o JSON de antes (compatível byte a byte). Num payload de
  20 KB de texto de web, a redução medida passa de 50% (brotli costuma ir além —
  `tests/compressao.test.mjs` prova de ponta a ponta). A compressão roda em
  **`BROTLI_QUALITY=4`** (não no 11 padrão do Node, que é síncrono e caro) e
  tem um **cache por conteúdo**: `tools/list` e `initialize` são respostas
  constantes, então a partir da segunda chamada o corpo comprimido é servido
  pronto — **0,12 ms contra 16,4 ms** de comprimir do zero a cada vez.

- **`ETag`/`304` nas respostas do `/mcp`.** Toda resposta leva um `ETag`
  (sha256 do corpo). O cliente que revalida com `If-None-Match` idêntico recebe
  **304 sem corpo** — economiza a volta inteira, não só a compressão. É o que
  faz a resposta constante (`tools/list`) parar de trafegar a cada chamada.

- **Revalidação condicional (`If-None-Match` / `If-Modified-Since`).** Ao baixar
  uma página, o servidor guarda o `ETag`/`Last-Modified`. Quando a entrada vence
  e a leitura volta à rede, o pedido leva esses validadores: se o site responder
  **304 (não modificado)**, não há corpo para baixar e a entrada em cache volta a
  valer. O download inteiro é economizado — exatamente quando o site coopera.
  Site sem `ETag` continua igual a antes (baixa de novo no vencimento). No
  `/health`: `condicional: N (304 M)`.

- **Chave de cache canônica.** A mesma página chega com parâmetros de rastreio a
  cada clique ou compartilhamento (`utm_*`, `gclid`, `fbclid`...). Sem
  normalizar, cada variação virava uma URL diferente — baixava de novo, convertia
  de novo e ocupava outra vaga do cache. Agora a chave descarta os parâmetros de
  rastreio, ignora a ordem dos demais e o fragmento `#...`; parâmetros que **são**
  conteúdo (`?page=2`) continuam distintos, como devem.

### Rate limit e `x-forwarded-for`

O limite é de **60 requisições por minuto por cliente** no padrão — em produção o
`render.yaml` define **10000**. A chave do limite é o IP do
socket (`req.socket.remoteAddress`), e **não** o `x-forwarded-for` — esse header é
escrito pelo cliente e era usado antigamente como chave, o que permitia burlar o limite
inteiro só rotacionando o valor dele.

**Por que 10000 em produção:** quando o MCP fica atrás de um site de IA, quem chama é
o *backend* do site — todos os usuários chegam com o **mesmo IP**. Com 60/min o balde
seria único para o site inteiro: 15 usuários lendo 4 páginas por minuto já estouravam.
Com 10000/min por cliente, o rate limit deixa de morder no uso normal e a proteção de
capacidade volta a ser a admissão (`MAX_INFLIGHT_REQUESTS`: 128 em voo, depois 503
explícito) — que é a proteção de verdade, calibrada pelo joelho da curva. O limite
continua existindo contra abuso distribuído e segue sendo cortesia com os sites de
terceiros; se um dia o consumo crescer a ponto de preocupar, o caminho é baixar o
valor ou voltar a atribuir por usuário (`TRUST_PROXY_HOPS: 2` + o backend escrevendo o
IP do usuário no `x-forwarded-for`).

Como no Render o app fica atrás de um proxy, o IP real do cliente chega no
`x-forwarded-for`. A variável `TRUST_PROXY_HOPS` diz em quantas entradas confiar,
**contando da direita** (as da direita são anexadas pela infraestrutura; as da esquerda
são forjáveis). Se a entrada escolhida não for um IP válido, o servidor cai para o IP do
socket. No `render.yaml` ela já vem com `TRUST_PROXY_HOPS: 1`.

**Como confirmar o valor:** com o valor certo, cada cliente tem o seu próprio contador.
- Se **todo mundo** começa a receber `429` junto, o valor está **alto demais** (você está
  confiando numa entrada forjável e todos caem no mesmo bucket) → reduza para `1`.
- Se **ninguém** nunca recebe `429`, mesmo abusando, o valor está **baixo demais** (todos
  os clientes compartilham o IP do proxy) → aumente para `1`.
- Para inspecionar, suba localmente e faça uma chamada olhando o `x-forwarded-for` que
  chega: `curl -H "x-forwarded-for: 1.2.3.4" ...` só é útil para testar, não para medir.

O mapa do rate limit tem limpeza periódica das entradas expiradas (a cada 60 s) e um teto
de 10.000 chaves, descartando as mais antigas — antes ele crescia para sempre, e dava
para esgotar a memória só mandando valores de `x-forwarded-for` sempre diferentes.

### Custos e cuidados no Render

- **Plano free dorme** após 15 min sem uso: a 1ª chamada leva ~30-50s (cold start).  
  Pra produto, use o plano pago (evita dormir e dá mais RAM).
- **30 URLs por chamada**, em lotes de 32 (`FETCH_CONCURRENCY`): pesquisa rápida
  sem estourar memória.
- **Orçamento de memória no plano free (512 MB)** — os tetos foram escolhidos
  para caber com folga:
  - cache: `CACHE_MAX_BYTES` (32 MB) — é o teto real; a contagem de 100 entradas
    é o segundo teto.
  - download por requisição: `MAX_RESPONSE_BYTES` (5 MB), lido em **streaming**
    com corte (não carrega a resposta inteira antes de conferir).
  - pico simultâneo: 32 requisições em paralelo × 5 MB = 160 MB transitórios.
  - Se subir `FETCH_CONCURRENCY` ou `MAX_RESPONSE_BYTES`, refaça essa conta.

## Download proporcional ao texto pedido

O `read_page` não baixa mais 5 MB para entregar 2.000 caracteres. O teto de
download acompanha o `maxChars` pedido (`maxChars × 60`, com piso de 256 KB e
teto de `MAX_RESPONSE_BYTES`), porque HTML tem muita marcação em volta do texto.

**Onde vale:** `read_page` e `read_dynamic_page` — uma página por chamada, onde
o cabeçalho `Conteudo: N+` avisa quando o documento tem mais do que foi lido.

**Onde NÃO vale, de propósito:**

- `read_multiple_pages` e `crawl_site`: o crawl precisa dos links, que moram no
  rodapé — justamente o que o corte tira. Medido com 20 páginas de 2 MB, o
  corte fazia o texto entregue sair **3% menor**. Entregar menos não é
  otimização.
- `extract_links`, `discover_urls`, `find_on_page`, `diff_page`: precisam do
  documento inteiro para achar links, sitemap, o termo buscado ou o diff.

**Como o corte se protege contra perder conteúdo:**

1. o download para no teto, mas o HTML **nunca** entra no cache nesse estado
   (HTML truncado envenenaria toda leitura futura da mesma URL);
2. o texto convertido é comparado com o pedido: se o que ficou **não** cobre o
   `maxChars`, a leitura refaz o download inteiro e entrega completo;
3. a URL fica com o tamanho memorizado (10 min, sem a query), então a próxima
   leitura vai direto ao teto largo — sem pagar dois downloads;
4. o aviso de interrupção só aparece quando o corte **custou** texto; quando não
   custou, fica apenas o `+` no tamanho.

**Números medidos.** Texto entregue idêntico em todos os alvos — se divergisse,
não seria otimização.

Contra a internet real (`dev/_bateria-real-repete.mjs`, `maxChars=2000`, 5
voltas por alvo em rodízio, mediana — uma rodada isolada oscila demais com
antivírus, indexação e GC):

| Alvo | Antes | Depois | Ganho |
|---|---|---|---|
| `iana.org/domains/reserved` | 591 ms | 97 ms | **-84%** |
| `html.spec.whatwg.org` (spec de 12 MB) | 451 ms | 384 ms | **-15%** |
| `nodejs.org/api/http.html` | 285 ms | 311 ms | ruído (+9%) |
| `washingtonpost.com` | 623 ms | 918 ms | ruído (+47%) |

O washingtonpost tem **4,02 MB de markdown**: o corte não o atinge (ele já
cabe nos 5 MB), então a diferença é do servidor deles — as faixas se sobrepõem
(antes 610–1054 ms, depois 758–1106 ms). O texto divergiu em 46 caracteres de
4.020.283 (0,001%): conteúdo rotativo da home, não o corte.

Em fixture com banda controlada (`dev/_mede-teto.mjs`, 8 MB/s), páginas de
3,9 MB: **-68%** com `content-length` e **-71%** sem ele, tanto na primeira
leitura quanto nas repetidas. Página de 957 KB e de 9 KB: sem mudança — com
`maxChars` padrão o teto proporcional (480 KB) manda, e o piso existe para as
pequenas.

O que **não** dá ganho, e é honesto dizer: página cujo texto do topo não cobre o
`maxChars` pedido. Nesse caso o código detecta que o corte custaria conteúdo,
refaz a leitura inteira e o tempo fica igual ao de antes. Custa uma leitura
dupla na estreia; a partir daí a URL vai direto ao teto largo.
- **Sem navegador, por escolha**: `read_dynamic_page` não usa Playwright nem
  Chromium (o plano free não tem RAM para isso, e o deploy continua sem build).
  Ela extrai os dados que o site já embute no HTML — ver a seção abaixo.
- **Cloudflare x Render são coisas diferentes**: a Cloudflare hospeda **seu site**;  
  o Render hospeda **o MCP**. Não precisa migrar nada — o site continua na  
  Cloudflare e só faz POST pro Render.

## read_dynamic_page (sem navegador)

Para páginas cujo conteúdo só aparece depois de executar JavaScript (SPAs,
infinite scroll). **Não há Playwright nem Chromium** — o projeto continua com
zero dependências e sem build.

O que ela faz: extrai os dados que o site já embute no HTML e converte em
markdown — `__NEXT_DATA__` (Next.js), `__NUXT__` (Nuxt), `window.__INITIAL_STATE__`
e similares, `JSON-LD` e APIs internas citadas no próprio HTML. Se não achar nada,
devolve o conteúdo estático com um aviso explicando isso.

Essa mesma extração roda automaticamente dentro do `read_page` quando o conteúdo
extraído vem curto (menos de 300 caracteres) e a página parece dinâmica.

### Busca automática de APIs internas (com orçamento)

Quando o `read_page` dispara essa extração, ele também tenta as rotas `/api/...`,
`/graphql`, `/data/...` e `/wp-json/...` citadas no HTML da página:

- **no máximo `API_MAX_CANDIDATES`** (padrão 2) candidatos;
- **orçamento total de `API_TOTAL_BUDGET_MS`** (padrão 1,5 s), depois disso devolve
  o que já obteve e segue, sem erro;
- só o **mesmo domínio** da página (e passando pela guarda SSRF);
- deduplicados e priorizados: caminho com cara de dados (`json`, `graphql`, `api`)
  ganha pontos, asset estático (`.png`, `.css`, `.js`, `.woff`) perde e não ocupa vaga.

## read_video (metadados + transcrição)

Para saber **o que é** um vídeo e **o que é falado nele**, sem baixar mídia.
Aceita quatro entradas:

| Entrada | O que ela tenta |
| --- | --- |
| URL de vídeo do YouTube (`watch`, `youtu.be`, `shorts`, `live`, `embed`) | metadados + capítulos + legendas da própria página |
| URL do Vimeo (vídeo ou player) | metadados + faixas do player — a transcrição funciona |
| Qualquer página com vídeo embutido (blog, notícia) | segue o embed conhecido, ou lê og tags/JSON-LD/`<track>` da própria página |
| Link direto de legenda (`.vtt`/`.srt`) | baixa e converte em blocos com timestamps |

O que sai: título, canal, duração, visualização, publicação, capa, descrição, os
**capítulos** publicados (seção `Capitulos:`, com minutagem — só no YouTube, que
os publica no mesmo HTML da página) e a **transcrição** — cada bloco com
timestamp (`[3:33] texto`), no idioma preferido (`lang`) ou na ordem `pt-BR`,
`pt`, `en`.

**O que ela não faz — e por quê.** Não baixa o vídeo, não decodifica quadros e não
gera resumo de imagem: isso exigiria `yt-dlp`/`ffmpeg` (quebraria a restrição de
zero dependências) e estouraria a memória do plano free. Só entra o que a
plataforma publica como **texto acessível**.

**YouTube, a parte honesta:** a página do vídeo entrega os metadados completos
(inclusive os **capítulos**, que o `read_video` extrai do mesmo HTML — sem
chamada extra), mas o download de legenda do YouTube mora em `/api/timedtext` —
que o robots.txt do próprio YouTube bloqueia (`Disallow: /api/`) e que, mesmo
fora dele, devolve corpo vazio para acesso anônimo (testado também por curl).
Além disso, para **IPs de datacenter** (o Render, por exemplo) a própria página
`/watch` costuma responder **HTTP 429**. Nesses casos o `read_video` cai no
oEmbed público (título, canal, capa) e declara o bloqueio no campo `Aviso:` —
devolve o que dá para ler, nunca falha inteiro nem finge leitura completa. Se
até o oEmbed cair, aí sim é `isError` com o motivo.

**Otimizações do módulo (medidas em `dev/_perfil-video*.mjs`):** a extração dos
capítulos só toca o `ytInitialData` quando o HTML contém `chapterRenderer`
(sentinela) — no caso comum (vídeo sem capítulos) isso custa ~0,3 ms em vez de
~11 ms da extração+varredura completas; quando o vídeo **tem** capítulos, o
caminho completo roda igual (paridade provada em `tests/video.test.mjs`). A
análise da página fica **memoizada por conteúdo baixado** (mesmo padrão da
conversão de HTML): reler o mesmo vídeo com cache quente custa ~0 ms em vez de
~11 ms, e o efeito aparece no `/health` (`video: N (reaproveitadas M)`).
Quando a página `/watch` recusa com 429, ela não é re-tentada (retries: 0) e
entra numa quarentena de 60 s: as leituras seguintes vão direto ao oEmbed — o
caminho do Render caiu de ~1,6 s para ~24 ms por leitura (`dev/_perfil-video.mjs`),
mantendo o motivo declarado na saída. Nada disso muda o que sai: mesmos campos,
mesmos avisos.

**Caminhos testados e fechados** (sondas em `dev/_probe-*`), para não serem
tentados de novo: o endpoint interno do player (`/youtubei/v1/player`) está
em `Disallow: /youtubei/` no robots.txt do YouTube; `/shorts/<id>` apenas
redireciona para `/watch` (sofre do mesmo 429); `/embed` e o
`youtube-nocookie.com/embed` devolvem só uma casca JS de ~147 KB, sem
metadados; e o formato `json3` da legenda também vem vazio para acesso
anônimo.

**Vimeo e páginas com legenda publicada** rodam de ponta a ponta: o módulo baixa
o VTT/SRT (ou o `json3` do YouTube, quando ele responde), converte em blocos
legíveis, junta cues curtas em frases e limpa a marcação (`<i>`, `<c.cor>`, `{\an8}`).

Toda URL tocada pela `read_video` passa pelo mesmo caminho das outras ferramentas:
validação SSRF, robots.txt, cache, junção de buscas em voo e teto por host.

## read_pdf (texto de PDF, sem dependência)

PDF é conteúdo web comum (editais, artigos, relatórios, contratos) e era o
único tipo de documento que o servidor recusava. Agora existe `read_pdf`:

```json
{ "name": "read_pdf", "arguments": { "url": "https://arxiv.org/pdf/1706.03762", "maxChars": 8000 } }
```

**Como funciona** — e por que continua com zero dependências:

1. baixa os **bytes crus** (`fetchBytes`, o mesmo transporte com SSRF, robots,
   cache e junção em voo) — decodificar PDF como texto corromperia o arquivo;
2. acha os objetos `stream ... endstream` e infla os que usam FlateDecode
   (com `node:zlib`, alternando `inflate`/`inflateRaw`/`gunzip`);
3. reconhece os **content streams** (os que têm `BT` + `Tj`/`TJ`) e os varre com
   um interpretador dos operadores de texto: `Tf` dá o tamanho da fonte, `Td`/`TD`
   dão a mudança de linha, `Tm` a posição, `Tj`/`'`/`"` desenham, e o `TJ` vem com
   ajustes de kerning — um número muito negativo ali é **espaço entre palavras**,
   que é como os espaços são reconstruídos (sem isso o texto sai colado);
4. normaliza espaços/quebras, trunca em `maxChars` com o aviso de sempre e
   guarda o **texto pronto** no cache (reler não reparseia o PDF).

**Honestidade sobre o limite:** não há OCR. Um PDF escaneado (só imagem) não tem
camada de texto e a ferramenta devolve `Conteudo: 0 caracteres` explicando que
não consegue. Do mesmo jeito, PDF antigo com fonte de encoding próprio e sem mapa
`ToUnicode` pode devolver glifos errados — a ferramenta nunca finge que leu.

**Medido na web real** (`dev/_check-pdf-live.mjs`): o artigo *Attention Is All You
Need* (arXiv, 2,2 MB, 15 páginas) devolveu **39.284 caracteres** de texto legível,
com espaços entre palavras e quebras de linha corretas.

## read_feed e read_json (feed e API, sem virar HTML)

O `read_page` é só-HTML por desenho — então um feed RSS e a resposta de uma API
pública eram dois caminhos legítimos de leitura que simplesmente não existiam.
Agora existem:

```json
{ "name": "read_feed", "arguments": { "url": "https://exemplo.com/feed.xml", "limit": 20 } }
{ "name": "read_json", "arguments": { "url": "https://api.exemplo.com/dados.json", "path": "data.items" } }
```

- **`read_feed`** entende RSS 2.0/RDF, Atom e JSON Feed, com um parser de XML
  próprio (CDATA e entidades tratadas — o texto sai, a marcação não). Devolve
  título, link, data, autor e resumo de cada item. Não segue os links: para o
  texto completo, `read_page`.
- **`read_json`** pareia o corpo, declara a forma (objeto com N chaves / array de
  N itens) e aceita `path` (`data.items`) para entregar só o ramo que interessa,
  sem a IA ter que garimpar o envelope.

Se a URL for HTML, as duas explicam e apontam a ferramenta certa — nunca devolvem
"vazio" silencioso.

## find_on_page e diff_page (ler menos para ler melhor)

- **`find_on_page(url, query)`** busca um termo e devolve **só os trechos que
  casam**, com número de linha e contexto. Aceita texto literal (inclusive com
  caracteres de regex, sem surpresa) ou expressão regular com `regex: true`.
  Achar um preço numa leitura de 25.000 caracteres deixou de custar os 25.000.
- **`diff_page(url)`** relê a URL, compara com a marca da leitura anterior e
  devolve só o que mudou (linhas `+` e `-`). A primeira chamada grava o ponto de
  comparação; `force: true` regrava sem comparar ("marque como lido"). A marca é
  um hash + o texto normalizado, com TTL — não páginas inteiras em memória.

## Sessão e SSE (a spec do transporte HTTP)

O transporte HTTP do MCP prevê `Mcp-Session-Id` desde a revisão `2025-03-26`.
O servidor agora:

- **emite** o `Mcp-Session-Id` na resposta do `initialize` (cliente que ignora
  não é afetado — o header é aditivo);
- **abre canal SSE** no `GET /mcp` para uma sessão ativa (com `ping` de
  keep-alive) e **encerra** no `DELETE /mcp`;
- **não exige** o header nas chamadas seguintes: exigir quebraria todo cliente
  que já funciona hoje, e a spec permite servidor stateless. Quem manda o header
  é reconhecido; quem não manda é atendido como sempre.

O `/health` mostra `sessoes: N (canais M)`.

## Como as falhas aparecem na saída

A saída é consumida por uma IA, então **uma falha nunca pode parecer "página
vazia"**. O contrato é:

| Situação | O que a ferramenta devolve |
| --- | --- |
| `read_page` / `extract_links` / `read_dynamic_page` com URL bloqueada, DNS, timeout ou HTTP ruim | `isError: true` com a mensagem do motivo |
| `read_video` sem acesso à legenda (robots, corpo vazio ou faixa ausente) | **não** é erro: devolve os metadados e o campo `Transcricao: indisponivel — <motivo>`. Sem vídeo identificável na página, devolve mensagem explicando e apontando o `read_page` |
| `read_pdf` de PDF escaneado (só imagem) | **não** é erro: devolve `Conteudo: 0 caracteres` e explica que não há camada de texto (não há OCR) |
| `read_pdf` de URL que não é PDF | **não** é erro: avisa que o conteúdo não tem a assinatura `%PDF-` e aponta o `read_page` |
| `crawl_site` com a **URL inicial** ruim | `isError: true` — `Nao foi possivel iniciar o crawl em <url>: <motivo>` |
| `crawl_site` com falha **no meio** do crawl | continua e devolve o que leu, com `RESULTADO PARCIAL: N pagina(s) falharam — 2 com HTTP 404, 1 com timeout`, e cada página ruim marcada com `# Erro ao ler <url>` |
| `read_multiple_pages` com falha em alguma URL | a chamada **não** é erro (o isolamento por URL é proposital); o resumo traz `N paginas OK` e cada falha vem marcada com `# Erro ao ler <url>` |
| `discover_urls` sem sitemap e sem links internos | mensagem explicando isso (não é erro) |
| `read_feed` numa URL que é HTML | **não** é erro: avisa que não é feed e, se a página anuncia um `<link rel="alternate" type="application/rss+xml">`, aponta a URL do feed |
| `read_json` num corpo que não é JSON | **não** é erro: `JSON invalido` com o motivo, e aponta `read_page` quando o corpo é HTML |
| `find_on_page` sem ocorrências | **não** é erro: avisa que não achou e diz quantas linhas/caracteres a página tem |
| `diff_page` na primeira leitura de uma URL | **não** é erro: grava a marca e avisa que não havia ponto de comparação |

## Limitações conhecidas

- Páginas atrás de login não funcionam (o fetch é anônimo).
- O conteúdo é truncado em **8000 caracteres** por padrão (ajustável via `maxChars`, teto de 25000).
- Sites com proteção anti-bot muito agressiva podem barrar a requisição.
- **DNS rebinding:** a janela entre resolver o nome (para checar se é
  endereço interno) e conectar está **fechada**: a conexão sai por
  `node:http`/`node:https` com um Agent cujo `lookup` retorna apenas o IP já
  validado (`src/net.mjs`) — o nome nunca é resolvido de novo. O teste
  correspondente conecta num host que não resolve e prova que o IP fixado é
  quem recebe a conexão.
- Só o que o site embute no HTML é extraído: JavaScript que monta o conteúdo
  depois do carregamento (client-side puro) não aparece.
