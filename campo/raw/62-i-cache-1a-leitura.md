# caso 62: [I] cache-1a-leitura
ferramenta: read_page
argumentos: {"url":"https://example.com/","maxChars":300}
nota do teste: uso repetido: 1a chamada
status HTTP: 200 | tempo: 7 ms | isError: false
sinais: chars=225 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 62,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Example Domain\nURL: https://example.com/\nConteudo: 156 caracteres\n\nThis domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes."
      }
    ]
  }
}
```

## texto extraido
```
# Example Domain
URL: https://example.com/
Conteudo: 156 caracteres

This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.
```