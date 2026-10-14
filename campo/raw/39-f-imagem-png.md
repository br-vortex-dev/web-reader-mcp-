# caso 39: [F] imagem-png
ferramenta: read_page
argumentos: {"url":"https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png","maxChars":500}
nota do teste: imagem PNG
status HTTP: 200 | tempo: 92 ms | isError: true
sinais: chars=63 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=0

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 39,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Erro: O conteudo retornado nao e HTML (content-type: image/png)"
      }
    ],
    "isError": true
  }
}
```

## texto extraido
```
Erro: O conteudo retornado nao e HTML (content-type: image/png)
```