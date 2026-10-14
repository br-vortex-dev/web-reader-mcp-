# caso 56: [H] ipv4-mapeado-ipv6
ferramenta: read_page
argumentos: {"url":"http://[::ffff:127.0.0.1]/","maxChars":500}
nota do teste: IPv4 mapeado em IPv6
status HTTP: 200 | tempo: 12 ms | isError: true
sinais: chars=62 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=0

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 56,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: Host bloqueado: endereco privado/interno (::ffff:7f00:1)"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: Host bloqueado: endereco privado/interno (::ffff:7f00:1)
```