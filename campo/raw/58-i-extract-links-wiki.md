# caso 58: [I] extract-links-wiki
ferramenta: extract_links
argumentos: {"url":"https://pt.wikipedia.org/wiki/Node.js","limit":50}
nota do teste: links relativos, ancoras, externos
status HTTP: 200 | tempo: 366 ms | isError: false
sinais: chars=4298 tabelas=0 cercas=0 truncado=false mojibake=false cjk=false rtl=false links=51

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 58,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Links em https://pt.wikipedia.org/wiki/Node.js: 218 encontrados, exibindo 50.\n\n1. Esta página cita fontes, mas não cobrem todo o conteúdo\n   https://pt.wikipedia.org/wiki/Ficheiro:Question_book-new.svg (interno)\n2. cita fontes\n   https://pt.wikipedia.org/wiki/Wikip%C3%A9dia:Livro_de_estilo/Cite_as_fontes (interno)\n3. não cobrem\n   https://pt.wikipedia.org/wiki/Wikip%C3%A9dia:Verificabilidade (interno)\n4. inserir referências\n   https://pt.wikipedia.org/wiki/Wikip%C3%A9dia:Livro_de_estilo/Refer%C3%AAncias_e_notas_de_rodap%C3%A9 (interno)\n5. Google\n   https://www.google.com/search?as_eq=wikipedia&as_epq=Node.js (externo)\n6. N\n   https://www.google.com/search?hl=pt&tbm=nws&q=Node.js&oq=Node.js (externo)\n7. L\n   http://books.google.com/books?&as_brr=0&as_epq=Node.js (externo)\n8. A\n   https://scholar.google.com/scholar?hl=pt&q=Node.js (externo)\n9. I\n   https://www.google.com/search?safe=off&tbs=sur:fmc&tbm=isch&q=%22Node.js%22+-site:wikipedia.org+-site:wikimedia.org (externo)\n10. WP refs\n   https://www.google.com/custom?hl=pt&cx=007734830908295939403%3Agalkqgoksq0&cof=FORID%3A13%3BAH%3Aleft%3BCX%3AWikipedia%2520Reference%2520Search&q=%22Node.js%22 (externo)\n11. ABW\n   https://wikipedialibrary.wmflabs.org/search/?q=%22Node.js%22 (externo)\n12. CAPES\n   https://www.periodicos.capes.gov.br/index.php/acervo/buscador.html?q=all%3Acontains%28Node.js%29&mode=advanced&source=all (externo)\n13. (sem texto)\n   https://pt.wikipedia.org/wiki/Ficheiro:Node.js_logo.svg (interno)\n14. Autor\n   https://pt.wikipedia.org/wiki/Programador (interno)\n15. Ryan Dahl\n   https://pt.wikipedia.org/wiki/Ryan_Dahl?action=edit&redlink=1 (interno)\n16. Node.js Developers\n   https://github.com/nodejs/node/blob/master/AUTHORS (externo)\n17. Linux Foundation\n   https://pt.wikipedia.org/wiki/Linux_Foundation (interno)\n18. 27 de maio\n   https://pt.wikipedia.org/wiki/27_de_maio (interno)\n19. 2009\n   https://pt.wikipedia.org/wiki/2009 (interno)\n20. Lançamento estável\n   https://pt.wikipedia.org/wiki/Ciclo_de_vida_de_libera%C3%A7%C3%A3o_de_software (interno)\n21. Edit this on Wikidata\n   https://www.wikidata.org/wiki/Q756100?uselang=pt#P348 (externo)\n22. Repositório\n   https://pt.wikipedia.org/wiki/Reposit%C3%B3rio (interno)\n23. node\n   https://github.com/nodejs/node (externo)\n24. GitHub\n   https://pt.wikipedia.org/wiki/GitHub (interno)\n25. C\n   https://pt.wikipedia.org/wiki/C_(linguagem_de_programa%C3%A7%C3%A3o) (interno)\n26. C++\n   https://pt.wikipedia.org/wiki/C++ (interno)\n27. JavaScript\n   https://pt.wikipedia.org/wiki/JavaScript (interno)\n28. Sistemaoperacional\n   https://pt.wikipedia.org/wiki/Sistema_operacional (interno)\n29. Linux\n   https://pt.wikipedia.org/wiki/Linux (interno)\n30. Windows\n   https://pt.wikipedia.org/wiki/Microsoft_Windows (interno)\n31. macOS\n   https://pt.wikipedia.org/wiki/MacOS (interno)\n32. SmartOS\n   https://pt.wikipedia.org/wiki/SmartOS?action=edit&redlink=1 (interno)\n33. AIX\n   https://pt.wikipedia.org/wiki/Advanced_Interactive_eXecutive (interno)\n34. FreeBSD\n   https://pt.wikipedia.org/wiki/FreeBSD (interno)\n35. Tipo\n   https://pt.wikipedia.org/wiki/Categorias_de_software#Abordagens_de_categoriza%C3%A7%C3%A3o (interno)\n36. Sistema de tempo de execução\n   https://pt.wikipedia.org/wiki/Sistema_de_tempo_de_execu%C3%A7%C3%A3o (interno)\n37. Licença\n   https://pt.wikipedia.org/wiki/Licen%C3%A7a_de_software (interno)\n38. MIT\n   https://pt.wikipedia.org/wiki/MIT_License (interno)\n39. nodejs.org\n   https://nodejs.org/ (externo)\n40. código aberto\n   https://pt.wikipedia.org/wiki/Open-source (interno)\n41. multiplataforma\n   https://pt.wikipedia.org/wiki/Cross-platform (interno)\n42. V8\n   https://pt.wikipedia.org/wiki/V8_(JavaScript) (interno)\n43. Google\n   https://pt.wikipedia.org/wiki/Google (interno)\n44. navegador web\n   https://pt.wikipedia.org/wiki/Navegador_web (interno)\n45. orientada por eventos\n   https://en.wikipedia.org/wiki/event-driven%20architecture (externo)\n46. runtime\n   https://pt.wikipedia.org/wiki/Runtime (interno)\n47. single-thread\n   https://en.wikipedia.org/wiki/single%20thread (externo)\n48. thread\n   https://pt.wikipedia.org/wiki/Thread_(computa%C3%A7%C3%A3o) (interno)\n49. event loop\n   https://pt.wikipedia.org/wiki/La%C3%A7o_de_eventos (interno)\n50. entrada/saída\n   https://pt.wikipedia.org/wiki/Entrada/sa%C3%ADda (interno)"
      }
    ]
  }
}
```

## texto extraido
```
Links em https://pt.wikipedia.org/wiki/Node.js: 218 encontrados, exibindo 50.

