# caso 64: [F] pdf-w3c-vivo
ferramenta: read_page
argumentos: {"url":"https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf","maxChars":1000}
nota do teste: PDF publico real (SUBSTITUI o africau.edu que morreu: 404)
status HTTP: 200 | tempo: 2071 ms | isError: true
sinais: chars=107 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 64,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: HTTP 403 Forbidden ao acessar https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: HTTP 403 Forbidden ao acessar https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf
```