# caso 44: [G] status-403
ferramenta: read_page
argumentos: {"url":"https://httpbin.org/status/403","maxChars":500}
nota do teste: 403 real
status HTTP: 200 | tempo: 3790 ms | isError: true
sinais: chars=66 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 44,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: HTTP 403 FORBIDDEN ao acessar https://httpbin.org/status/403"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: HTTP 403 FORBIDDEN ao acessar https://httpbin.org/status/403
```