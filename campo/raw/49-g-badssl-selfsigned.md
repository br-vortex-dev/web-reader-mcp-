# caso 49: [G] badssl-selfsigned
ferramenta: read_page
argumentos: {"url":"https://self-signed.badssl.com/","maxChars":500}
nota do teste: certificado invalido
status HTTP: 200 | tempo: 723 ms | isError: true
sinais: chars=18 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=0

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 49,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: fetch failed"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: fetch failed
```