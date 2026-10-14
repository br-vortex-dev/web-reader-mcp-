# caso 35: [F] rss-frontpage
ferramenta: read_page
argumentos: {"url":"https://hnrss.org/frontpage","maxChars":4000}
nota do teste: feed Atom
status HTTP: 200 | tempo: 676 ms | isError: false
sinais: chars=4221 tabelas=0 cercas=0 truncado=true mojibake=false cjk=false rtl=false links=26

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 35,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Hacker News: Front Page\nURL: https://hnrss.org/frontpage\nConteudo: 8506 caracteres (exibidos 4119)\n\nHacker News: Front Pagehttps://news.ycombinator.com/Hacker News RSShttps://hnrss.org/hnrss v2.1.1Wed, 14 Oct 2026 19:21:06 +0000Article URL: [https://www.kenklippenstein.com/p/how-the-military-will-hack-the-election](https://www.kenklippenstein.com/p/how-the-military-will-hack-the-election)\n\nComments URL: [https://news.ycombinator.com/item?id=50092847](https://news.ycombinator.com/item?id=50092847)\n\nPoints: 101\n\n# Comments: 29\n\n ]]>Wed, 14 Oct 2026 18:43:57 +0000https://www.kenklippenstein.com/p/how-the-military-will-hack-the-electionpavel_lishinhttps://news.ycombinator.com/item?id=50092847https://news.ycombinator.com/item?id=50092847Article URL: [https://dpa-international.com/politics/urn:newsml:dpa.com:20090101:261014-930-839530/](https://dpa-international.com/politics/urn:newsml:dpa.com:20090101:261014-930-839530/)\n\nComments URL: [https://news.ycombinator.com/item?id=50092730](https://news.ycombinator.com/item?id=50092730)\n\nPoints: 56\n\n# Comments: 14\n\n ]]>Wed, 14 Oct 2026 18:37:21 +0000https://dpa-international.com/politics/urn:newsml:dpa.com:20090101:261014-930-839530/ilamonthttps://news.ycombinator.com/item?id=50092730https://news.ycombinator.com/item?id=50092730Article URL: [https://startupfortune.com/banks-are-now-trying-to-offload-the-ai-data-center-debt-they-just-underwrote/](https://startupfortune.com/banks-are-now-trying-to-offload-the-ai-data-center-debt-they-just-underwrote/)\n\nComments URL: [https://news.ycombinator.com/item?id=50092664](https://news.ycombinator.com/item?id=50092664)\n\nPoints: 57\n\n# Comments: 18\n\n ]]>Wed, 14 Oct 2026 18:32:52 +0000https://startupfortune.com/banks-are-now-trying-to-offload-the-ai-data-center-debt-they-just-underwrote/smartmichttps://news.ycombinator.com/item?id=50092664https://news.ycombinator.com/item?id=50092664Hi HN!\nI’m Jason Thomas, one of the founders of CoScreen.\nAs some of you may know, Datadog sunset the CoScreen service on July 31st.\nFour of us from the original CoScreen team have spent the last couple months building a free and open source pair programming tool inspired by those that came before us: It’s called Petal ([https://github.com/kiruna-labs/petal](https://github.com/kiruna-labs/petal))\nSome history first, because when we started CoScreen we had hoped to break the sad and established pattern of this industry.\nScreenhero was an exceptional tool that a lot of us loved for pairing. Multiple cursors, low latency, you could click your partner’s editor, and just start typing. It felt like magic while we had it. Then Slack bought it in 2015, and shut down the standalone app in December 2017.\nWhen Till, Max, and I started CoScreen, we were aware of this history, and wanted to build an even more magical collaboration and screen sharing experience: the entire concept was “throw a window from your laptop up on someone else’s screen, and start collaborating with zero friction.”\nDatadog acquired us in 2022, and thus began the great adventure of adapting our real-time technology into Datadog products, while also continue developing CoScreen as a standalone tool from the Datadog ecosystem. Datadog invested in the product for years and we’re thankful for that. But CoScreen itself proved, like so many other screen sharing tool acquisitions, to be too tangential from the customer base and core mission. We instead built other communication features in Datadog, the integrations with other video platforms, and also its wildly successful MCP server. We weren't the only ones. Around was bought by Miro and shut down in March 2025. Multi (formerly Remotion) was acqui-hired by OpenAI in 2024 and shut down about a month later. It's nearly always the same story: a small team builds something hard that people love, a platform buys it for the team or the feature, and the standalone product doesn't survive the integration. So we decided firmly to do things differently this time. Petal is completely free and open source and we aren't monetizing it. If we lose interest or get hit by a bus, you ca\n\n[... conteudo truncado em 4000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# Hacker News: Front Page
URL: https://hnrss.org/frontpage
Conteudo: 8506 caracteres (exibidos 4119)

