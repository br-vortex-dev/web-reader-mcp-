# caso 65: [F] json-dynamic
ferramenta: read_dynamic_page
argumentos: {"url":"https://jsonplaceholder.typicode.com/posts/1","maxChars":1000}
nota do teste: endpoint JSON publico via read_dynamic_page
status HTTP: 200 | tempo: 420 ms | isError: true
sinais: chars=85 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=0

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 65,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: O conteudo retornado nao e HTML (content-type: application/json; charset=utf-8)"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: O conteudo retornado nao e HTML (content-type: application/json; charset=utf-8)
```