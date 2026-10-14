# web-reader-mcp

Servidor **MCP feito do zero** para ler páginas web.

- **Zero dependências** — nenhum `npm install` necessário (só Node 18+).
- **Sem API key e sem scraping de buscador** — não existe chamada a Google, Bing, DuckDuckGo ou similar. A "pesquisa" é feita pela própria IA: ela descobre URLs com `extract_links` e lê o conteúdo com `read_page`.
- **Protocolo MCP implementado à mão** — JSON-RPC newline-delimited direto no stdio, sem usar o SDK do MCP.
- **Parser HTML → markdown também feito à mão** — tokenizador próprio, sem cheerio/jsdom.

## Ferramentas

| Ferramenta                  | O que faz                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `read_page(url)`            | Lê uma página e devolve título, meta descrição e o conteúdo em markdown                 |
| `extract_links(url)`        | Lista os links da página (texto + URL absoluta, marca interno/externo)                  |
| `read_multiple_pages(urls)` | Lê até 30 páginas por chamada (em lotes paralelos), com status por URL                  |
| `read_dynamic_page(url)`    | Lê páginas que dependem de JavaScript extraindo os dados embutidos no HTML (sem navegador) |
| `discover_urls(url)`        | Descobre as URLs de um site pelo sitemap.xml (ou links internos da home)                |
| `crawl_site(url)`           | Varre um site sozinho: lê a URL inicial e segue os links internos (BFS), até 30 páginas |

## Como testar

### Testes automatizados (`node:test`, sem dependências)

```bash
npm test
```

Roda nove arquivos em `tests/` (66 testes, ~30 s, sem rede na maioria):

