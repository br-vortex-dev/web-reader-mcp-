# caso 57: [I] multiple-misto
ferramenta: read_multiple_pages
argumentos: {"urls":["https://example.com/","https://httpbin.org/status/404","http://169.254.169.254/","https://httpbin.org/delay/5","https://httpbin.org/status/500"],"maxChars":400}
nota do teste: 5 URLs: boa, 404, bloqueada, lenta, 500
status HTTP: 200 | tempo: 8452 ms | isError: false
sinais: chars=850 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=7

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 57,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Leitura concluida: 1/5 paginas OK (lidas em lotes de 6).\n\n# Example Domain\nURL: https://example.com/\nConteudo: 156 caracteres\n\nThis domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.\n\n========================================\n\n# Erro ao ler https://httpbin.org/status/404\nHTTP 404 NOT FOUND ao acessar https://httpbin.org/status/404\n\n========================================\n\n# Erro ao ler http://169.254.169.254/\nHost bloqueado: endereco privado/interno (169.254.169.254)\n\n========================================\n\n# Erro ao ler https://httpbin.org/delay/5\nA resposta nao parece ser HTML.\n\n========================================\n\n# Erro ao ler https://httpbin.org/status/500\nHTTP 500 INTERNAL SERVER ERROR ao acessar https://httpbin.org/status/500"
      }
    ]
  }
}
```

## texto extraido
```
Leitura concluida: 1/5 paginas OK (lidas em lotes de 6).

# Example Domain
URL: https://example.com/
Conteudo: 156 caracteres

This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.

========================================

# Erro ao ler https://httpbin.org/status/404
HTTP 404 NOT FOUND ao acessar https://httpbin.org/status/404

========================================

# Erro ao ler http://169.254.169.254/
Host bloqueado: endereco privado/interno (169.254.169.254)

========================================

# Erro ao ler https://httpbin.org/delay/5
A resposta nao parece ser HTML.

========================================

# Erro ao ler https://httpbin.org/status/500
HTTP 500 INTERNAL SERVER ERROR ao acessar https://httpbin.org/status/500
```