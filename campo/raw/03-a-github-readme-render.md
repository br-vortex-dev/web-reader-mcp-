# caso 3: [A] github-readme-render
ferramenta: read_page
argumentos: {"url":"https://github.com/br-vortex-dev/web-reader-mcp-","maxChars":6000}
nota do teste: README renderizado no GitHub
status HTTP: 200 | tempo: 1795 ms | isError: false
sinais: chars=6368 tabelas=4 cercas=2 truncado=true mojibake=false cjk=false rtl=false links=32

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# GitHub - br-vortex-dev/web-reader-mcp- · GitHub\nURL: https://github.com/br-vortex-dev/web-reader-mcp-\nDescricao: Contribute to br-vortex-dev/web-reader-mcp- development by creating an account on GitHub.\nConteudo: 25742 caracteres (exibidos 6119)\n\nSkip to content\n\n You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert\n\n [](https://github.com/br-vortex-dev/web-reader-mcp-)\n\n[Branches](https://github.com/br-vortex-dev/web-reader-mcp-/branches)[Tags](https://github.com/br-vortex-dev/web-reader-mcp-/tags)\n\n[](https://github.com/br-vortex-dev/web-reader-mcp-/branches)[](https://github.com/br-vortex-dev/web-reader-mcp-/tags)\n\nOpen more actions menu\n\n## Latest commit\n\n## History\n\n[22 Commits](https://github.com/br-vortex-dev/web-reader-mcp-/commits/main/)\n\n[](https://github.com/br-vortex-dev/web-reader-mcp-/commits/main/)22 Commits\n\n## Folders and files\n\n| Name | Name | Last commit message | Last commit date |\n| --- | --- | --- | --- |\n| [load](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/load) | [load](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/load) | | |\n| [scripts](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/scripts) | [scripts](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/scripts) | | |\n| [tests](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/tests) | [tests](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/tests) | | |\n| [.gitignore](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/.gitignore) | [.gitignore](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/.gitignore) | | |\n| [README.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/README.md) | [README.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/README.md) | | |\n| [RELATORIO-CAPACIDADE.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-CAPACIDADE.md) | [RELATORIO-CAPACIDADE.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-CAPACIDADE.md) | | |\n| [RELATORIO-CORRECOES.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-CORRECOES.md) | [RELATORIO-CORRECOES.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-CORRECOES.md) | | |\n| [RELATORIO-RODADA2.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-RODADA2.md) | [RELATORIO-RODADA2.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-RODADA2.md) | | |\n| [REVISAO-CODIGO.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/REVISAO-CODIGO.md) | [REVISAO-CODIGO.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/REVISAO-CODIGO.md) | | |\n| [package.json](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/package.json) | [package.json](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/package.json) | | |\n| [render.yaml](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/render.yaml) | [render.yaml](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/render.yaml) | | |\n| [server.js](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/server.js) | [server.js](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/server.js) | | |\n| | | | |\n\n## Repository files navigation\n\n# web-reader-mcp\n\nServidor **MCP feito do zero** para ler páginas web.\n\n - **Zero dependências** — nenhum `npm install` necessário (só Node 18+).\n - **Sem API key e sem scraping de buscador** — não existe chamada a Google, Bing, DuckDuckGo ou similar. A \"pesquisa\" é feita pela própria IA: ela descobre URLs com `extract_links` e lê o conteúdo com `read_page`.\n - **Protocolo MCP implementado à mão** — JSON-RPC newline-delimited direto no stdio, sem usar o SDK do MCP.\n - **Parser HTML → markdown também feito à mão** — tokenizador próprio, sem cheerio/jsdom.\n\n## Ferramentas\n\n| Ferramenta | O que faz |\n| --- | --- |\n| `read_page(url)` | Lê uma página e devolve título, meta descrição e o conteúdo em markdown |\n| `extract_links(url)` | Lista os links da página (texto + URL absoluta, marca interno/externo) |\n| `read_multiple_pages(urls)` | Lê até 30 páginas por chamada (em lotes paralelos), com status por URL |\n| `read_dynamic_page(url)` | Lê páginas que dependem de JavaScript extraindo os dados embutidos no HTML (sem navegador) |\n| `discover_urls(url)` | Descobre as URLs de um site pelo sitemap.xml (ou links internos da home) |\n| `crawl_site(url)` | Varre um site sozinho: lê a URL inicial e segue os links internos (BFS), até 30 páginas |\n\n## Como testar\n\n### Testes automatizados (`node:test`, sem dependências)\n\n```\nnpm test\n```\n\nRoda nove arquivos em `tests/` (66 testes, ~30 s, sem rede na maioria):\n\n| Arquivo | O que cobre |\n| --- | --- |\n| `tests/parser.test.mjs` | o parser HTML → markdown: `<` solto no texto, indentação de blocos de código (Python/YAML), tabelas GFM válidas, entidades acentuadas e numéricas |\n| `tests/security.test.mjs` | SSRF (hosts privados, IPv4 mapeado, redirects, limite de saltos) e rate limit (não burlável por `x-forwarded-for`) |\n| `tests/cache.test.mjs` | cache: teto em bytes, despejo LRU, entrada grande demais, contabilidade correta na expiração |\n| `tests/crawl.test.mjs` | `crawl_site` com a URL inicial bloqueada devolve `isError`; crawl parcial resume os motivos das falhas |\n| `tests/internal-api.test.mjs` | busca automática de `/api/...` do `read_page`: teto de candidatos, dedupe, priorização e orçamento de tempo |\n| `tests/dynamic.test.mjs` | `read_dynamic_page`: cabeçalho aparece uma única vez, sem perder informação |\n| `tests/robustness.test.mjs` | 413 no corpo grande, token de tamanho diferente sem exceção, `Retry-After`, SIGTERM |\n| `tests/limits.test.mjs` | controle de carga: limite de downloads respeitado, fila cheia recusa com erro claro, orçamento de memória reservado e devolvido, 503 sob saturação, `/health` isento do controle |\n| `tests/integration.test.mjs` | a web pública de verdade: ler página https, seguir redirect http→https, extrair tabelas |\n\nCada teste sobe o servidor MCP de verdade (`--http`) numa porta livre, mais um servidor d\n\n[... conteudo truncado em 6000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# GitHub - br-vortex-dev/web-reader-mcp- · GitHub
URL: https://github.com/br-vortex-dev/web-reader-mcp-
Descricao: Contribute to br-vortex-dev/web-reader-mcp- development by creating an account on GitHub.
Conteudo: 25742 caracteres (exibidos 6119)

