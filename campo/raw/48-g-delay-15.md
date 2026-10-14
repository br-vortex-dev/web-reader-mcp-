# caso 48: [G] delay-15
ferramenta: read_page
argumentos: {"url":"https://httpbin.org/delay/15","maxChars":800}
nota do teste: resposta lenta (15 s)
status HTTP: 200 | tempo: 12150 ms | isError: true
sinais: chars=70 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=0

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 48,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: O conteudo retornado nao e HTML (content-type: application/json)"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: O conteudo retornado nao e HTML (content-type: application/json)
```