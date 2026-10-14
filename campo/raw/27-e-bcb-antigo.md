# caso 27: [E] bcb-antigo
ferramenta: read_page
argumentos: {"url":"https://www.bcb.gov.br/","maxChars":4000}
nota do teste: portal antigo, possivel ISO-8859-1
status HTTP: 200 | tempo: 183 ms | isError: false
sinais: chars=312 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 27,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Banco Central do Brasil\nURL: https://www.bcb.gov.br/\nDescricao: O Banco Central do Brasil tem o objetivo fundamental de assegurar a estabilidade de preços, zelar pela estabilidade do sistema financeiro, suavizar as flutuações do nível de atividade econômica e fomentar o pleno emprego.\nConteudo: 0 caracteres\n\n"
      }
    ]
  }
}
```

## texto extraido
```
# Banco Central do Brasil
URL: https://www.bcb.gov.br/
Descricao: O Banco Central do Brasil tem o objetivo fundamental de assegurar a estabilidade de preços, zelar pela estabilidade do sistema financeiro, suavizar as flutuações do nível de atividade econômica e fomentar o pleno emprego.
Conteudo: 0 caracteres


```