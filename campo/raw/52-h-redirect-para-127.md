# caso 52: [H] redirect-para-127
ferramenta: read_page
argumentos: {"url":"https://httpbin.org/redirect-to?url=http://127.0.0.1/","maxChars":500}
nota do teste: redirect publico -> 127.0.0.1
status HTTP: 200 | tempo: 693 ms | isError: true
sinais: chars=58 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=0

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 52,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: Host bloqueado: endereco privado/interno (127.0.0.1)"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: Host bloqueado: endereco privado/interno (127.0.0.1)
```