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
| `read_dynamic_page(url)`    | Lê páginas que dependem de JavaScript (Playwright, instalação opcional)                 |
| `discover_urls(url)`        | Descobre as URLs de um site pelo sitemap.xml (ou links internos da home)                |
| `crawl_site(url)`           | Varre um site sozinho: lê a URL inicial e segue os links internos (BFS), até 30 páginas |

## Como testar

```bash
node scripts/smoke-test.mjs
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
├── server.js          <- o servidor MCP
├── package.json
├── render.yaml        <- config do Render (precisa estar na raiz do repo)
├── README.md
└── scripts/
    ├── smoke-test.mjs
    ├── demo-multiple.mjs
    └── benchmark.mjs
```

(se um dia instalar o Playwright, crie um `.gitignore` com `node_modules/` antes
do `git add .`, senao ele sobe a pasta inteira do Playwright pro GitHub)

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
4. Teste: `curl https://SEU-APP.onrender.com/health` deve voltar  
   `web-reader-mcp v1.0.0 OK`.

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

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `ALLOW_PRIVATE_HOSTS` | desligada | `1` **desliga** o bloqueio de hosts privados/internos. Só para desenvolvimento e testes locais (o `smoke-test` e os scripts apontam para `127.0.0.1`). **No Render ela fica desligada** — não defina essa variável em produção. |
| `TRUST_PROXY_HOPS` | `0` | Quantas entradas do `x-forwarded-for` confiar, contando da **direita**. Veja *Rate limit* abaixo. |

### Rate limit e `x-forwarded-for`

O limite é de **60 requisições por minuto por cliente**. A chave do limite é o IP do
socket (`req.socket.remoteAddress`), e **não** o `x-forwarded-for` — esse header é
escrito pelo cliente e era usado antigamente como chave, o que permitia burlar o limite
inteiro só rotacionando o valor dele.

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
- **30 URLs por chamada**, lotes de 6: pesquisa rápida sem estourar memória.
- **`read_dynamic_page` (Playwright) no Render**: só no plano pago, build com  
  `npx playwright install --with-deps chromium` (o free não tem RAM pra Chromium).  
  Em Cloudflare Workers/Pages **não roda de jeito nenhum** (serverless, sem processo).
- **Cloudflare x Render são coisas diferentes**: a Cloudflare hospeda **seu site**;  
  o Render hospeda **o MCP**. Não precisa migrar nada — o site continua na  
  Cloudflare e só faz POST pro Render.

## read_dynamic_page (opcional)

Para páginas cujo conteúdo só aparece depois de executar JavaScript (SPAs, infinite scroll):

```bash
cd "C:\Users\Administrator\Desktop\FORA lula\web-reader-mcp"
npm install playwright
npx playwright install chromium
```

Sem isso, a ferramenta responde com um erro explicando como instalar — as outras três funcionam normalmente.

## Limitações conhecidas

- Páginas atrás de login não funcionam (o fetch é anônimo).
- O conteúdo é truncado em 5000 caracteres por padrão (ajustável via `maxChars`).
- Sites com proteção anti-bot muito agressiva podem barrar a requisição.
