# caso 34: [F] sitemap-index
ferramenta: read_page
argumentos: {"url":"https://g1.globo.com/sitemap.xml","maxChars":3000}
nota do teste: sitemap index
status HTTP: 200 | tempo: 73 ms | isError: false
sinais: chars=565 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=12

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 34,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# (sem titulo)\nURL: https://g1.globo.com/sitemap.xml\nConteudo: 486 caracteres\n\nhttp://g1.globo.com/sitemap-carros-marcas.xmlhttp://g1.globo.com/sitemap-aeroportos.xmlhttp://g1.globo.com/sitemap-carros-carros.xmlhttp://g1.globo.com/sitemap-tudo-sobre.xmlhttp://g1.globo.com/sitemap-homes.xmlhttp://g1.globo.com/sitemap-cidades.xmlhttp://g1.globo.com/sitemap-politica-politicos.xmlhttp://especiais.g1.globo.com/sitemap.xmlhttp://g1.globo.com/sitemap-musica-shows.xmlhttp://g1.globo.com/sitemap-educacao-universidades.xmlhttp://g1.globo.com/sitemap-carros-assuntos.xml"
      }
    ]
  }
}
```

## texto extraido
```
# (sem titulo)
URL: https://g1.globo.com/sitemap.xml
Conteudo: 486 caracteres

http://g1.globo.com/sitemap-carros-marcas.xmlhttp://g1.globo.com/sitemap-aeroportos.xmlhttp://g1.globo.com/sitemap-carros-carros.xmlhttp://g1.globo.com/sitemap-tudo-sobre.xmlhttp://g1.globo.com/sitemap-homes.xmlhttp://g1.globo.com/sitemap-cidades.xmlhttp://g1.globo.com/sitemap-politica-politicos.xmlhttp://especiais.g1.globo.com/sitemap.xmlhttp://g1.globo.com/sitemap-musica-shows.xmlhttp://g1.globo.com/sitemap-educacao-universidades.xmlhttp://g1.globo.com/sitemap-carros-assuntos.xml
```