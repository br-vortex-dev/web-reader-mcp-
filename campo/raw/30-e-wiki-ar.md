# caso 30: [E] wiki-ar
ferramenta: read_page
argumentos: {"url":"https://ar.wikipedia.org/wiki/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA","maxChars":4000}
nota do teste: arabe (RTL)
status HTTP: 200 | tempo: 1740 ms | isError: false
sinais: chars=4264 tabelas=1 cercas=0 truncado=true mojibake=false cjk=false rtl=true links=32

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 30,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# رياضيات - ويكيبيديا\nURL: https://ar.wikipedia.org/wiki/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA\nConteudo: 216913 caracteres (exibidos 4119)\n\nانتقل إلى المحتوى\n\n[![هذه مقالةٌ جيّدةٌ، وتعد من أجود محتويات ويكيبيديا. انقر هنا للمزيد من المعلومات.](https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9d/Symbol_star_silver.svg/20px-Symbol_star_silver.svg.png?utm_source=ar.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ar.wikipedia.org/wiki/%D9%88%D9%8A%D9%83%D9%8A%D8%A8%D9%8A%D8%AF%D9%8A%D8%A7:%D9%85%D9%82%D8%A7%D9%84%D8%A7%D8%AA_%D8%AC%D9%8A%D8%AF%D8%A9)\n\nمن ويكيبيديا، الموسوعة الحرة\n\n| جزء [من سلسلة مقالات](https://ar.wikipedia.org/wiki/%D8%AA%D8%B5%D9%86%D9%8A%D9%81:%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) حول |\n| --- |\n| [الرياضيات](https://ar.wikipedia.org/wiki/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) |\n| [![](https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/Nuvola_Math_and_Inf.svg/250px-Nuvola_Math_and_Inf.svg.png?utm_source=ar.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ar.wikipedia.org/wiki/%D9%85%D9%84%D9%81:Nuvola_Math_and_Inf.svg) |\n| [الرياضيات البحتة](https://ar.wikipedia.org/wiki/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA_%D8%A8%D8%AD%D8%AA%D8%A9) - [الأسس](https://ar.wikipedia.org/wiki/%D8%A3%D8%B3%D8%B3_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) - [التحليل](https://ar.wikipedia.org/wiki/%D8%AA%D8%AD%D9%84%D9%8A%D9%84_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A) - [الجبر](https://ar.wikipedia.org/wiki/%D8%A7%D9%84%D8%AC%D8%A8%D8%B1) - [نظرية الأعداد](https://ar.wikipedia.org/wiki/%D9%86%D8%B8%D8%B1%D9%8A%D8%A9_%D8%A7%D9%84%D8%A3%D8%B9%D8%AF%D8%A7%D8%AF) - [التوافقيات](https://ar.wikipedia.org/wiki/%D8%AA%D8%B1%D9%83%D9%8A%D8%A8%D8%A7%D8%AA) - [الهندسة الرياضية](https://ar.wikipedia.org/wiki/%D9%87%D9%86%D8%AF%D8%B3%D8%A9_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A9) - [الطوبولوجيا](https://ar.wikipedia.org/wiki/%D8%B7%D9%88%D8%A8%D9%88%D9%84%D9%88%D8%AC%D9%8A%D8%A7) |\n| [الرياضيات التطبيقية](https://ar.wikipedia.org/wiki/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA_%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D9%8A%D8%A9) - [الاحتمالات](https://ar.wikipedia.org/wiki/%D8%A7%D8%AD%D8%AA%D9%85%D8%A7%D9%84) - [الإحصاء](https://ar.wikipedia.org/wiki/%D8%A5%D8%AD%D8%B5%D8%A7%D8%A1) - [الحوسبة العلمية](https://ar.wikipedia.org/wiki/%D8%AD%D9%88%D8%B3%D8%A8%D8%A9_%D8%B9%D9%84%D9%85%D9%8A%D8%A9) - [الفيزياء الرياضية](https://ar.wikipedia.org/wiki/%D9%81%D9%8A%D8%B2%D9%8A%D8%A7%D8%A1_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A9) - [بحوث العمليات](https://ar.wikipedia.org/wiki/%D8%A8%D8%AD%D9%88%D8%AB_%D8%A7%D9%84%D8%B9%D9%85%D9%84%D9%8A%D8%A7%D8%AA) - [الاستمثال](https://ar.wikipedia.org/wiki/%D8%A7%D8%B3%D8%AA%D9%85%D8%AB%D8%A7%D9%84_(%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA)) - [علم الأحياء الحاسوبي](https://ar.wikipedia.org/wiki/%D8%B9%D9%84%D9%85_%D8%A7%D9%84%D8%A3%D8%AD%D9%8A%D8%A7%D8%A1_%D8%A7%D9%84%D9%85%D8%AD%D9%88%D8%B3%D8%A8) - [لغويات حاسوبية](https://ar.wikipedia.org/wiki/%D9%84%D8%BA%D9%88%D9%8A%D8%A7%D8%AA_%D8%AD%D8%A7%D8%B3%D9%88%D8%A8%D9%8A%D8%A9) |\n| أيضًا - [مخطط](https://ar.wikipedia.org/wiki/%D9%85%D8%AE%D8%B7%D8%B7_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) - [مجالات](https://ar.wikipedia.org/wiki/%D9%85%D8%AC%D8%A7%D9%84%D8%A7%D8%AA_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) |\n| [![شعار بوابة](https://thumb.wikimedia.org/wikipedia/commons/thumb/2/26/Nuvola_apps_edu_mathematics-ar.svg/40px-Nuvola_apps_edu_mathematics-ar.svg.png?utm_source=ar.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ar.wikipedia.org/wiki/%D9%85%D9%84%D9%81:Nuvola_apps_edu_mathematics-ar.svg) [بوابة رياضيات](https://ar.wikipedia.org/wiki/%D8%A8%D9%88%D8%A7%D8%A8%D8%A9:%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) |\n| - [ع](https://ar.wikipedia.org/wiki/%D9%82%D8%A7%D9%84%D8%A8:%D8%B4%D8%B1%D9%8A%D8%B7_%D8%AC%D8%A7%D9%86%D8%A8%D9%8A_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) - [ن](https://ar.wikipedia.org/wiki/%D9%86%D9%82%D8%A7%D8%B4_%D8%A7%D9%84%D9%82%D8%A7%D9%84%D8%A8:%D8%B4%D8%B1%D9%8A%D8%B7_%D8%AC%D8%A7%D9%86%D8%A8%D9%8A_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) - [ت](https://ar.wikipedia.org/w/index.php?title=\n\n[... conteudo truncado em 4000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# رياضيات - ويكيبيديا
URL: https://ar.wikipedia.org/wiki/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA
Conteudo: 216913 caracteres (exibidos 4119)

