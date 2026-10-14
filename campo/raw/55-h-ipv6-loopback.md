# caso 55: [H] ipv6-loopback
ferramenta: read_page
argumentos: {"url":"http://[::1]/","maxChars":500}
nota do teste: IPv6 loopback direto
status HTTP: 200 | tempo: 8 ms | isError: true
sinais: chars=52 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=0

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 55,
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