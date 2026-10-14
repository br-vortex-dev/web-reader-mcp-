# caso 22: [C] wordpress-news
ferramenta: read_page
argumentos: {"url":"https://wordpress.org/news/","maxChars":4000}
nota do teste: blog WordPress oficial
status HTTP: 200 | tempo: 997 ms | isError: false
sinais: chars=1651 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=16

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 22,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# WordPress News – The latest news about WordPress and the WordPress community\nURL: https://wordpress.org/news/\nDescricao: The latest news about WordPress and the WordPress community\nConteudo: 1441 caracteres\n\nSkip to content\n\n [ ](https://wordpress.org/)\n\n[News](https://wordpress.org/news)\n\n# News\n\n## Latest Release\n\n-\n\n [See All Releases](https://wordpress.org/news/category/releases/)\n\n## Latest Posts\n\n-\n-\n-\n-\n-\n\n [See All Posts](https://wordpress.org/news/all-posts/)\n\n## People of WordPress\n\n-\n![Sunita Rai at WordCamp Asia](https://wordpress.org/news/files/2024/01/sunita-rai-featured-img.jpg)\n\n### [People of WordPress: Sunita Rai](https://wordpress.org/news/2024/02/people-of-wordpress-sunita-rai/)\n\n-\n![Artemy Kaydash stood in front of water](https://wordpress.org/news/files/2023/10/artemy-featured-img.jpg)\n\n### [People of WordPress: Artemy Kaydash](https://wordpress.org/news/2023/12/people-of-wordpress-artemy-kaydash/)\n\n-\n![Ihtisham Zahoor in the moutains.](https://wordpress.org/news/files/2023/07/ihtisham-2.jpg)\n\n### [People of WordPress: Ihtisham Zahoor](https://wordpress.org/news/2023/07/people-of-wordpress-ihtisham-zahoor/)\n\n-\n![Allison Dye](https://wordpress.org/news/files/2023/06/fi-allison-dye.jpg)\n\n### [People of WordPress: Allison Dye](https://wordpress.org/news/2023/06/people-of-wordpress-allison-dye/)\n\n-\n![Stefano with a laptop covered in WordPress event stickers](https://wordpress.org/news/files/2023/05/stefano-featured-img.jpg)\n\n### [People of WordPress: Stefano Cassone](https://wordpress.org/news/2023/05/people-of-wordpress-stefano-cassone/)\n\n [See All People](https://wordpress.org/news/category/community/)"
      }
    ]
  }
}
```

## texto extraido
```
# WordPress News – The latest news about WordPress and the WordPress community
URL: https://wordpress.org/news/
Descricao: The latest news about WordPress and the WordPress community
Conteudo: 1441 caracteres

Skip to content

 [ ](https://wordpress.org/)

[News](https://wordpress.org/news)

# News

## Latest Release

-

 [See All Releases](https://wordpress.org/news/category/releases/)

## Latest Posts

-
-
-
-
-

 [See All Posts](https://wordpress.org/news/all-posts/)

## People of WordPress

-
![Sunita Rai at WordCamp Asia](https://wordpress.org/news/files/2024/01/sunita-rai-featured-img.jpg)

### [People of WordPress: Sunita Rai](https://wordpress.org/news/2024/02/people-of-wordpress-sunita-rai/)

-
![Artemy Kaydash stood in front of water](https://wordpress.org/news/files/2023/10/artemy-featured-img.jpg)

### [People of WordPress: Artemy Kaydash](https://wordpress.org/news/2023/12/people-of-wordpress-artemy-kaydash/)

-
![Ihtisham Zahoor in the moutains.](https://wordpress.org/news/files/2023/07/ihtisham-2.jpg)

### [People of WordPress: Ihtisham Zahoor](https://wordpress.org/news/2023/07/people-of-wordpress-ihtisham-zahoor/)

-
![Allison Dye](https://wordpress.org/news/files/2023/06/fi-allison-dye.jpg)

### [People of WordPress: Allison Dye](https://wordpress.org/news/2023/06/people-of-wordpress-allison-dye/)

-
![Stefano with a laptop covered in WordPress event stickers](https://wordpress.org/news/files/2023/05/stefano-featured-img.jpg)

### [People of WordPress: Stefano Cassone](https://wordpress.org/news/2023/05/people-of-wordpress-stefano-cassone/)

 [See All People](https://wordpress.org/news/category/community/)
```