| Arquivo | O que cobre |
| --- | --- |
| `tests/parser.test.mjs` | o parser HTML → markdown: `<` solto no texto, indentação de blocos de código (Python/YAML), tabelas GFM válidas, entidades acentuadas e numéricas |
| `tests/security.test.mjs` | SSRF (hosts privados, IPv4 mapeado, redirects, limite de saltos) e rate limit (não burlável por `x-forwarded-for`) |
| `tests/cache.test.mjs` | cache: teto em bytes, despejo LRU, entrada grande demais, contabilidade correta na expiração |
| `tests/crawl.test.mjs` | `crawl_site` com a URL inicial bloqueada devolve `isError`; crawl parcial resume os motivos das falhas |
| `tests/internal-api.test.mjs` | busca automática de `/api/...` do `read_page`: teto de candidatos, dedupe, priorização e orçamento de tempo |
| `tests/dynamic.test.mjs` | `read_dynamic_page`: cabeçalho aparece uma única vez, sem perder informação |
| `tests/robustness.test.mjs` | 413 no corpo grande, token de tamanho diferente sem exceção, `Retry-After`, SIGTERM |
| `tests/limits.test.mjs` | controle de carga: limite de downloads respeitado, fila cheia recusa com erro claro, orçamento de memória reservado e devolvido, 503 sob saturação, `/health` isento do controle |
| `tests/integration.test.mjs` | a web pública de verdade: ler página https, seguir redirect http→https, extrair tabelas |

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
npm run test:e2e
```

Roda um cliente MCP mínimo que conecta no servidor, lista as ferramentas e exercita todas elas.

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
├── server.js          <- o servidor MCP (single-file, de proposito)
├── package.json
├── render.yaml        <- config do Render (precisa estar na raiz do repo)
├── .gitignore
├── README.md
├── RELATORIO-CAMPO.md <- relatorio da rodada de campo na web real (nota 7,5/10)
├── tests/             <- testes automatizados (node:test, sem dependencias)
├── campo/             <- bateria de campo: driver + saidas brutas de 70 casos
├── load/              <- harness de carga e script k6
└── scripts/           <- clientes MCP manuais (smoke-test, live-test)
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
   `web-reader-mcp v1.1.0 OK | cache: 0 entradas, 0 bytes / 67108864 bytes (max 100 entradas, ttl 10 min)`.
   A versão vem da constante `SERVER_VERSION` no `server.js`, e o `/health` também
   informa o uso atual do cache (entradas e bytes) — é assim que dá para observar
   o cache em produção.

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
  metadata `169.254.169.254`), `172.16/12`, `192.168/16`, `224/4` (multicast) e acima.
- IPv6: `::1`, `::`, `fe80::/10`, `fc00::/7`, `ff00::/8` e IPv4 mapeado/NAT64/6to4
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

**Limitação conhecida:** sobra uma janela de DNS rebinding entre a resolução do nome e a
conexão, porque o `fetch` do Node não permite fixar o IP de destino. Está documentada no
código (`assertPublicHost` em `server.js`).

### Variáveis de ambiente

Todas são opcionais menos `MCP_AUTH_TOKEN` (que é obrigatória em produção). No
`render.yaml` já vêm configuradas as duas que importam.

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `MCP_AUTH_TOKEN` | *(vazio)* | Token do header `Authorization: Bearer <token>`. **Vazio = `/mcp` aberto para qualquer um**, e o servidor avisa isso no boot. No Render o `render.yaml` usa `generateValue: true`, então o valor é gerado e fica só no dashboard. |
| `PORT` | `3000` | Porta do modo HTTP. O Render define sozinha; a presença dela é o que escolhe o modo HTTP (sem `PORT` → stdio). |
| `ALLOW_PRIVATE_HOSTS` | desligada | `1` **desliga** o bloqueio de hosts privados/internos (SSRF). Só para desenvolvimento e testes locais. **No Render fica desligada** — não defina em produção. |
| `TRUST_PROXY_HOPS` | `0` | Quantas entradas do `x-forwarded-for` confiar, contando da **direita**. `render.yaml` usa `1`. Veja *Rate limit* abaixo. |
| `CACHE_MAX_BYTES` | `67108864` (64 MB) | Teto do cache em bytes. É o teto que importa; ao estourar, despeja os menos usados. |
| `CACHE_TTL_MS` | `600000` (10 min) | Validade de cada entrada do cache. |
| `MAX_RESPONSE_BYTES` | `10485760` (10 MB) | Teto de download por requisição, lido em streaming com corte. |
| `MAX_BODY_BYTES` | `1048576` (1 MB) | Teto do corpo do POST em `/mcp`. Acima disso responde **413**. |
| `FETCH_CONCURRENCY` | `6` | Quantas páginas são baixadas em paralelo por `read_multiple_pages` e `crawl_site`. É o teto de memória simultânea. |
| `API_MAX_CANDIDATES` | `3` | Máximo de `/api/...` que o `read_page` busca sozinho. `0` desliga essa busca. |
| `API_TOTAL_BUDGET_MS` | `10000` (10 s) | Orçamento total dessa busca de APIs internas. |
| `MAX_INFLIGHT_REQUESTS` | `128` | Quantas requisições são processadas ao mesmo tempo. Calibrado pelo **joelho da curva de capacidade** (~64 no hardware de referência). **Aumentar não aumenta a vazão** — só a fila. |
| `MAX_WAITING_REQUESTS` | `4096` | Quantas esperam por uma vaga. `0` = recusa na hora. |
| `MAX_WAIT_MS` | `15000` (15 s) | Teto de espera por uma vaga; depois disso, **503 com `Retry-After`**. Deve ser menor que o timeout do seu cliente MCP. |
| `OUTBOUND_MAX_CONCURRENCY` | `128` | Downloads simultâneos (limita sockets/tarefas). |
| `OUTBOUND_MAX_QUEUE` | `200` | Quantos downloads esperam por vaga. Fila cheia = erro claro e imediato. |
| `OUTBOUND_MEMORY_BUDGET` | `134217728` (128 MB) | **O teto de memória que importa**: cada download reserva `min(content-length, MAX_RESPONSE_BYTES)` **antes** de ler. É por bytes, não por número de downloads — muitas páginas pequenas passam juntas, poucas grandes são limitadas. |
| `HTTP_KEEPALIVE_TIMEOUT_MS` | `65000` | Keep-alive do servidor. O padrão do Node é 5 s, o que causa **churn de conexão** sob carga; e precisa ser **maior que o idle timeout do balanceador**, senão dá 502. |
| `HTTP_HEADERS_TIMEOUT_MS` | `66000` | Precisa ser ≥ keep-alive. |
| `HTTP_REQUEST_TIMEOUT_MS` | `300000` | Precisa ser ≥ headers. |
| `MAX_CONNECTIONS` | `0` (sem teto) | Teto de conexões aceitas; `0` deixa o limite para o SO. |
| `RATE_LIMIT_MAX` | `60` | Requisições por janela, por cliente. O `render.yaml` usa **10000**: quando quem chama é o backend de um site, todos os usuários chegam pelo mesmo IP e 60/min seria um balde único para o site inteiro. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Tamanho da janela do rate limit. |

Uma variável só de teste, usada pela suíte: `TEST_SERVER_PATH`, que aponta os
testes para outra cópia do `server.js` (serve para provar que os testes falham
numa versão antiga).

### Capacidade e carga

O teto deste serviço é **CPU de um núcleo**: ~310 req/s por núcleo, porque cada
página custa ~3 ms de `tokenize` + `htmlToMarkdown`. Não é HTTP, cache nem fila.

Curva medida (`node load/harness.mjs --mode read --delay 150`):

| Concorrência | Vazão | p50 | Sucesso |
| --- | --- | --- | --- |
| 32 | 182 req/s | 171 ms | 100% |
| **64** | **309 req/s** | **189 ms** | 100% |
| 128 | 311 req/s | 364 ms | 100% |
| 2.000 | 293 req/s | 6,3 s | 100% |

O **joelho está em ~64 simultâneas**. Repare que 10.000 clientes respeitando o
rate limit (60/min cada) geram apenas **166 req/s** — isso é o caso real, e cai
confortavelmente à esquerda do joelho. Já 10.000 requisições *em voo* não cabem
numa instância: o servidor atende o que pode e responde **503 explícito** para o
resto, sem estourar a memória.

Para testar carga:

```bash
node load/harness.mjs --concurrency 64 --seconds 15 --mode read --delay 150
k6 run -e MCP_URL=http://127.0.0.1:3000/mcp -e MCP_TOKEN=t load/k6.js
```

O `k6` não é dependência do projeto — instale à parte (`winget`/`brew`/`apt`).
Os números antes/depois do tuning e o caminho para 10k req/s ficaram registrados
no histórico de commits do repositório (rodada de capacidade de outubro de 2026);
tudo continua recuperável pelo git.

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
- **30 URLs por chamada**, em lotes de 6 (`FETCH_CONCURRENCY`): pesquisa rápida
  sem estourar memória.
- **Orçamento de memória no plano free (512 MB)** — os tetos foram escolhidos
  para caber com folga:
  - cache: `CACHE_MAX_BYTES` (64 MB) — é o teto real; a contagem de 100 entradas
    é o segundo teto.
  - download por requisição: `MAX_RESPONSE_BYTES` (10 MB), lido em **streaming**
    com corte (não carrega a resposta inteira antes de conferir).
  - pico simultâneo: 6 requisições em paralelo × 10 MB = 60 MB transitórios.
  - Se subir `FETCH_CONCURRENCY` ou `MAX_RESPONSE_BYTES`, refaça essa conta.
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

- **no máximo `API_MAX_CANDIDATES`** (padrão 3) candidatos;
- **orçamento total de `API_TOTAL_BUDGET_MS`** (padrão 10 s), depois disso devolve
  o que já obteve e segue, sem erro;
- só o **mesmo domínio** da página (e passando pela guarda SSRF);
- deduplicados e priorizados: caminho com cara de dados (`json`, `graphql`, `api`)
  ganha pontos, asset estático (`.png`, `.css`, `.js`, `.woff`) perde e não ocupa vaga.

## Como as falhas aparecem na saída

A saída é consumida por uma IA, então **uma falha nunca pode parecer "página
vazia"**. O contrato é:

| Situação | O que a ferramenta devolve |
| --- | --- |
| `read_page` / `extract_links` / `read_dynamic_page` com URL bloqueada, DNS, timeout ou HTTP ruim | `isError: true` com a mensagem do motivo |
| `crawl_site` com a **URL inicial** ruim | `isError: true` — `Nao foi possivel iniciar o crawl em <url>: <motivo>` |
| `crawl_site` com falha **no meio** do crawl | continua e devolve o que leu, com `RESULTADO PARCIAL: N pagina(s) falharam — 2 com HTTP 404, 1 com timeout`, e cada página ruim marcada com `# Erro ao ler <url>` |
| `read_multiple_pages` com falha em alguma URL | a chamada **não** é erro (o isolamento por URL é proposital); o resumo traz `N paginas OK` e cada falha vem marcada com `# Erro ao ler <url>` |
| `discover_urls` sem sitemap e sem links internos | mensagem explicando isso (não é erro) |

## Limitações conhecidas

- Páginas atrás de login não funcionam (o fetch é anônimo).
- O conteúdo é truncado em **8000 caracteres** por padrão (ajustável via `maxChars`).
- Sites com proteção anti-bot muito agressiva podem barrar a requisição.
- **DNS rebinding:** sobra uma janela entre resolver o nome (para checar se é
  endereço interno) e conectar, porque o `fetch` do Node não deixa fixar o IP de
  destino. Fechar isso exigiria abrir o socket na mão ou usar dependência.
- Só o que o site embute no HTML é extraído: JavaScript que monta o conteúdo
  depois do carregamento (client-side puro) não aparece.
