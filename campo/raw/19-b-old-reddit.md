# caso 19: [B] old-reddit
ferramenta: read_page
argumentos: {"url":"https://old.reddit.com/r/programming/","maxChars":3000}
nota do teste: lista com paginacao/comentarios
status HTTP: 200 | tempo: 363 ms | isError: false
sinais: chars=270 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 19,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Boas-vindas ao Reddit\nURL: https://old.reddit.com/login/?reason=lor2&dest=https%3A%2F%2Fold.reddit.com%2Fr%2Fprogramming%2F\nDescricao: Entre na conta ou cadastre-se para personalizar seu feed, unir-se a conversas, votar e explorar comunidades.\nConteudo: 0 caracteres\n\n"
      }
    ]
  }
}
```

## texto extraido
```
# Boas-vindas ao Reddit
URL: https://old.reddit.com/login/?reason=lor2&dest=https%3A%2F%2Fold.reddit.com%2Fr%2Fprogramming%2F
Descricao: Entre na conta ou cadastre-se para personalizar seu feed, unir-se a conversas, votar e explorar comunidades.
Conteudo: 0 caracteres


```