# caso 46: [G] status-500
ferramenta: read_page
argumentos: {"url":"https://httpbin.org/status/500","maxChars":500}
nota do teste: 500 real
status HTTP: 200 | tempo: 5694 ms | isError: true
sinais: chars=78 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 46,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: HTTP 500 INTERNAL SERVER ERROR ao acessar https://httpbin.org/status/500"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: HTTP 500 INTERNAL SERVER ERROR ao acessar https://httpbin.org/status/500
```