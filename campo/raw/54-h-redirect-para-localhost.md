# caso 54: [H] redirect-para-localhost
ferramenta: read_page
argumentos: {"url":"https://httpbin.org/redirect-to?url=http://localhost/","maxChars":500}
nota do teste: redirect publico -> localhost
status HTTP: 200 | tempo: 567 ms | isError: true
sinais: chars=52 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=0

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 54,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: Host bloqueado: endereco privado/interno (::1)"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: Host bloqueado: endereco privado/interno (::1)
```