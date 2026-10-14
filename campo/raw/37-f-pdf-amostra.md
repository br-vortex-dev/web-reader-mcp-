# caso 37: [F] pdf-amostra
ferramenta: read_page
argumentos: {"url":"https://www.africau.edu/images/default/sample.pdf","maxChars":1000}
nota do teste: PDF publico
status HTTP: 200 | tempo: 3616 ms | isError: true
sinais: chars=85 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 37,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: HTTP 404 Not Found ao acessar https://www.africau.edu/images/default/sample.pdf"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: HTTP 404 Not Found ao acessar https://www.africau.edu/images/default/sample.pdf
```