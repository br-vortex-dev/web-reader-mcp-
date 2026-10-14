# caso 50: [G] badssl-expired
ferramenta: read_page
argumentos: {"url":"https://expired.badssl.com/","maxChars":500}
nota do teste: certificado expirado
status HTTP: 200 | tempo: 888 ms | isError: true
sinais: chars=18 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=0

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 50,
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