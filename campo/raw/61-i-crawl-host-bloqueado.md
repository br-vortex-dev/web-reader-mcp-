# caso 61: [I] crawl-host-bloqueado
ferramenta: crawl_site
argumentos: {"url":"http://169.254.169.254/","maxPages":3,"maxChars":300}
nota do teste: crawl contra host interno -> tem de ser isError
status HTTP: 200 | tempo: 4 ms | isError: true
sinais: chars=125 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 61,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: Nao foi possivel iniciar o crawl em http://169.254.169.254/: Host bloqueado: endereco privado/interno (169.254.169.254)"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: Nao foi possivel iniciar o crawl em http://169.254.169.254/: Host bloqueado: endereco privado/interno (169.254.169.254)
```