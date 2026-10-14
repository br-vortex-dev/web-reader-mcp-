# caso 42: [G] redirect-9
ferramenta: read_page
argumentos: {"url":"https://httpbin.org/redirect/9","maxChars":800}
nota do teste: 9 saltos, limite eh 5
status HTTP: 200 | tempo: 4622 ms | isError: true
sinais: chars=87 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: Redirects em excesso (mais de 5 saltos) ao acessar https://httpbin.org/redirect/9"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: Redirects em excesso (mais de 5 saltos) ao acessar https://httpbin.org/redirect/9
```