Skip to content

 You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert

 [](https://github.com/br-vortex-dev/web-reader-mcp-)

[Branches](https://github.com/br-vortex-dev/web-reader-mcp-/branches)[Tags](https://github.com/br-vortex-dev/web-reader-mcp-/tags)

[](https://github.com/br-vortex-dev/web-reader-mcp-/branches)[](https://github.com/br-vortex-dev/web-reader-mcp-/tags)

Open more actions menu

## Latest commit

## History

[22 Commits](https://github.com/br-vortex-dev/web-reader-mcp-/commits/main/)

[](https://github.com/br-vortex-dev/web-reader-mcp-/commits/main/)22 Commits

## Folders and files

| Name | Name | Last commit message | Last commit date |
| --- | --- | --- | --- |
| [load](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/load) | [load](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/load) | | |
| [scripts](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/scripts) | [scripts](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/scripts) | | |
| [tests](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/tests) | [tests](https://github.com/br-vortex-dev/web-reader-mcp-/tree/main/tests) | | |
| [.gitignore](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/.gitignore) | [.gitignore](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/.gitignore) | | |
| [README.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/README.md) | [README.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/README.md) | | |
| [RELATORIO-CAPACIDADE.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-CAPACIDADE.md) | [RELATORIO-CAPACIDADE.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-CAPACIDADE.md) | | |
| [RELATORIO-CORRECOES.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-CORRECOES.md) | [RELATORIO-CORRECOES.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-CORRECOES.md) | | |
| [RELATORIO-RODADA2.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-RODADA2.md) | [RELATORIO-RODADA2.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/RELATORIO-RODADA2.md) | | |
| [REVISAO-CODIGO.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/REVISAO-CODIGO.md) | [REVISAO-CODIGO.md](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/REVISAO-CODIGO.md) | | |
| [package.json](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/package.json) | [package.json](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/package.json) | | |
| [render.yaml](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/render.yaml) | [render.yaml](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/render.yaml) | | |
| [server.js](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/server.js) | [server.js](https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/server.js) | | |
| | | | |

## Repository files navigation

# web-reader-mcp

Servidor **MCP feito do zero** para ler páginas web.

 - **Zero dependências** — nenhum `npm install` necessário (só Node 18+).
 - **Sem API key e sem scraping de buscador** — não existe chamada a Google, Bing, DuckDuckGo ou similar. A "pesquisa" é feita pela própria IA: ela descobre URLs com `extract_links` e lê o conteúdo com `read_page`.
 - **Protocolo MCP implementado à mão** — JSON-RPC newline-delimited direto no stdio, sem usar o SDK do MCP.
 - **Parser HTML → markdown também feito à mão** — tokenizador próprio, sem cheerio/jsdom.

## Ferramentas

| Ferramenta | O que faz |
| --- | --- |
| `read_page(url)` | Lê uma página e devolve título, meta descrição e o conteúdo em markdown |
| `extract_links(url)` | Lista os links da página (texto + URL absoluta, marca interno/externo) |
| `read_multiple_pages(urls)` | Lê até 30 páginas por chamada (em lotes paralelos), com status por URL |
| `read_dynamic_page(url)` | Lê páginas que dependem de JavaScript extraindo os dados embutidos no HTML (sem navegador) |
| `discover_urls(url)` | Descobre as URLs de um site pelo sitemap.xml (ou links internos da home) |
| `crawl_site(url)` | Varre um site sozinho: lê a URL inicial e segue os links internos (BFS), até 30 páginas |

## Como testar

### Testes automatizados (`node:test`, sem dependências)

```
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

Cada teste sobe o servidor MCP de verdade (`--http`) numa porta livre, mais um servidor d

[... conteudo truncado em 6000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```