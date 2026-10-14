# caso 21: [C] bbc-news
ferramenta: read_page
argumentos: {"url":"https://www.bbc.com/news","maxChars":5000}
nota do teste: portal internacional
status HTTP: 200 | tempo: 146 ms | isError: false
sinais: chars=5550 tabelas=0 cercas=0 truncado=true mojibake=false cjk=false rtl=false links=30

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# BBC News - Breaking news, video and the latest top stories from the U.S. and around the world\nURL: https://www.bbc.com/news\nDescricao: Visit BBC News for the latest news, breaking news, video, audio and analysis. BBC News provides trusted World, U.S. and U.K. news as well as local and regional perspectives. Also entertainment, climate, business, science, technology and health news.\nConteudo: 17832 caracteres (exibidos 5119)\n\nSkip to content\n\nSite search\n\n[](https://www.bbc.com/)\n\n[](https://www.bbc.com/sport)\n\n[](https://www.bbc.com/health)\n\n[](https://www.bbc.com/weather)\n\n[](https://www.bbc.com/newsletters)\n\n#\n\n[\n![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![Kathryn Vaughn in her school classroom](https://ichef.bbci.co.uk/news/480/cpsprodpb/e691/live/4f2f6b20-adf0-11f1-ad53-0d91a06f3150.jpg.webp)\n\n](https://www.bbc.com/news/articles/c305649p2d6o)\n\n[\n\n## 'It's rough out here': Americans struggle with rising inflation\n\nUS inflation continues to rise, and this month the jump was above forecasts. Here's how some are surviving.\n\n3 hrs ago\n\nUS & Canada\n\n](https://www.bbc.com/news/articles/c305649p2d6o)\n\n[\n\n![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![Woman fills up her car with fuel at forecourt](https://ichef.bbci.co.uk/news/480/cpsprodpb/bd50/live/e1cf6860-c7cf-11f1-9e10-4dcbd31d4273.jpg.webp)\n\n## US inflation rises more than expected - here's what is happening with prices\n\nThe pace of price rises increased to 3.7% in the year to September, driving by higher motor fuel costs.\n\n4 hrs ago\n\nBusiness\n\n](https://www.bbc.com/news/articles/cwy8lx3pg4k2o)\n\n[\n\n## Pope's family 'going through a lot' as brother also undergoes cancer treatment, wife says\n\nLouis Prevost has blood cancer, his wife says as the Pope recovers from surgery for lung cancer.\n\n3 hrs ago\n\nUS & Canada\n\n](https://www.bbc.com/news/articles/c8r4yzx76rlzo)\n\n[\n\n## Island fossil identified as new dinosaur species\n\nInvictibellatrix would have been up to four metres long with feathers and had 20cm claws.\n\n14 hrs ago\n\nHampshire & Isle of Wight\n\n](https://www.bbc.com/news/articles/cmvgx70v9vrjo)\n\n[\n\n![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![Volodymyr Zelensky and Andy Burnham shaking hands outside the front door of Number 10 Downing Street looking off camera. On either side of both men are soldiers from Number 12 Company Irish Guards Westminster wearing their red uniforms with bearskins.](https://ichef.bbci.co.uk/news/480/cpsprodpb/2403/live/b90b29e0-c7e9-11f1-9bb8-8794f734d112.png.webp)\n\n## Burnham treads carefully with Zelensky visit, balancing Trump and Ukraine\n\nThe UK's prime minister meets with Volodymyr Zelensky after a rocky week for the Ukraine president.\n\n2 hrs ago\n\nEurope\n\n](https://www.bbc.com/news/articles/cmx23q4dwvneo)\n\n[\n\n![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![Russell Brand walking into court weraing sunglasses with three paparazzi photographers talking photos behind him](https://ichef.bbci.co.uk/news/480/cpsprodpb/af54/live/088f5d80-c7d9-11f1-9a39-31b474234113.jpg.webp)\n\n## Russell Brand was a 'sexual predator', prosecution alleges as rape trial begins\n\nThe comedian and actor faces charges including rape and sexual assault from six female complainants who have never met each other, a court is told.\n\n1 hr ago\n\nCulture\n\n](https://www.bbc.com/news/articles/c3qjn45pepx1o)\n\n[\n\n![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![Woman with brown hair wearing a blue and white striped shirt holding a phone](https://ichef.bbci.co.uk/news/480/cpsprodpb/2835/live/1c61d100-c7fa-11f1-bc2e-018d645d8d21.jpg.webp)\n\n## What if you could turn off your algorithm? Australia is about to try\n\nNew legislation is being tabled in Australia's parliament on Thursday to force big tech to allow users to switch off algorithms which send them recommended content.\n\n1 hr ago\n\nAustralia\n\n](https://www.bbc.com/news/videos/ck78pj2qy42po)\n\n[\n\n![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![A large ceramic storage pot is in the foreground and is at a slight angle leaning to the left. It has a narrow neck and two handles half way down on each side. To the right are some rocks. Behind you can just make out a diver with a large pipe that looks like a vacuum cleaner that sucks away the sand. The picture has a blue hue.](https://ichef.bbci.co.uk/news/480/cpsprodpb/19d5/live/72e7aa00-c71d-11f1-a82f-35874a3aae81.jpg.webp)\n\n## World's oldest shipwreck found off coast of Turkey\n\nArchaeologists say the wreck is up to 4,700 years old, dating to the Early Bronze Age.\n\n14 hrs ago\n\nScience & Environment\n\n](https://www.bbc.com/news/articles/c6gr80rk1yyko)\n\n[\n\n## Starlink restrictions in Ukraine war linked to political situation, Zelensky aide says\n\n](https://www.bbc.com/news/articles/cm2d6e62p49do)\n\n[\n\n## Australia's first-ever Michelin stars go to 11 restaurants in one state\n\n](https://www.bbc.com/news/articles/crje5we583qwo)\n\n[\n\n## Netflix to shed 1,000 jobs in steepest cuts since 2022\n\n](https://www.bbc.com/news/articles/c6zxj0gzk4x4o)\n\n[\n\n## Sally Rooney books withdrawn in UK over Palestine Action support\n\n](http\n\n[... conteudo truncado em 5000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# BBC News - Breaking news, video and the latest top stories from the U.S. and around the world
URL: https://www.bbc.com/news
Descricao: Visit BBC News for the latest news, breaking news, video, audio and analysis. BBC News provides trusted World, U.S. and U.K. news as well as local and regional perspectives. Also entertainment, climate, business, science, technology and health news.
Conteudo: 17832 caracteres (exibidos 5119)

