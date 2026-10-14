# caso 59: [I] discover-site
ferramenta: discover_urls
argumentos: {"url":"https://motherfuckingwebsite.com/","limit":30}
nota do teste: site minusculo, sem sitemap
status HTTP: 200 | tempo: 1265 ms | isError: false
sinais: chars=150 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 59,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Nenhum sitemap encontrado em https://motherfuckingwebsite.com e a pagina inicial nao tem links internos. Use extract_links ou passe a URL diretamente."
      }
    ]
  }
}
```

## texto extraido
```
Nenhum sitemap encontrado em https://motherfuckingwebsite.com e a pagina inicial nao tem links internos. Use extract_links ou passe a URL diretamente.
```