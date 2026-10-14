# caso 38: [F] robots-txt
ferramenta: read_page
argumentos: {"url":"https://www.google.com/robots.txt","maxChars":2000}
nota do teste: texto puro
status HTTP: 200 | tempo: 184 ms | isError: false
sinais: chars=2216 tabelas=0 cercas=0 truncado=true mojibake=false cjk=false rtl=false links=1

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 38,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# (sem titulo)\nURL: https://www.google.com/robots.txt\nConteudo: 6616 caracteres (exibidos 2119)\n\nUser-agent: * User-agent: Yandex Disallow: /search Allow: /search/about Allow: /search/howsearchworks Disallow: /sdch Disallow: /groups Disallow: /index.html? Disallow: /? Disallow: /goto? Allow: /?hl= Disallow: /?hl=*& Allow: /?hl=*&gws_rd=ssl$ Disallow: /?hl=*&*&gws_rd=ssl Allow: /?gws_rd=ssl$ Allow: /?pt1=true$ Disallow: /imgres Disallow: /u/ Disallow: /setprefs Disallow: /m? Disallow: /m/ Allow: /m/finance Disallow: /wml? Disallow: /wml/? Disallow: /wml/search? Disallow: /xhtml? Disallow: /xhtml/? Disallow: /xhtml/search? Disallow: /xml? Disallow: /imode? Disallow: /imode/? Disallow: /imode/search? Disallow: /jsky? Disallow: /jsky/? Disallow: /jsky/search? Disallow: /pda? Disallow: /pda/? Disallow: /pda/search? Disallow: /local? Disallow: /local_url Disallow: /products? Disallow: /product_ Disallow: /products_ Disallow: /products; Disallow: /print Disallow: /books/ Disallow: /bkshp?*dq= Disallow: /bkshp?*q= Disallow: /books?*dq= Disallow: /books?*q= Disallow: /books?*qtid= Disallow: /books?*output= Disallow: /books?*pg= Disallow: /books?*jtp= Disallow: /books?*jscmd= Disallow: /books?*buy= Disallow: /books?*zoom= Allow: /books/about Allow: /books?*zoom=1 Allow: /books?*zoom=5 Allow: /books/content?*zoom=1 Allow: /books/content?*zoom=5 Disallow: /patents? Disallow: /patents/download/ Disallow: /patents/pdf/ Disallow: /patents/related/ Disallow: /scholar Disallow: /citations? Allow: /citations?user= Allow: /citations?view_op=new_profile Allow: /citations?view_op=top_venues Allow: /scholar_share Disallow: /s? Disallow: /maps? Allow: /maps?daddr= Allow: /maps?entry=wc Allow: /maps?f= Allow: /maps?hl= Allow: /maps?q= Allow: /maps?saddr= Allow: /maps?sid= Allow: /maps?*output=classic Allow: /maps?*file= Disallow: /mapslt? Disallow: /maphp? Disallow: /maps/ Allow: /maps/$ Allow: /maps/@ Allow: /maps/?daddr= Allow: /maps/?entry=wc Allow: /maps/?f= Allow: /maps/?hl= Allow: /maps/?q= Allow: /maps/?saddr= Allow: /maps/?sid= Allow: /maps/api/staticmap? Allow: /maps/search/ \n\n[... conteudo truncado em 2000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# (sem titulo)
URL: https://www.google.com/robots.txt
Conteudo: 6616 caracteres (exibidos 2119)

User-agent: * User-agent: Yandex Disallow: /search Allow: /search/about Allow: /search/howsearchworks Disallow: /sdch Disallow: /groups Disallow: /index.html? Disallow: /? Disallow: /goto? Allow: /?hl= Disallow: /?hl=*& Allow: /?hl=*&gws_rd=ssl$ Disallow: /?hl=*&*&gws_rd=ssl Allow: /?gws_rd=ssl$ Allow: /?pt1=true$ Disallow: /imgres Disallow: /u/ Disallow: /setprefs Disallow: /m? Disallow: /m/ Allow: /m/finance Disallow: /wml? Disallow: /wml/? Disallow: /wml/search? Disallow: /xhtml? Disallow: /xhtml/? Disallow: /xhtml/search? Disallow: /xml? Disallow: /imode? Disallow: /imode/? Disallow: /imode/search? Disallow: /jsky? Disallow: /jsky/? Disallow: /jsky/search? Disallow: /pda? Disallow: /pda/? Disallow: /pda/search? Disallow: /local? Disallow: /local_url Disallow: /products? Disallow: /product_ Disallow: /products_ Disallow: /products; Disallow: /print Disallow: /books/ Disallow: /bkshp?*dq= Disallow: /bkshp?*q= Disallow: /books?*dq= Disallow: /books?*q= Disallow: /books?*qtid= Disallow: /books?*output= Disallow: /books?*pg= Disallow: /books?*jtp= Disallow: /books?*jscmd= Disallow: /books?*buy= Disallow: /books?*zoom= Allow: /books/about Allow: /books?*zoom=1 Allow: /books?*zoom=5 Allow: /books/content?*zoom=1 Allow: /books/content?*zoom=5 Disallow: /patents? Disallow: /patents/download/ Disallow: /patents/pdf/ Disallow: /patents/related/ Disallow: /scholar Disallow: /citations? Allow: /citations?user= Allow: /citations?view_op=new_profile Allow: /citations?view_op=top_venues Allow: /scholar_share Disallow: /s? Disallow: /maps? Allow: /maps?daddr= Allow: /maps?entry=wc Allow: /maps?f= Allow: /maps?hl= Allow: /maps?q= Allow: /maps?saddr= Allow: /maps?sid= Allow: /maps?*output=classic Allow: /maps?*file= Disallow: /mapslt? Disallow: /maphp? Disallow: /maps/ Allow: /maps/$ Allow: /maps/@ Allow: /maps/?daddr= Allow: /maps/?entry=wc Allow: /maps/?f= Allow: /maps/?hl= Allow: /maps/?q= Allow: /maps/?saddr= Allow: /maps/?sid= Allow: /maps/api/staticmap? Allow: /maps/search/ 

[... conteudo truncado em 2000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```