1. Esta página cita fontes, mas não cobrem todo o conteúdo
   https://pt.wikipedia.org/wiki/Ficheiro:Question_book-new.svg (interno)
2. cita fontes
   https://pt.wikipedia.org/wiki/Wikip%C3%A9dia:Livro_de_estilo/Cite_as_fontes (interno)
3. não cobrem
   https://pt.wikipedia.org/wiki/Wikip%C3%A9dia:Verificabilidade (interno)
4. inserir referências
   https://pt.wikipedia.org/wiki/Wikip%C3%A9dia:Livro_de_estilo/Refer%C3%AAncias_e_notas_de_rodap%C3%A9 (interno)
5. Google
   https://www.google.com/search?as_eq=wikipedia&as_epq=Node.js (externo)
6. N
   https://www.google.com/search?hl=pt&tbm=nws&q=Node.js&oq=Node.js (externo)
7. L
   http://books.google.com/books?&as_brr=0&as_epq=Node.js (externo)
8. A
   https://scholar.google.com/scholar?hl=pt&q=Node.js (externo)
9. I
   https://www.google.com/search?safe=off&tbs=sur:fmc&tbm=isch&q=%22Node.js%22+-site:wikipedia.org+-site:wikimedia.org (externo)
10. WP refs
   https://www.google.com/custom?hl=pt&cx=007734830908295939403%3Agalkqgoksq0&cof=FORID%3A13%3BAH%3Aleft%3BCX%3AWikipedia%2520Reference%2520Search&q=%22Node.js%22 (externo)
