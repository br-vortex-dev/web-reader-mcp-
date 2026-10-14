# caso 5: [A] github-blob-package
ferramenta: read_page
argumentos: {"url":"https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/package.json","maxChars":3000}
nota do teste: pagina de arquivo de codigo no GitHub
status HTTP: 200 | tempo: 593 ms | isError: false
sinais: chars=1991 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=5

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# web-reader-mcp-/package.json at main · br-vortex-dev/web-reader-mcp- · GitHub\nURL: https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/package.json\nDescricao: Contribute to br-vortex-dev/web-reader-mcp- development by creating an account on GitHub.\nConteudo: 1706 caracteres\n\nSkip to content\n\n You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert\n\n [](https://github.com/br-vortex-dev/web-reader-mcp-)\n\n## Expand file tree\n\n/\n\n# package.json\n\nCopy path\n\nMore file actions\n\nMore file actions\n\n## Latest commit\n\n## History\n\n[History](https://github.com/br-vortex-dev/web-reader-mcp-/commits/main/package.json)\n\n[](https://github.com/br-vortex-dev/web-reader-mcp-/commits/main/package.json)History\n\n17 lines (17 loc) · 710 Bytes\n\n/\n\n# package.json\n\nCopy path\n\n## File metadata and controls\n\n-\n-\n\n17 lines (17 loc) · 710 Bytes\n\n[Raw](https://github.com/br-vortex-dev/web-reader-mcp-/raw/refs/heads/main/package.json)\n\nCopy raw file\n\nDownload raw file\n\nOpen symbols panel\nEdit and raw actions\n\n1\n\n2\n\n3\n\n4\n\n5\n\n6\n\n7\n\n8\n\n9\n\n10\n\n11\n\n12\n\n13\n\n14\n\n15\n\n16\n\n17\n\n{\n\n \"name\": \"web-reader-mcp\",\n\n \"version\": \"1.0.0\",\n\n \"description\": \"MCP feito do zero (zero dependencias) para ler paginas web, extrair links e renderizar paginas com JavaScript. Sem API key, sem scraping de buscador.\",\n\n \"type\": \"module\",\n\n \"main\": \"server.js\",\n\n \"license\": \"MIT\",\n\n \"engines\": {\n\n \"node\": \">=18\"\n\n },\n\n \"scripts\": {\n\n \"start\": \"node server.js\",\n\n \"test\": \"node --test tests/cache.test.mjs tests/limits.test.mjs tests/crawl.test.mjs tests/dynamic.test.mjs tests/internal-api.test.mjs tests/parser.test.mjs tests/robustness.test.mjs tests/security.test.mjs tests/integration.test.mjs\",\n\n \"test:e2e\": \"node scripts/smoke-test.mjs\",\n\n \"test:live\": \"node scripts/live-test.mjs\"\n\n }\n\n}\n\n You can’t perform that action at this time."
      }
    ]
  }
}
```

## texto extraido
```
# web-reader-mcp-/package.json at main · br-vortex-dev/web-reader-mcp- · GitHub
URL: https://github.com/br-vortex-dev/web-reader-mcp-/blob/main/package.json
Descricao: Contribute to br-vortex-dev/web-reader-mcp- development by creating an account on GitHub.
Conteudo: 1706 caracteres

Skip to content

 You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert

 [](https://github.com/br-vortex-dev/web-reader-mcp-)

## Expand file tree

/

# package.json

Copy path

More file actions

More file actions

## Latest commit

## History

[History](https://github.com/br-vortex-dev/web-reader-mcp-/commits/main/package.json)

[](https://github.com/br-vortex-dev/web-reader-mcp-/commits/main/package.json)History

17 lines (17 loc) · 710 Bytes

/

# package.json

Copy path

## File metadata and controls

-
-

17 lines (17 loc) · 710 Bytes

[Raw](https://github.com/br-vortex-dev/web-reader-mcp-/raw/refs/heads/main/package.json)

Copy raw file

Download raw file

Open symbols panel
Edit and raw actions

1

2

3

4

5

6

7

8

9

10

11

12

13

14

15

16

17

{

 "name": "web-reader-mcp",

 "version": "1.0.0",

 "description": "MCP feito do zero (zero dependencias) para ler paginas web, extrair links e renderizar paginas com JavaScript. Sem API key, sem scraping de buscador.",

 "type": "module",

 "main": "server.js",

 "license": "MIT",

 "engines": {

 "node": ">=18"

 },

 "scripts": {

 "start": "node server.js",

 "test": "node --test tests/cache.test.mjs tests/limits.test.mjs tests/crawl.test.mjs tests/dynamic.test.mjs tests/internal-api.test.mjs tests/parser.test.mjs tests/robustness.test.mjs tests/security.test.mjs tests/integration.test.mjs",

 "test:e2e": "node scripts/smoke-test.mjs",

 "test:live": "node scripts/live-test.mjs"

 }

}

 You can’t perform that action at this time.
```