Hacker News: Front Pagehttps://news.ycombinator.com/Hacker News RSShttps://hnrss.org/hnrss v2.1.1Wed, 14 Oct 2026 19:21:06 +0000Article URL: [https://www.kenklippenstein.com/p/how-the-military-will-hack-the-election](https://www.kenklippenstein.com/p/how-the-military-will-hack-the-election)

Comments URL: [https://news.ycombinator.com/item?id=50092847](https://news.ycombinator.com/item?id=50092847)

Points: 101

# Comments: 29

 ]]>Wed, 14 Oct 2026 18:43:57 +0000https://www.kenklippenstein.com/p/how-the-military-will-hack-the-electionpavel_lishinhttps://news.ycombinator.com/item?id=50092847https://news.ycombinator.com/item?id=50092847Article URL: [https://dpa-international.com/politics/urn:newsml:dpa.com:20090101:261014-930-839530/](https://dpa-international.com/politics/urn:newsml:dpa.com:20090101:261014-930-839530/)

Comments URL: [https://news.ycombinator.com/item?id=50092730](https://news.ycombinator.com/item?id=50092730)

Points: 56

# Comments: 14

 ]]>Wed, 14 Oct 2026 18:37:21 +0000https://dpa-international.com/politics/urn:newsml:dpa.com:20090101:261014-930-839530/ilamonthttps://news.ycombinator.com/item?id=50092730https://news.ycombinator.com/item?id=50092730Article URL: [https://startupfortune.com/banks-are-now-trying-to-offload-the-ai-data-center-debt-they-just-underwrote/](https://startupfortune.com/banks-are-now-trying-to-offload-the-ai-data-center-debt-they-just-underwrote/)

Comments URL: [https://news.ycombinator.com/item?id=50092664](https://news.ycombinator.com/item?id=50092664)

Points: 57

# Comments: 18

 ]]>Wed, 14 Oct 2026 18:32:52 +0000https://startupfortune.com/banks-are-now-trying-to-offload-the-ai-data-center-debt-they-just-underwrote/smartmichttps://news.ycombinator.com/item?id=50092664https://news.ycombinator.com/item?id=50092664Hi HN!
I’m Jason Thomas, one of the founders of CoScreen.
As some of you may know, Datadog sunset the CoScreen service on July 31st.
Four of us from the original CoScreen team have spent the last couple months building a free and open source pair programming tool inspired by those that came before us: It’s called Petal ([https://github.com/kiruna-labs/petal](https://github.com/kiruna-labs/petal))
Some history first, because when we started CoScreen we had hoped to break the sad and established pattern of this industry.
Screenhero was an exceptional tool that a lot of us loved for pairing. Multiple cursors, low latency, you could click your partner’s editor, and just start typing. It felt like magic while we had it. Then Slack bought it in 2015, and shut down the standalone app in December 2017.
When Till, Max, and I started CoScreen, we were aware of this history, and wanted to build an even more magical collaboration and screen sharing experience: the entire concept was “throw a window from your laptop up on someone else’s screen, and start collaborating with zero friction.”
Datadog acquired us in 2022, and thus began the great adventure of adapting our real-time technology into Datadog products, while also continue developing CoScreen as a standalone tool from the Datadog ecosystem. Datadog invested in the product for years and we’re thankful for that. But CoScreen itself proved, like so many other screen sharing tool acquisitions, to be too tangential from the customer base and core mission. We instead built other communication features in Datadog, the integrations with other video platforms, and also its wildly successful MCP server. We weren't the only ones. Around was bought by Miro and shut down in March 2025. Multi (formerly Remotion) was acqui-hired by OpenAI in 2024 and shut down about a month later. It's nearly always the same story: a small team builds something hard that people love, a platform buys it for the team or the feature, and the standalone product doesn't survive the integration. So we decided firmly to do things differently this time. Petal is completely free and open source and we aren't monetizing it. If we lose interest or get hit by a bus, you ca

[... conteudo truncado em 4000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```