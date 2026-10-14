# caso 1: [A] mdn-array-filter
ferramenta: read_page
argumentos: {"url":"https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/filter","maxChars":9000}
nota do teste: blocos de codigo + tabela de compatibilidade
status HTTP: 200 | tempo: 1328 ms | isError: false
sinais: chars=9436 tabelas=1 cercas=14 truncado=true mojibake=false cjk=false rtl=false links=16

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Array.prototype.filter() - JavaScript | MDN\nURL: https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/filter\nDescricao: O método filter() cria um novo array com todos os elementos que passaram no teste implementado pela função fornecida.\nConteudo: 9229 caracteres (exibidos 9119)\n\n- Skip to main content\n - Skip to search\n\nEsta página foi traduzida do inglês pela comunidade. [Saiba mais e junte-se à comunidade MDN Web Docs.](https://developer.mozilla.org/pt-BR/docs/MDN/Community/Contributing/Translated_content#locais_ativos)\n\n View in English Always switch to English\n\n# Array.prototype.filter()\n\n Baseline\n\nWidely available\n\nThis feature is well established and works across many devices and browser versions. It’s been available across browsers since julho de 2015.\n\n - See full compatibility\n - [ Learn more ](https://developer.mozilla.org/pt-BR/docs/Glossary/Baseline/Compatibility)\n\nO método **`filter()`** cria um novo array com todos os elementos que passaram no teste implementado pela função fornecida.\n\n## Experimente\n\n```\nconst words = [\"spray\", \"elite\", \"exuberant\", \"destruction\", \"present\"];\n\nconst result = words.filter((word) => word.length > 6);\n\nconsole.log(result);\n// Expected output: Array [\"exuberant\", \"destruction\", \"present\"]\n```\n\n## Sintaxe\n\n```\nvar newArray = arr.filter(callback[, thisArg])\n```\n\n### Parâmetros\n\n `callback`\nFunção é um predicado, para testar cada elemento do array. Retorna `true` para manter o elemento, `false` caso contrário, recebendo três argumentos:\n\n `element`\nO elemento que está sendo processado no array.\n\n `index`\nO índice do elemento atual que está sendo processado no array.\n\n `array`\nO array para qual `filter` foi chamada.\n\n `thisArg Optional`\nOpcional. Valor a ser usado como `this` durante a execução do `callback`.\n\n### Valor de retorno\n\nUm novo array com os elementos que passaram no teste.\n\n## Descrição\n\n`filter()` chama a função callback fornecida, uma vez para cada elemento do array, e constrói um novo array com todos os valores para os quais o `callback` retornou o valor `true` ou [um valor que seja convertido para true](https://developer.mozilla.org/pt-BR/docs/Glossary/Truthy). O `callback` é chamado apenas para índices do array que possuem valores atribuídos; Ele não é invocado para índices que foram excluídos ou para aqueles que não tiveram valor atribuído. Elementos do array que não passaram no teste do `callback` são simplesmente ignorados, e não são incluídos no novo array.\n\n`callback` é invocado com estes três argumentos:\n\n - o valor do elemento\n - o índice do elemento\n - o objeto do array a ser preenchido\n\nSe o parâmetro `thisArg` for provido para o filter, ele será passado para o `callback` quando invocado, para ser usado como o valor do this. Caso contrário, será passado `undefined` como o valor de `this`. O valor do `this` finalmente observado pela função de `callback` é determinado de acordo com [a regra que define o valor do `this` geralmente visto por uma função](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Operators/this).\n\n`filter()` não altera o `array` a partir da qual foi invocado.\n\nO intervalo de elementos processados pela função `filter()` é definido antes da invocação do primeiro callback. Elementos que forem adicionados ao array depois da invocação do `filter()` não serão visitados pelo `callback`. Se elementos existentes no array forem alterados ou deletados, os valores deles que serão passados para o callback são os que eles tiverem quando o `filter()` visitá-los; Elementos que forem deletados não são visitados.\n\n## Exemplos\n\n### Exemplo: Filtrando todos os valores pequenos\n\nOs exemplos a seguir usam `filter()` para criar um `array` filtrado em que todos os elementos com valores menores que 10 são removidos.\n\njs\n\n```\nfunction isBigEnough(value) {\n  return value >= 10;\n}\nvar filtered = [12, 5, 8, 130, 44].filter(isBigEnough);\n// filtered is [12, 130, 44]\n```\n\n### Exemplo: Filtrando entradas inválidas para JSON\n\nO exemplo a seguir usa `filter()` para criar um `JSON` filtrado com todos seus elementos diferentes de zero, e `id` numérico.\n\njs\n\n```\nvar arr = [\n  { id: 15 },\n  { id: -1 },\n  { id: 0 },\n  { id: 3 },\n  { id: 12.2 },\n  {},\n  { id: null },\n  { id: NaN },\n  { id: \"undefined\" },\n];\n\nvar invalidEntries = 0;\n\nfunction filterByID(obj) {\n  if (\"id\" in obj && typeof obj.id === \"number\" && !isNaN(obj.id)) {\n    return true;\n  } else {\n    invalidEntries++;\n    return false;\n  }\n}\n\nvar arrByID = arr.filter(filterByID);\n\nconsole.log(\"Filtered Array\\n\", arrByID);\n// [{ id: 15 }, { id: -1 }, { id: 0 }, { id: 3 }, { id: 12.2 }]\n\nconsole.log(\"Number of Invalid Entries = \", invalidEntries);\n// Number of Invalid Entries = 4\n```\n\n### Procurando em um array\n\nO exemplo a seguir usa `filter()` para filtrar o conteúdo de um array baseado em um critério de busca\n\njs\n\n```\nvar fruits = [\"apple\", \"banana\", \"grapes\", \"mango\", \"orange\"];\n\n/**\n * Array filters items based on search criteria (query)\n */\nfunction filterItems(query) {\n  return fruits.filter(function (el) {\n    return el.toLowerCase().indexOf(query.toLowerCase()) > -1;\n  });\n}\n\nconsole.log(filterItems(\"ap\")); // ['apple', 'grapes']\nconsole.log(filterItems(\"an\")); // ['banana', 'mango', 'orange']\n```\n\n### Implementação ES2015\n\njs\n\n```\nconst fruits = [\"apple\", \"banana\", \"grapes\", \"mango\", \"orange\"];\n\n/**\n * Array filters items based on search criteria (query)\n */\nconst filterItems = (query) => {\n  return fruits.filter(\n    (el) => el.toLowerCase().indexOf(query.toLowerCase()) > -1,\n  );\n};\n\nconsole.log(filterItems(\"ap\")); // ['apple', 'grapes']\nconsole.log(filterItems(\"an\")); // ['banana', 'mango', 'orange']\n```\n\n## Polyfill\n\n`filter()` foi adicionado ao padrão ECMA-262 na 5ª edição; assim como pode não estar presente em todas as implementações do padrão. Você pode trabalhar com isso adicionando o seguinte código no início de seus scripts, permitindo o uso do `filter()` na implementação ECMA-262 que não tem suporte nativo. Esse algoritmo é exatamente aquele especificado na 5ª edição do ECMA-262, assumindo que `fn.call` veja o valor original de [`Function.prototype.call()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Function/call), e que [`Array.prototype.push()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/push) tenha seu valor original.\n\njs\n\n```\nif (!Array.prototype.filter) {\n  Array.prototype.filter = function (fun /*, thisArg*/) {\n    \"use strict\";\n\n    if (this === void 0 || this === null) {\n      throw new TypeError();\n    }\n\n    var t = Object(this);\n    var len = t.length >>> 0;\n    if (typeof fun !== \"function\") {\n      throw new TypeError();\n    }\n\n    var res = [];\n    var thisArg = arguments.length >= 2 ? arguments[1] : void 0;\n    for (var i = 0; i < len; i++) {\n      if (i in t) {\n        var val = t[i];\n\n        // NOTE: Technically this should Object.defineProperty at\n        //       the next index, as push can be affected by\n        //       properties on Object.prototype and Array.prototype.\n        //       But that method's new, and collisions should be\n        //       rare, so use the more-compatible alternative.\n        if (fun.call(thisArg, val, i, t)) {\n          res.push(val);\n        }\n      }\n    }\n\n    return res;\n  };\n}\n```\n\n## Especificações\n\n| Specification |\n| --- |\n| [ECMAScript® 2027 Language Specification # sec-array.prototype.filter](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.filter) |\n\n## Compatibilidade com navegadores\n\n## Veja também\n\n - [`Array.prototype.forEach()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach)\n - [`Array.prototype.every()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/every)\n - [`Array.prototype.some()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/some)\n - [`Array.prototype.reduce()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce)\n\n## Help improve MDN\n\n [Learn how to contribute](https://developer.mozilla.org/pt-BR/docs/MDN/Community/Getting_started)\n This page was last modified on 24 de jun. de 2025 by [MDN contributors](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/filter/contributors.txt).\n\n [View this page on GitHub](https://github.com/mdn/translated-content/blob/main/files/pt-br/web/javascript/reference/global_objects/array/filter/index.md?plain=1) • [Report a problem with this content](https://github.com/mdn/translated-content/issues/new?template=page-report-pt-br.yml&mdn-url=https%3A%2F%2Fdeveloper.mozilla.org%2Fpt-BR%2Fdocs%2FWeb%2FJavaScript%2FReference%2FGlobal_Objects%2FArray%2Ffilter&metadata=%3C%21--+Do+not+make+changes+below+this+line+--%3E%0A%3Cdetails%3E%0A%3Csummary%3EPage+report+details%3C%2Fsummary%3E%0A%0A*+Folder%3A+%60pt-br%2Fweb%2Fjavascript%2Freference%2Fglobal_objects%2Farray%2Ffilter%60%0A*+MDN+URL%3A+https%3A%2F%2Fdeveloper.mozilla.org%2Fpt-BR%2Fdocs%2FWeb%2FJavaScript%2FReference%2FGlobal_Objects%2FArray%2Ffilter%0A*+GitHub+URL%3A+https%3A%2F%2Fgithub.com%2Fmdn%2Ftranslated-content%2Fblob%2Fmain%2Ffiles%2Fpt-br%2Fweb%2Fjavascript%2Freference%2Fglobal_objects%2Fa\n\n[... conteudo truncado em 9000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# Array.prototype.filter() - JavaScript | MDN
URL: https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/filter
Descricao: O método filter() cria um novo array com todos os elementos que passaram no teste implementado pela função fornecida.
Conteudo: 9229 caracteres (exibidos 9119)

- Skip to main content
 - Skip to search

Esta página foi traduzida do inglês pela comunidade. [Saiba mais e junte-se à comunidade MDN Web Docs.](https://developer.mozilla.org/pt-BR/docs/MDN/Community/Contributing/Translated_content#locais_ativos)

 View in English Always switch to English

# Array.prototype.filter()

 Baseline

Widely available

This feature is well established and works across many devices and browser versions. It’s been available across browsers since julho de 2015.

 - See full compatibility
 - [ Learn more ](https://developer.mozilla.org/pt-BR/docs/Glossary/Baseline/Compatibility)

O método **`filter()`** cria um novo array com todos os elementos que passaram no teste implementado pela função fornecida.

## Experimente

```
const words = ["spray", "elite", "exuberant", "destruction", "present"];

const result = words.filter((word) => word.length > 6);

console.log(result);
// Expected output: Array ["exuberant", "destruction", "present"]
```

## Sintaxe

```
var newArray = arr.filter(callback[, thisArg])
```

### Parâmetros

 `callback`
Função é um predicado, para testar cada elemento do array. Retorna `true` para manter o elemento, `false` caso contrário, recebendo três argumentos:

 `element`
O elemento que está sendo processado no array.

 `index`
O índice do elemento atual que está sendo processado no array.

 `array`
O array para qual `filter` foi chamada.

 `thisArg Optional`
Opcional. Valor a ser usado como `this` durante a execução do `callback`.

### Valor de retorno

Um novo array com os elementos que passaram no teste.

## Descrição

`filter()` chama a função callback fornecida, uma vez para cada elemento do array, e constrói um novo array com todos os valores para os quais o `callback` retornou o valor `true` ou [um valor que seja convertido para true](https://developer.mozilla.org/pt-BR/docs/Glossary/Truthy). O `callback` é chamado apenas para índices do array que possuem valores atribuídos; Ele não é invocado para índices que foram excluídos ou para aqueles que não tiveram valor atribuído. Elementos do array que não passaram no teste do `callback` são simplesmente ignorados, e não são incluídos no novo array.

`callback` é invocado com estes três argumentos:

 - o valor do elemento
 - o índice do elemento
 - o objeto do array a ser preenchido

Se o parâmetro `thisArg` for provido para o filter, ele será passado para o `callback` quando invocado, para ser usado como o valor do this. Caso contrário, será passado `undefined` como o valor de `this`. O valor do `this` finalmente observado pela função de `callback` é determinado de acordo com [a regra que define o valor do `this` geralmente visto por uma função](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Operators/this).

`filter()` não altera o `array` a partir da qual foi invocado.

O intervalo de elementos processados pela função `filter()` é definido antes da invocação do primeiro callback. Elementos que forem adicionados ao array depois da invocação do `filter()` não serão visitados pelo `callback`. Se elementos existentes no array forem alterados ou deletados, os valores deles que serão passados para o callback são os que eles tiverem quando o `filter()` visitá-los; Elementos que forem deletados não são visitados.

## Exemplos

### Exemplo: Filtrando todos os valores pequenos

Os exemplos a seguir usam `filter()` para criar um `array` filtrado em que todos os elementos com valores menores que 10 são removidos.

js

```
function isBigEnough(value) {
  return value >= 10;
}
var filtered = [12, 5, 8, 130, 44].filter(isBigEnough);
// filtered is [12, 130, 44]
```

### Exemplo: Filtrando entradas inválidas para JSON

O exemplo a seguir usa `filter()` para criar um `JSON` filtrado com todos seus elementos diferentes de zero, e `id` numérico.

js

```
var arr = [
  { id: 15 },
  { id: -1 },
  { id: 0 },
  { id: 3 },
  { id: 12.2 },
  {},
  { id: null },
  { id: NaN },
  { id: "undefined" },
];

var invalidEntries = 0;

function filterByID(obj) {
  if ("id" in obj && typeof obj.id === "number" && !isNaN(obj.id)) {
    return true;
  } else {
    invalidEntries++;
    return false;
  }
}

var arrByID = arr.filter(filterByID);

console.log("Filtered Array\n", arrByID);
// [{ id: 15 }, { id: -1 }, { id: 0 }, { id: 3 }, { id: 12.2 }]

console.log("Number of Invalid Entries = ", invalidEntries);
// Number of Invalid Entries = 4
```

### Procurando em um array

O exemplo a seguir usa `filter()` para filtrar o conteúdo de um array baseado em um critério de busca

js

```
var fruits = ["apple", "banana", "grapes", "mango", "orange"];

/**
 * Array filters items based on search criteria (query)
 */
function filterItems(query) {
  return fruits.filter(function (el) {
    return el.toLowerCase().indexOf(query.toLowerCase()) > -1;
  });
}

console.log(filterItems("ap")); // ['apple', 'grapes']
console.log(filterItems("an")); // ['banana', 'mango', 'orange']
```

### Implementação ES2015

js

```
const fruits = ["apple", "banana", "grapes", "mango", "orange"];

/**
 * Array filters items based on search criteria (query)
 */
const filterItems = (query) => {
  return fruits.filter(
    (el) => el.toLowerCase().indexOf(query.toLowerCase()) > -1,
  );
};

console.log(filterItems("ap")); // ['apple', 'grapes']
console.log(filterItems("an")); // ['banana', 'mango', 'orange']
```

## Polyfill

`filter()` foi adicionado ao padrão ECMA-262 na 5ª edição; assim como pode não estar presente em todas as implementações do padrão. Você pode trabalhar com isso adicionando o seguinte código no início de seus scripts, permitindo o uso do `filter()` na implementação ECMA-262 que não tem suporte nativo. Esse algoritmo é exatamente aquele especificado na 5ª edição do ECMA-262, assumindo que `fn.call` veja o valor original de [`Function.prototype.call()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Function/call), e que [`Array.prototype.push()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/push) tenha seu valor original.

js

```
if (!Array.prototype.filter) {
  Array.prototype.filter = function (fun /*, thisArg*/) {
    "use strict";

    if (this === void 0 || this === null) {
      throw new TypeError();
    }

    var t = Object(this);
    var len = t.length >>> 0;
    if (typeof fun !== "function") {
      throw new TypeError();
    }

    var res = [];
    var thisArg = arguments.length >= 2 ? arguments[1] : void 0;
    for (var i = 0; i < len; i++) {
      if (i in t) {
        var val = t[i];

        // NOTE: Technically this should Object.defineProperty at
        //       the next index, as push can be affected by
        //       properties on Object.prototype and Array.prototype.
        //       But that method's new, and collisions should be
        //       rare, so use the more-compatible alternative.
        if (fun.call(thisArg, val, i, t)) {
          res.push(val);
        }
      }
    }

    return res;
  };
}
```

## Especificações

| Specification |
| --- |
| [ECMAScript® 2027 Language Specification # sec-array.prototype.filter](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.filter) |

## Compatibilidade com navegadores

## Veja também

 - [`Array.prototype.forEach()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach)
 - [`Array.prototype.every()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/every)
 - [`Array.prototype.some()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/some)
 - [`Array.prototype.reduce()`](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce)

## Help improve MDN

 [Learn how to contribute](https://developer.mozilla.org/pt-BR/docs/MDN/Community/Getting_started)
 This page was last modified on 24 de jun. de 2025 by [MDN contributors](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Reference/Global_Objects/Array/filter/contributors.txt).

 [View this page on GitHub](https://github.com/mdn/translated-content/blob/main/files/pt-br/web/javascript/reference/global_objects/array/filter/index.md?plain=1) • [Report a problem with this content](https://github.com/mdn/translated-content/issues/new?template=page-report-pt-br.yml&mdn-url=https%3A%2F%2Fdeveloper.mozilla.org%2Fpt-BR%2Fdocs%2FWeb%2FJavaScript%2FReference%2FGlobal_Objects%2FArray%2Ffilter&metadata=%3C%21--+Do+not+make+changes+below+this+line+--%3E%0A%3Cdetails%3E%0A%3Csummary%3EPage+report+details%3C%2Fsummary%3E%0A%0A*+Folder%3A+%60pt-br%2Fweb%2Fjavascript%2Freference%2Fglobal_objects%2Farray%2Ffilter%60%0A*+MDN+URL%3A+https%3A%2F%2Fdeveloper.mozilla.org%2Fpt-BR%2Fdocs%2FWeb%2FJavaScript%2FReference%2FGlobal_Objects%2FArray%2Ffilter%0A*+GitHub+URL%3A+https%3A%2F%2Fgithub.com%2Fmdn%2Ftranslated-content%2Fblob%2Fmain%2Ffiles%2Fpt-br%2Fweb%2Fjavascript%2Freference%2Fglobal_objects%2Fa

[... conteudo truncado em 9000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```