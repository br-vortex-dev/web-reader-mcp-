# caso 51: [G] cern-antigo
ferramenta: read_page
argumentos: {"url":"http://info.cern.ch/hypertext/WWW/TheProject.html","maxChars":2000}
nota do teste: HTML antigo/minimo
status HTTP: 200 | tempo: 395 ms | isError: false
sinais: chars=2246 tabelas=0 cercas=0 truncado=true mojibake=false cjk=false rtl=false links=22

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 51,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# The World Wide Web project\nURL: http://info.cern.ch/hypertext/WWW/TheProject.html\nConteudo: 2365 caracteres (exibidos 2119)\n\n# World Wide Web\n\nThe WorldWideWeb (W3) is a wide-area[ hypermedia](http://info.cern.ch/hypertext/WWW/WhatIs.html) information retrieval initiative aiming to give universal access to a large universe of documents.\n Everything there is online about W3 is linked directly or indirectly to this document, including an [executive summary](http://info.cern.ch/hypertext/WWW/Summary.html) of the project, [Mailing lists](http://info.cern.ch/hypertext/WWW/Administration/Mailing/Overview.html) , [Policy](http://info.cern.ch/hypertext/WWW/Policy.html) , November's [W3 news](http://info.cern.ch/hypertext/WWW/News/9211.html) , [Frequently Asked Questions](http://info.cern.ch/hypertext/WWW/FAQ/List.html) .\n [What's out there?](http://info.cern.ch/hypertext/DataSources/Top.html) Pointers to the world's online information,[ subjects](http://info.cern.ch/hypertext/DataSources/bySubject/Overview.html) , [W3 servers](http://info.cern.ch/hypertext/DataSources/WWW/Servers.html), etc. [Help](http://info.cern.ch/hypertext/WWW/Help.html) on the browser you are using [Software Products](http://info.cern.ch/hypertext/WWW/Status.html) A list of W3 project components and their current state. (e.g. [Line Mode](http://info.cern.ch/hypertext/WWW/LineMode/Browser.html) ,X11 [Viola](http://info.cern.ch/hypertext/WWW/Status.html#35) , [NeXTStep](http://info.cern.ch/hypertext/WWW/NeXT/WorldWideWeb.html) , [Servers](http://info.cern.ch/hypertext/WWW/Daemon/Overview.html) , [Tools](http://info.cern.ch/hypertext/WWW/Tools/Overview.html) ,[ Mail robot](http://info.cern.ch/hypertext/WWW/MailRobot/Overview.html) ,[ Library](http://info.cern.ch/hypertext/WWW/Status.html#57) ) [Technical](http://info.cern.ch/hypertext/WWW/Technical.html) Details of protocols, formats, program internals etc [Bibliography](http://info.cern.ch/hypertext/WWW/Bibliography.html) Paper documentation on W3 and references. [People](http://info.cern.ch/hypertext/WWW/People.html) A list of some people involved in the project. [History](h\n\n[... conteudo truncado em 2000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# The World Wide Web project
URL: http://info.cern.ch/hypertext/WWW/TheProject.html
Conteudo: 2365 caracteres (exibidos 2119)

# World Wide Web

The WorldWideWeb (W3) is a wide-area[ hypermedia](http://info.cern.ch/hypertext/WWW/WhatIs.html) information retrieval initiative aiming to give universal access to a large universe of documents.
 Everything there is online about W3 is linked directly or indirectly to this document, including an [executive summary](http://info.cern.ch/hypertext/WWW/Summary.html) of the project, [Mailing lists](http://info.cern.ch/hypertext/WWW/Administration/Mailing/Overview.html) , [Policy](http://info.cern.ch/hypertext/WWW/Policy.html) , November's [W3 news](http://info.cern.ch/hypertext/WWW/News/9211.html) , [Frequently Asked Questions](http://info.cern.ch/hypertext/WWW/FAQ/List.html) .
 [What's out there?](http://info.cern.ch/hypertext/DataSources/Top.html) Pointers to the world's online information,[ subjects](http://info.cern.ch/hypertext/DataSources/bySubject/Overview.html) , [W3 servers](http://info.cern.ch/hypertext/DataSources/WWW/Servers.html), etc. [Help](http://info.cern.ch/hypertext/WWW/Help.html) on the browser you are using [Software Products](http://info.cern.ch/hypertext/WWW/Status.html) A list of W3 project components and their current state. (e.g. [Line Mode](http://info.cern.ch/hypertext/WWW/LineMode/Browser.html) ,X11 [Viola](http://info.cern.ch/hypertext/WWW/Status.html#35) , [NeXTStep](http://info.cern.ch/hypertext/WWW/NeXT/WorldWideWeb.html) , [Servers](http://info.cern.ch/hypertext/WWW/Daemon/Overview.html) , [Tools](http://info.cern.ch/hypertext/WWW/Tools/Overview.html) ,[ Mail robot](http://info.cern.ch/hypertext/WWW/MailRobot/Overview.html) ,[ Library](http://info.cern.ch/hypertext/WWW/Status.html#57) ) [Technical](http://info.cern.ch/hypertext/WWW/Technical.html) Details of protocols, formats, program internals etc [Bibliography](http://info.cern.ch/hypertext/WWW/Bibliography.html) Paper documentation on W3 and references. [People](http://info.cern.ch/hypertext/WWW/People.html) A list of some people involved in the project. [History](h

[... conteudo truncado em 2000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```