انتقل إلى المحتوى

[![هذه مقالةٌ جيّدةٌ، وتعد من أجود محتويات ويكيبيديا. انقر هنا للمزيد من المعلومات.](https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9d/Symbol_star_silver.svg/20px-Symbol_star_silver.svg.png?utm_source=ar.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ar.wikipedia.org/wiki/%D9%88%D9%8A%D9%83%D9%8A%D8%A8%D9%8A%D8%AF%D9%8A%D8%A7:%D9%85%D9%82%D8%A7%D9%84%D8%A7%D8%AA_%D8%AC%D9%8A%D8%AF%D8%A9)

من ويكيبيديا، الموسوعة الحرة

| جزء [من سلسلة مقالات](https://ar.wikipedia.org/wiki/%D8%AA%D8%B5%D9%86%D9%8A%D9%81:%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) حول |
| --- |
| [الرياضيات](https://ar.wikipedia.org/wiki/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) |
| [![](https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/Nuvola_Math_and_Inf.svg/250px-Nuvola_Math_and_Inf.svg.png?utm_source=ar.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ar.wikipedia.org/wiki/%D9%85%D9%84%D9%81:Nuvola_Math_and_Inf.svg) |
| [الرياضيات البحتة](https://ar.wikipedia.org/wiki/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA_%D8%A8%D8%AD%D8%AA%D8%A9) - [الأسس](https://ar.wikipedia.org/wiki/%D8%A3%D8%B3%D8%B3_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) - [التحليل](https://ar.wikipedia.org/wiki/%D8%AA%D8%AD%D9%84%D9%8A%D9%84_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A) - [الجبر](https://ar.wikipedia.org/wiki/%D8%A7%D9%84%D8%AC%D8%A8%D8%B1) - [نظرية الأعداد](https://ar.wikipedia.org/wiki/%D9%86%D8%B8%D8%B1%D9%8A%D8%A9_%D8%A7%D9%84%D8%A3%D8%B9%D8%AF%D8%A7%D8%AF) - [التوافقيات](https://ar.wikipedia.org/wiki/%D8%AA%D8%B1%D9%83%D9%8A%D8%A8%D8%A7%D8%AA) - [الهندسة الرياضية](https://ar.wikipedia.org/wiki/%D9%87%D9%86%D8%AF%D8%B3%D8%A9_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A9) - [الطوبولوجيا](https://ar.wikipedia.org/wiki/%D8%B7%D9%88%D8%A8%D9%88%D9%84%D9%88%D8%AC%D9%8A%D8%A7) |
| [الرياضيات التطبيقية](https://ar.wikipedia.org/wiki/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA_%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D9%8A%D8%A9) - [الاحتمالات](https://ar.wikipedia.org/wiki/%D8%A7%D8%AD%D8%AA%D9%85%D8%A7%D9%84) - [الإحصاء](https://ar.wikipedia.org/wiki/%D8%A5%D8%AD%D8%B5%D8%A7%D8%A1) - [الحوسبة العلمية](https://ar.wikipedia.org/wiki/%D8%AD%D9%88%D8%B3%D8%A8%D8%A9_%D8%B9%D9%84%D9%85%D9%8A%D8%A9) - [الفيزياء الرياضية](https://ar.wikipedia.org/wiki/%D9%81%D9%8A%D8%B2%D9%8A%D8%A7%D8%A1_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A9) - [بحوث العمليات](https://ar.wikipedia.org/wiki/%D8%A8%D8%AD%D9%88%D8%AB_%D8%A7%D9%84%D8%B9%D9%85%D9%84%D9%8A%D8%A7%D8%AA) - [الاستمثال](https://ar.wikipedia.org/wiki/%D8%A7%D8%B3%D8%AA%D9%85%D8%AB%D8%A7%D9%84_(%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA)) - [علم الأحياء الحاسوبي](https://ar.wikipedia.org/wiki/%D8%B9%D9%84%D9%85_%D8%A7%D9%84%D8%A3%D8%AD%D9%8A%D8%A7%D8%A1_%D8%A7%D9%84%D9%85%D8%AD%D9%88%D8%B3%D8%A8) - [لغويات حاسوبية](https://ar.wikipedia.org/wiki/%D9%84%D8%BA%D9%88%D9%8A%D8%A7%D8%AA_%D8%AD%D8%A7%D8%B3%D9%88%D8%A8%D9%8A%D8%A9) |
| أيضًا - [مخطط](https://ar.wikipedia.org/wiki/%D9%85%D8%AE%D8%B7%D8%B7_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) - [مجالات](https://ar.wikipedia.org/wiki/%D9%85%D8%AC%D8%A7%D9%84%D8%A7%D8%AA_%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) |
| [![شعار بوابة](https://thumb.wikimedia.org/wikipedia/commons/thumb/2/26/Nuvola_apps_edu_mathematics-ar.svg/40px-Nuvola_apps_edu_mathematics-ar.svg.png?utm_source=ar.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://ar.wikipedia.org/wiki/%D9%85%D9%84%D9%81:Nuvola_apps_edu_mathematics-ar.svg) [بوابة رياضيات](https://ar.wikipedia.org/wiki/%D8%A8%D9%88%D8%A7%D8%A8%D8%A9:%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) |
| - [ع](https://ar.wikipedia.org/wiki/%D9%82%D8%A7%D9%84%D8%A8:%D8%B4%D8%B1%D9%8A%D8%B7_%D8%AC%D8%A7%D9%86%D8%A8%D9%8A_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) - [ن](https://ar.wikipedia.org/wiki/%D9%86%D9%82%D8%A7%D8%B4_%D8%A7%D9%84%D9%82%D8%A7%D9%84%D8%A8:%D8%B4%D8%B1%D9%8A%D8%B7_%D8%AC%D8%A7%D9%86%D8%A8%D9%8A_%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA) - [ت](https://ar.wikipedia.org/w/index.php?title=

[... conteudo truncado em 4000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```