11. ABW
   https://wikipedialibrary.wmflabs.org/search/?q=%22Node.js%22 (externo)
12. CAPES
   https://www.periodicos.capes.gov.br/index.php/acervo/buscador.html?q=all%3Acontains%28Node.js%29&mode=advanced&source=all (externo)
13. (sem texto)
   https://pt.wikipedia.org/wiki/Ficheiro:Node.js_logo.svg (interno)
14. Autor
   https://pt.wikipedia.org/wiki/Programador (interno)
15. Ryan Dahl
   https://pt.wikipedia.org/wiki/Ryan_Dahl?action=edit&redlink=1 (interno)
16. Node.js Developers
   https://github.com/nodejs/node/blob/master/AUTHORS (externo)
17. Linux Foundation
   https://pt.wikipedia.org/wiki/Linux_Foundation (interno)
18. 27 de maio
   https://pt.wikipedia.org/wiki/27_de_maio (interno)
19. 2009
   https://pt.wikipedia.org/wiki/2009 (interno)
20. Lançamento estável
   https://pt.wikipedia.org/wiki/Ciclo_de_vida_de_libera%C3%A7%C3%A3o_de_software (interno)
21. Edit this on Wikidata
   https://www.wikidata.org/wiki/Q756100?uselang=pt#P348 (externo)
22. Repositório
   https://pt.wikipedia.org/wiki/Reposit%C3%B3rio (interno)
23. node
   https://github.com/nodejs/node (externo)
24. GitHub
   https://pt.wikipedia.org/wiki/GitHub (interno)
25. C
   https://pt.wikipedia.org/wiki/C_(linguagem_de_programa%C3%A7%C3%A3o) (interno)
26. C++
   https://pt.wikipedia.org/wiki/C++ (interno)
27. JavaScript
   https://pt.wikipedia.org/wiki/JavaScript (interno)
28. Sistemaoperacional
   https://pt.wikipedia.org/wiki/Sistema_operacional (interno)
29. Linux
   https://pt.wikipedia.org/wiki/Linux (interno)
30. Windows
   https://pt.wikipedia.org/wiki/Microsoft_Windows (interno)
31. macOS
   https://pt.wikipedia.org/wiki/MacOS (interno)
32. SmartOS
   https://pt.wikipedia.org/wiki/SmartOS?action=edit&redlink=1 (interno)
33. AIX
   https://pt.wikipedia.org/wiki/Advanced_Interactive_eXecutive (interno)
34. FreeBSD
   https://pt.wikipedia.org/wiki/FreeBSD (interno)
35. Tipo
   https://pt.wikipedia.org/wiki/Categorias_de_software#Abordagens_de_categoriza%C3%A7%C3%A3o (interno)
36. Sistema de tempo de execução
   https://pt.wikipedia.org/wiki/Sistema_de_tempo_de_execu%C3%A7%C3%A3o (interno)
37. Licença
   https://pt.wikipedia.org/wiki/Licen%C3%A7a_de_software (interno)
38. MIT
   https://pt.wikipedia.org/wiki/MIT_License (interno)
39. nodejs.org
   https://nodejs.org/ (externo)
40. código aberto
   https://pt.wikipedia.org/wiki/Open-source (interno)
41. multiplataforma
   https://pt.wikipedia.org/wiki/Cross-platform (interno)
42. V8
   https://pt.wikipedia.org/wiki/V8_(JavaScript) (interno)
43. Google
   https://pt.wikipedia.org/wiki/Google (interno)
44. navegador web
   https://pt.wikipedia.org/wiki/Navegador_web (interno)
45. orientada por eventos
   https://en.wikipedia.org/wiki/event-driven%20architecture (externo)
46. runtime
   https://pt.wikipedia.org/wiki/Runtime (interno)
47. single-thread
   https://en.wikipedia.org/wiki/single%20thread (externo)
48. thread
   https://pt.wikipedia.org/wiki/Thread_(computa%C3%A7%C3%A3o) (interno)
49. event loop
   https://pt.wikipedia.org/wiki/La%C3%A7o_de_eventos (interno)
50. entrada/saída
   https://pt.wikipedia.org/wiki/Entrada/sa%C3%ADda (interno)
```