# caso 47: [G] status-503
ferramenta: read_page
argumentos: {"url":"https://httpbin.org/status/503","maxChars":500}
nota do teste: 503 real
status HTTP: 200 | tempo: 4621 ms | isError: true
sinais: chars=76 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 47,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: HTTP 503 SERVICE UNAVAILABLE ao acessar https://httpbin.org/status/503"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: HTTP 503 SERVICE UNAVAILABLE ao acessar https://httpbin.org/status/503
```