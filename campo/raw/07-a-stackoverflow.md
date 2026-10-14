# caso 7: [A] stackoverflow
ferramenta: read_page
argumentos: {"url":"https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array","maxChars":6000}
nota do teste: pergunta com resposta aceita e codigo
status HTTP: 200 | tempo: 1677 ms | isError: true
sinais: chars=154 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: HTTP 403 Forbidden ao acessar https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: HTTP 403 Forbidden ao acessar https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array
```