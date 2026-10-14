# caso 17: [B] npm-spa-read-dynamic
ferramenta: read_dynamic_page
argumentos: {"url":"https://www.npmjs.com/package/express","maxChars":4000}
nota do teste: mesma URL, extracao dinamica
status HTTP: 200 | tempo: 1451 ms | isError: true
sinais: chars=73 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 17,
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