# caso 53: [H] redirect-para-169
ferramenta: read_page
argumentos: {"url":"https://httpbin.org/redirect-to?url=http://169.254.169.254/","maxChars":500}
nota do teste: redirect publico -> metadata
status HTTP: 200 | tempo: 1480 ms | isError: true
sinais: chars=64 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=0

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 53,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: Host bloqueado: endereco privado/interno (169.254.169.254)"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: Host bloqueado: endereco privado/interno (169.254.169.254)
```