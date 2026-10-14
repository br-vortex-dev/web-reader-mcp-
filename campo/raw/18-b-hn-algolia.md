# caso 18: [B] hn-algolia
ferramenta: read_page
argumentos: {"url":"https://hn.algolia.com/?query=javascript","maxChars":3000}
nota do teste: listagem carregada por API
status HTTP: 200 | tempo: 396 ms | isError: false
sinais: chars=192 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 18,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Hacker News Search powered by Algolia\nURL: https://hn.algolia.com/?query=javascript\nDescricao: Hacker News Search, millions articles and comments at your fingertips.\nConteudo: 0 caracteres\n\n"
      }
    ]
  }
}
```

## texto extraido
```
# Hacker News Search powered by Algolia
URL: https://hn.algolia.com/?query=javascript
Descricao: Hacker News Search, millions articles and comments at your fingertips.
Conteudo: 0 caracteres


```