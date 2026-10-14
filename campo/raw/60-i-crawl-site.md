# caso 60: [I] crawl-site
ferramenta: crawl_site
argumentos: {"url":"https://motherfuckingwebsite.com/","maxPages":5,"maxChars":600}
nota do teste: crawl leve em site permissivo
status HTTP: 200 | tempo: 9 ms | isError: false
sinais: chars=934 tabelas=0 cercas=0 truncado=true mojibake=false cjk=false rtl=false links=2

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 60,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Crawl de https://motherfuckingwebsite.com/: 1 pagina(s) lida(s) (limite 5, dominio motherfuckingwebsite.com).\n\n# Motherfucking Website\nURL: https://motherfuckingwebsite.com/\nConteudo: 3312 caracteres (exibidos 718)\n\n## Seriously, what the fuck else do you want?\n\nYou probably build websites and think your shit is special. You think your 13 megabyte parallax-ative home page is going to get you some fucking Awwward banner you can glue to the top corner of your site. You think your 40-pound jQuery file and 83 polyfills give IE7 a boner because it finally has box-shadow. Wrong, motherfucker. Let me describe your perfect-ass website:\n\n - Shit's lightweight and loads fast\n - Fits on all your shitty screens\n - Looks the same in all your shitty browsers\n - The motherfucker's accessible to every asshole that visits\n\n[... conteudo truncado em 600 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
Crawl de https://motherfuckingwebsite.com/: 1 pagina(s) lida(s) (limite 5, dominio motherfuckingwebsite.com).

# Motherfucking Website
URL: https://motherfuckingwebsite.com/
Conteudo: 3312 caracteres (exibidos 718)

## Seriously, what the fuck else do you want?

You probably build websites and think your shit is special. You think your 13 megabyte parallax-ative home page is going to get you some fucking Awwward banner you can glue to the top corner of your site. You think your 40-pound jQuery file and 83 polyfills give IE7 a boner because it finally has box-shadow. Wrong, motherfucker. Let me describe your perfect-ass website:

 - Shit's lightweight and loads fast
 - Fits on all your shitty screens
 - Looks the same in all your shitty browsers
 - The motherfucker's accessible to every asshole that visits

[... conteudo truncado em 600 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```