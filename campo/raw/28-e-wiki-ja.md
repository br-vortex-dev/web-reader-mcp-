# caso 28: [E] wiki-ja
ferramenta: read_page
argumentos: {"url":"https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC","maxChars":4000}
nota do teste: japones (CJK)
status HTTP: 200 | tempo: 1090 ms | isError: false
sinais: chars=4235 tabelas=2 cercas=0 truncado=true mojibake=false cjk=true rtl=false links=38

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 28,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# 日本 - Wikipedia\nURL: https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC\nConteudo: 393293 caracteres (exibidos 4119)\n\nコンテンツにスキップ\n\n出典: フリー百科事典『ウィキペディア（Wikipedia）』\n\n| [![曖昧さ回避](https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5f/Disambig_gray.svg/40px-Disambig_gray.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Disambig_gray.svg) | ① 「Japan」はこの項目へ転送されています。 ② その他の用法については「[日本 (曖昧さ回避)](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC_(%E6%9B%96%E6%98%A7%E3%81%95%E5%9B%9E%E9%81%BF))」、「[日本国 (曖昧さ回避)](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E5%9B%BD_(%E6%9B%96%E6%98%A7%E3%81%95%E5%9B%9E%E9%81%BF))」、「[ジャパン (曖昧さ回避)](https://ja.wikipedia.org/wiki/%E3%82%B8%E3%83%A3%E3%83%91%E3%83%B3_(%E6%9B%96%E6%98%A7%E3%81%95%E5%9B%9E%E9%81%BF))」をご覧ください。 |\n| --- | --- |\n\n| 日本国 | |\n| --- | --- |\n| 日本国[注釈 1] | |\n| [![](https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9e/Flag_of_Japan.svg/250px-Flag_of_Japan.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Flag_of_Japan.svg) [国旗](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E5%9B%BD%E6%97%97) [![](https://thumb.wikimedia.org/wikipedia/commons/thumb/3/37/Imperial_Seal_of_Japan.svg/120px-Imperial_Seal_of_Japan.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Imperial_Seal_of_Japan.svg) [事実上の国章](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E5%9B%BD%E7%AB%A0) | |\n| [国璽](https://ja.wikipedia.org/wiki/%E5%9B%BD%E7%92%BD) [![](https://thumb.wikimedia.org/wikipedia/commons/thumb/0/01/Gyomei_kokuji.svg/60px-Gyomei_kokuji.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Gyomei_kokuji.svg) [大日本國璽](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E5%9B%BD%E7%92%BD) | |\n| [![日本の地図](https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d1/Japan_in_the_World.svg/250px-Japan_in_the_World.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Japan_in_the_World.svg) | |\n| [![日本の位置](https://thumb.wikimedia.org/wikipedia/commons/thumb/6/62/Japan_%28orthographic_projection%29.svg/250px-Japan_%28orthographic_projection%29.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Japan_(orthographic_projection).svg) - 日本国の領土 - 日本国が領有を主張する地域 | |\n| 国の標語：なし | |\n| [国歌](https://ja.wikipedia.org/wiki/%E5%9B%BD%E6%AD%8C)：[君が代](https://ja.wikipedia.org/wiki/%E5%90%9B%E3%81%8C%E4%BB%A3) | |\n| 公用語 | [日本語](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E8%AA%9E)（[事実上](https://ja.wikipedia.org/wiki/%E3%83%87%E3%83%BB%E3%83%95%E3%82%A1%E3%82%AF%E3%83%88)[注釈 2]） |\n| [首都](https://ja.wikipedia.org/wiki/%E9%A6%96%E9%83%BD) | [東京都](https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC%E9%83%BD)（事実上[注釈 3]） |\n| 最大の都市 | [東京都区部](https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC%E9%83%BD%E5%8C%BA%E9%83%A8)[注釈 4] |\n| 政府 | |\n| [天皇](https://ja.wikipedia.org/wiki/%E5%A4%A9%E7%9A%87) | [徳仁](https://ja.wikipedia.org/wiki/%E5%BE%B3%E4%BB%81) |\n| [内閣総理大臣](https://ja.wikipedia.org/wiki/%E5%86%85%E9%96%A3%E7%B7%8F%E7%90%86%E5%A4%A7%E8%87%A3) | [高市早苗](https://ja.wikipedia.org/wiki/%E9%AB%98%E5%B8%82%E6%97%A9%E8%8B%97) |\n| [国会衆議院議長](https://ja.wikipedia.org/wiki/%E8%A1%86%E8%AD%B0%E9%99%A2%E8%AD%B0%E9%95%B7) | [森英介](https://ja.wikipedia.org/wiki/%E6%A3%AE%E8%8B%B1%E4%BB%8B) |\n| [国会参議院議長](https://ja.wikipedia.org/wiki/%E5%8F%82%E8%AD%B0%E9%99%A2%E8%AD%B0%E9%95%B7) | [関口昌一](https://ja.wikipedia.org/wiki/%E9%96%A2%E5%8F%A3%E6%98%8C%E4%B8%80) |\n| [最高裁判所長官](https://ja.wikipedia.org/wiki/%E6%9C%80%E9%AB%98%E8%A3%81%E5%88%A4%E6%89%80%E9%95%B7%E5%AE%98) | [今崎幸彦](https://ja.wikipedia.org/wiki/%E4%BB%8A%E5%B4%8E%E5%B9%B8%E5%BD%A6) |\n| [面積](https://ja.wikipedia.org/wiki/%E9%9\n\n[... conteudo truncado em 4000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# 日本 - Wikipedia
URL: https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC
Conteudo: 393293 caracteres (exibidos 4119)

