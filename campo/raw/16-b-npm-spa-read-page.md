# caso 16: [B] npm-spa-read-page
ferramenta: read_page
argumentos: {"url":"https://www.npmjs.com/package/express","maxChars":4000}
nota do teste: SPA que carrega por API (__NEXT_DATA__)
status HTTP: 200 | tempo: 1443 ms | isError: true
sinais: chars=73 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 16,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: HTTP 403 Forbidden ao acessar https://www.npmjs.com/package/express"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: HTTP 403 Forbidden ao acessar https://www.npmjs.com/package/express
```