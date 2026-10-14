# caso 67: [I] cache-fresco-2a
ferramenta: read_page
argumentos: {"url":"https://example.com/?campo-fit=cache-1","maxChars":300}
nota do teste: uso repetido: 2a chamada, mesma URL (cache)
status HTTP: 200 | tempo: 20 ms | isError: false
sinais: chars=243 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 67,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Example Domain\nURL: https://example.com/?campo-fit=cache-1\nConteudo: 156 caracteres\n\nThis domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes."
      }
    ]
  }
}
```

## texto extraido
```
# Example Domain
URL: https://example.com/?campo-fit=cache-1
Conteudo: 156 caracteres

This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.
```