Skip to content

Site search

[](https://www.bbc.com/)

[](https://www.bbc.com/sport)

[](https://www.bbc.com/health)

[](https://www.bbc.com/weather)

[](https://www.bbc.com/newsletters)

#

[
![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![Kathryn Vaughn in her school classroom](https://ichef.bbci.co.uk/news/480/cpsprodpb/e691/live/4f2f6b20-adf0-11f1-ad53-0d91a06f3150.jpg.webp)

](https://www.bbc.com/news/articles/c305649p2d6o)

[

## 'It's rough out here': Americans struggle with rising inflation

US inflation continues to rise, and this month the jump was above forecasts. Here's how some are surviving.

3 hrs ago

US & Canada

](https://www.bbc.com/news/articles/c305649p2d6o)

[

![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![Woman fills up her car with fuel at forecourt](https://ichef.bbci.co.uk/news/480/cpsprodpb/bd50/live/e1cf6860-c7cf-11f1-9e10-4dcbd31d4273.jpg.webp)

## US inflation rises more than expected - here's what is happening with prices

The pace of price rises increased to 3.7% in the year to September, driving by higher motor fuel costs.

4 hrs ago

Business

](https://www.bbc.com/news/articles/cwy8lx3pg4k2o)

[

## Pope's family 'going through a lot' as brother also undergoes cancer treatment, wife says

Louis Prevost has blood cancer, his wife says as the Pope recovers from surgery for lung cancer.

3 hrs ago

US & Canada

](https://www.bbc.com/news/articles/c8r4yzx76rlzo)

[

## Island fossil identified as new dinosaur species

Invictibellatrix would have been up to four metres long with feathers and had 20cm claws.

14 hrs ago

Hampshire & Isle of Wight

](https://www.bbc.com/news/articles/cmvgx70v9vrjo)

[

![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![Volodymyr Zelensky and Andy Burnham shaking hands outside the front door of Number 10 Downing Street looking off camera. On either side of both men are soldiers from Number 12 Company Irish Guards Westminster wearing their red uniforms with bearskins.](https://ichef.bbci.co.uk/news/480/cpsprodpb/2403/live/b90b29e0-c7e9-11f1-9bb8-8794f734d112.png.webp)

## Burnham treads carefully with Zelensky visit, balancing Trump and Ukraine

The UK's prime minister meets with Volodymyr Zelensky after a rocky week for the Ukraine president.

2 hrs ago

Europe

](https://www.bbc.com/news/articles/cmx23q4dwvneo)

[

![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![Russell Brand walking into court weraing sunglasses with three paparazzi photographers talking photos behind him](https://ichef.bbci.co.uk/news/480/cpsprodpb/af54/live/088f5d80-c7d9-11f1-9a39-31b474234113.jpg.webp)

## Russell Brand was a 'sexual predator', prosecution alleges as rape trial begins

The comedian and actor faces charges including rape and sexual assault from six female complainants who have never met each other, a court is told.

1 hr ago

Culture

](https://www.bbc.com/news/articles/c3qjn45pepx1o)

[

![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![Woman with brown hair wearing a blue and white striped shirt holding a phone](https://ichef.bbci.co.uk/news/480/cpsprodpb/2835/live/1c61d100-c7fa-11f1-bc2e-018d645d8d21.jpg.webp)

## What if you could turn off your algorithm? Australia is about to try

New legislation is being tabled in Australia's parliament on Thursday to force big tech to allow users to switch off algorithms which send them recommended content.

1 hr ago

Australia

](https://www.bbc.com/news/videos/ck78pj2qy42po)

[

![](https://static.files.bbci.co.uk/bbcdotcom/web/20261005-153342-40cbc1e8b4-web-3.23.0-2/grey-placeholder.png)![A large ceramic storage pot is in the foreground and is at a slight angle leaning to the left. It has a narrow neck and two handles half way down on each side. To the right are some rocks. Behind you can just make out a diver with a large pipe that looks like a vacuum cleaner that sucks away the sand. The picture has a blue hue.](https://ichef.bbci.co.uk/news/480/cpsprodpb/19d5/live/72e7aa00-c71d-11f1-a82f-35874a3aae81.jpg.webp)

## World's oldest shipwreck found off coast of Turkey

Archaeologists say the wreck is up to 4,700 years old, dating to the Early Bronze Age.

14 hrs ago

Science & Environment

](https://www.bbc.com/news/articles/c6gr80rk1yyko)

[

## Starlink restrictions in Ukraine war linked to political situation, Zelensky aide says

](https://www.bbc.com/news/articles/cm2d6e62p49do)

[

## Australia's first-ever Michelin stars go to 11 restaurants in one state

](https://www.bbc.com/news/articles/crje5we583qwo)

[

## Netflix to shed 1,000 jobs in steepest cuts since 2022

](https://www.bbc.com/news/articles/c6zxj0gzk4x4o)

[

## Sally Rooney books withdrawn in UK over Palestine Action support

](http

[... conteudo truncado em 5000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```