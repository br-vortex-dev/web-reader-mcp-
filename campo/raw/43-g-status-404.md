# caso 43: [G] status-404
ferramenta: read_page
argumentos: {"url":"https://httpbin.org/status/404","maxChars":500}
nota do teste: 404 real
status HTTP: 200 | tempo: 3069 ms | isError: true
sinais: chars=66 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 43,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: HTTP 404 NOT FOUND ao acessar https://httpbin.org/status/404"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: HTTP 404 NOT FOUND ao acessar https://httpbin.org/status/404
```