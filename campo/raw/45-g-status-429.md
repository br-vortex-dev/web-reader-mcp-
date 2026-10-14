# caso 45: [G] status-429
ferramenta: read_page
argumentos: {"url":"https://httpbin.org/status/429","maxChars":500}
nota do teste: 429 real
status HTTP: 200 | tempo: 3919 ms | isError: true
sinais: chars=74 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 45,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: HTTP 429 TOO MANY REQUESTS ao acessar https://httpbin.org/status/429"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: HTTP 429 TOO MANY REQUESTS ao acessar https://httpbin.org/status/429
```