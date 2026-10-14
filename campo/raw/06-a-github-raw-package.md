# caso 6: [A] github-raw-package
ferramenta: read_page
argumentos: {"url":"https://raw.githubusercontent.com/br-vortex-dev/web-reader-mcp-/main/package.json","maxChars":3000}
nota do teste: mesmo arquivo, versao raw
status HTTP: 200 | tempo: 220 ms | isError: false
sinais: chars=797 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# (sem titulo)\nURL: https://raw.githubusercontent.com/br-vortex-dev/web-reader-mcp-/main/package.json\nConteudo: 669 caracteres\n\n{ \"name\": \"web-reader-mcp\", \"version\": \"1.0.0\", \"description\": \"MCP feito do zero (zero dependencias) para ler paginas web, extrair links e renderizar paginas com JavaScript. Sem API key, sem scraping de buscador.\", \"type\": \"module\", \"main\": \"server.js\", \"license\": \"MIT\", \"engines\": { \"node\": \">=18\" }, \"scripts\": { \"start\": \"node server.js\", \"test\": \"node --test tests/cache.test.mjs tests/limits.test.mjs tests/crawl.test.mjs tests/dynamic.test.mjs tests/internal-api.test.mjs tests/parser.test.mjs tests/robustness.test.mjs tests/security.test.mjs tests/integration.test.mjs\", \"test:e2e\": \"node scripts/smoke-test.mjs\", \"test:live\": \"node scripts/live-test.mjs\" } }"
      }
    ]
  }
}
```

## texto extraido
```
# (sem titulo)
URL: https://raw.githubusercontent.com/br-vortex-dev/web-reader-mcp-/main/package.json
Conteudo: 669 caracteres

{ "name": "web-reader-mcp", "version": "1.0.0", "description": "MCP feito do zero (zero dependencias) para ler paginas web, extrair links e renderizar paginas com JavaScript. Sem API key, sem scraping de buscador.", "type": "module", "main": "server.js", "license": "MIT", "engines": { "node": ">=18" }, "scripts": { "start": "node server.js", "test": "node --test tests/cache.test.mjs tests/limits.test.mjs tests/crawl.test.mjs tests/dynamic.test.mjs tests/internal-api.test.mjs tests/parser.test.mjs tests/robustness.test.mjs tests/security.test.mjs tests/integration.test.mjs", "test:e2e": "node scripts/smoke-test.mjs", "test:live": "node scripts/live-test.mjs" } }
```