コンテンツにスキップ

出典: フリー百科事典『ウィキペディア（Wikipedia）』

| [![曖昧さ回避](https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5f/Disambig_gray.svg/40px-Disambig_gray.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Disambig_gray.svg) | ① 「Japan」はこの項目へ転送されています。 ② その他の用法については「[日本 (曖昧さ回避)](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC_(%E6%9B%96%E6%98%A7%E3%81%95%E5%9B%9E%E9%81%BF))」、「[日本国 (曖昧さ回避)](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E5%9B%BD_(%E6%9B%96%E6%98%A7%E3%81%95%E5%9B%9E%E9%81%BF))」、「[ジャパン (曖昧さ回避)](https://ja.wikipedia.org/wiki/%E3%82%B8%E3%83%A3%E3%83%91%E3%83%B3_(%E6%9B%96%E6%98%A7%E3%81%95%E5%9B%9E%E9%81%BF))」をご覧ください。 |
| --- | --- |

| 日本国 | |
| --- | --- |
| 日本国[注釈 1] | |
| [![](https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9e/Flag_of_Japan.svg/250px-Flag_of_Japan.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Flag_of_Japan.svg) [国旗](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E5%9B%BD%E6%97%97) [![](https://thumb.wikimedia.org/wikipedia/commons/thumb/3/37/Imperial_Seal_of_Japan.svg/120px-Imperial_Seal_of_Japan.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Imperial_Seal_of_Japan.svg) [事実上の国章](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E5%9B%BD%E7%AB%A0) | |
| [国璽](https://ja.wikipedia.org/wiki/%E5%9B%BD%E7%92%BD) [![](https://thumb.wikimedia.org/wikipedia/commons/thumb/0/01/Gyomei_kokuji.svg/60px-Gyomei_kokuji.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Gyomei_kokuji.svg) [大日本國璽](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E5%9B%BD%E7%92%BD) | |
| [![日本の地図](https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d1/Japan_in_the_World.svg/250px-Japan_in_the_World.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Japan_in_the_World.svg) | |
| [![日本の位置](https://thumb.wikimedia.org/wikipedia/commons/thumb/6/62/Japan_%28orthographic_projection%29.svg/250px-Japan_%28orthographic_projection%29.svg.png?utm_source=ja.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB:Japan_(orthographic_projection).svg) - 日本国の領土 - 日本国が領有を主張する地域 | |
| 国の標語：なし | |
| [国歌](https://ja.wikipedia.org/wiki/%E5%9B%BD%E6%AD%8C)：[君が代](https://ja.wikipedia.org/wiki/%E5%90%9B%E3%81%8C%E4%BB%A3) | |
| 公用語 | [日本語](https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E8%AA%9E)（[事実上](https://ja.wikipedia.org/wiki/%E3%83%87%E3%83%BB%E3%83%95%E3%82%A1%E3%82%AF%E3%83%88)[注釈 2]） |
| [首都](https://ja.wikipedia.org/wiki/%E9%A6%96%E9%83%BD) | [東京都](https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC%E9%83%BD)（事実上[注釈 3]） |
| 最大の都市 | [東京都区部](https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC%E9%83%BD%E5%8C%BA%E9%83%A8)[注釈 4] |
| 政府 | |
| [天皇](https://ja.wikipedia.org/wiki/%E5%A4%A9%E7%9A%87) | [徳仁](https://ja.wikipedia.org/wiki/%E5%BE%B3%E4%BB%81) |
| [内閣総理大臣](https://ja.wikipedia.org/wiki/%E5%86%85%E9%96%A3%E7%B7%8F%E7%90%86%E5%A4%A7%E8%87%A3) | [高市早苗](https://ja.wikipedia.org/wiki/%E9%AB%98%E5%B8%82%E6%97%A9%E8%8B%97) |
| [国会衆議院議長](https://ja.wikipedia.org/wiki/%E8%A1%86%E8%AD%B0%E9%99%A2%E8%AD%B0%E9%95%B7) | [森英介](https://ja.wikipedia.org/wiki/%E6%A3%AE%E8%8B%B1%E4%BB%8B) |
| [国会参議院議長](https://ja.wikipedia.org/wiki/%E5%8F%82%E8%AD%B0%E9%99%A2%E8%AD%B0%E9%95%B7) | [関口昌一](https://ja.wikipedia.org/wiki/%E9%96%A2%E5%8F%A3%E6%98%8C%E4%B8%80) |
| [最高裁判所長官](https://ja.wikipedia.org/wiki/%E6%9C%80%E9%AB%98%E8%A3%81%E5%88%A4%E6%89%80%E9%95%B7%E5%AE%98) | [今崎幸彦](https://ja.wikipedia.org/wiki/%E4%BB%8A%E5%B4%8E%E5%B9%B8%E5%BD%A6) |
| [面積](https://ja.wikipedia.org/wiki/%E9%9

[... conteudo truncado em 4000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```