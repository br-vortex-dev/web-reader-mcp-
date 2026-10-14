# caso 26: [D] ibge-sao-paulo
ferramenta: read_page
argumentos: {"url":"https://www.ibge.gov.br/cidades-e-estados/sp/sao-paulo.html","maxChars":6000}
nota do teste: muitos numeros e tabelas
status HTTP: 200 | tempo: 1552 ms | isError: true
sinais: chars=95 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 26,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: HTTP 403 Forbidden ao acessar https://www.ibge.gov.br/cidades-e-estados/sp/sao-paulo.html"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: HTTP 403 Forbidden ao acessar https://www.ibge.gov.br/cidades-e-estados/sp/sao-paulo.html
```