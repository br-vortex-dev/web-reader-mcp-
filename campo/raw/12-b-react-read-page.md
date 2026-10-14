# caso 12: [B] react-read-page
ferramenta: read_page
argumentos: {"url":"https://react.dev/learn","maxChars":5000}
nota do teste: React docs, leitura normal
status HTTP: 200 | tempo: 344 ms | isError: false
sinais: chars=5272 tabelas=0 cercas=18 truncado=true mojibake=false cjk=false rtl=false links=12

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Quick Start – React\nURL: https://react.dev/learn\nDescricao: The library for web and native user interfaces\nConteudo: 17465 caracteres (exibidos 5119)\n\n[Learn React](https://react.dev/learn)\n\n# Quick Start\n\nWelcome to the React documentation! This page will give you an introduction to 80% of the React concepts that you will use on a daily basis.\n\n### You will learn\n\n - How to create and nest components\n - How to add markup and styles\n - How to display data\n - How to render conditions and lists\n - How to respond to events and update the screen\n - How to share data between components\n\n## Creating and nesting components\n\nReact apps are made out of *components*. A component is a piece of the UI (user interface) that has its own logic and appearance. A component can be as small as a button, or as large as an entire page.\n\nReact components are JavaScript functions that return markup:\n\n```\n\nfunction MyButton() {\n\n\n\n  return (\n\n\n\n    <button>I'm a button</button>\n\n\n\n  );\n\n\n\n}\n```\n\nNow that you’ve declared `MyButton`, you can nest it into another component:\n\n```\n\nexport default function MyApp() {\n\n\n\n  return (\n\n\n\n    <div>\n\n\n\n      <h1>Welcome to my app</h1>\n\n\n\n      <MyButton />\n\n\n\n    </div>\n\n\n\n  );\n\n\n\n}\n```\n\nNotice that `<MyButton />` starts with a capital letter. That’s how you know it’s a React component. React component names must always start with a capital letter, while HTML tags must be lowercase.\n\nHave a look at the result:\n\n[Fork](https://codesandbox.io/api/v1/sandboxes/define?undefined&environment=create-react-app)\n\n```\nfunction MyButton() {\n  return (\n    <button>\n      I'm a button\n    </button>\n  );\n}\n\nexport default function MyApp() {\n  return (\n    <div>\n      <h1>Welcome to my app</h1>\n      <MyButton />\n    </div>\n  );\n}\n```\n\nThe `export default` keywords specify the main component in the file. If you’re not familiar with some piece of JavaScript syntax, [MDN](https://developer.mozilla.org/en-US/docs/web/javascript/reference/statements/export) and [javascript.info](https://javascript.info/import-export) have great references.\n\n## Writing markup with JSX\n\nThe markup syntax you’ve seen above is called *JSX*. It is optional, but most React projects use JSX for its convenience. All of the [tools we recommend for local development](https://react.dev/learn/installation) support JSX out of the box.\n\nJSX is stricter than HTML. You have to close tags like `<br />`. Your component also can’t return multiple JSX tags. You have to wrap them into a shared parent, like a `<div>...</div>` or an empty `<>...</>` wrapper:\n\n```\n\nfunction AboutPage() {\n\n\n\n  return (\n\n\n\n    <>\n\n\n\n      <h1>About</h1>\n\n\n\n      <p>Hello there.<br />How do you do?</p>\n\n\n\n    </>\n\n\n\n  );\n\n\n\n}\n```\n\nIf you have a lot of HTML to port to JSX, you can use an [online converter.](https://transform.tools/html-to-jsx)\n\n## Adding styles\n\nIn React, you specify a CSS class with `className`. It works the same way as the HTML [`class`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/class) attribute:\n\n```\n\n<img className=\"avatar\" />\n```\n\nThen you write the CSS rules for it in a separate CSS file:\n\n```\n\n/* In your CSS */\n\n\n\n.avatar {\n\n\n\n  border-radius: 50%;\n\n\n\n}\n```\n\nReact does not prescribe how you add CSS files. In the simplest case, you’ll add a [`<link>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link) tag to your HTML. If you use a build tool or a framework, consult its documentation to learn how to add a CSS file to your project.\n\n## Displaying data\n\nJSX lets you put markup into JavaScript. Curly braces let you “escape back” into JavaScript so that you can embed some variable from your code and display it to the user. For example, this will display `user.name`:\n\n```\n\nreturn (\n\n\n\n  <h1>\n\n\n\n    {user.name}\n\n\n\n  </h1>\n\n\n\n);\n```\n\nYou can also “escape into JavaScript” from JSX attributes, but you have to use curly braces *instead of* quotes. For example, `className=\"avatar\"` passes the `\"avatar\"` string as the CSS class, but `src={user.imageUrl}` reads the JavaScript `user.imageUrl` variable value, and then passes that value as the `src` attribute:\n\n```\n\nreturn (\n\n\n\n  <img\n\n\n\n    className=\"avatar\"\n\n\n\n    src={user.imageUrl}\n\n\n\n  />\n\n\n\n);\n```\n\nYou can put more complex expressions inside the JSX curly braces too, for example, [string concatenation](https://javascript.info/operators#string-concatenation-with-binary):\n\n[Fork](https://codesandbox.io/api/v1/sandboxes/define?undefined&environment=create-react-app)\n\n```\nconst user = {\n  name: 'Hedy Lamarr',\n  imageUrl: 'https://react.dev/images/docs/scientists/yXOvdOSs.jpg',\n  imageSize: 90,\n};\n\nexport default function Profile() {\n  return (\n    <>\n      <h1>{user.name}</h1>\n      <img\n        className=\"avatar\"\n        src={user.imageUrl}\n        alt={'Photo of ' + user.name}\n        style={{\n          width: user.imageSize,\n          height: user.imageSize\n        }}\n      />\n    </>\n  );\n}\n```\n\nIn the above example, `style={{}}` is not a special syntax, but a regular `{}` object inside the `style={ }` JSX curly braces. You can use the `style` attribute when your styles depend on JavaScript variables.\n\n## Conditional r\n\n[... conteudo truncado em 5000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# Quick Start – React
URL: https://react.dev/learn
Descricao: The library for web and native user interfaces
Conteudo: 17465 caracteres (exibidos 5119)

[Learn React](https://react.dev/learn)

# Quick Start

Welcome to the React documentation! This page will give you an introduction to 80% of the React concepts that you will use on a daily basis.

### You will learn

 - How to create and nest components
 - How to add markup and styles
 - How to display data
 - How to render conditions and lists
 - How to respond to events and update the screen
 - How to share data between components

## Creating and nesting components

React apps are made out of *components*. A component is a piece of the UI (user interface) that has its own logic and appearance. A component can be as small as a button, or as large as an entire page.

React components are JavaScript functions that return markup:

```

function MyButton() {



  return (



    <button>I'm a button</button>



  );



}
```

Now that you’ve declared `MyButton`, you can nest it into another component:

```

export default function MyApp() {



  return (



    <div>



      <h1>Welcome to my app</h1>



      <MyButton />



    </div>



  );



}
```

Notice that `<MyButton />` starts with a capital letter. That’s how you know it’s a React component. React component names must always start with a capital letter, while HTML tags must be lowercase.

Have a look at the result:

[Fork](https://codesandbox.io/api/v1/sandboxes/define?undefined&environment=create-react-app)

```
function MyButton() {
  return (
    <button>
      I'm a button
    </button>
  );
}

export default function MyApp() {
  return (
    <div>
      <h1>Welcome to my app</h1>
      <MyButton />
    </div>
  );
}
```

The `export default` keywords specify the main component in the file. If you’re not familiar with some piece of JavaScript syntax, [MDN](https://developer.mozilla.org/en-US/docs/web/javascript/reference/statements/export) and [javascript.info](https://javascript.info/import-export) have great references.

## Writing markup with JSX

The markup syntax you’ve seen above is called *JSX*. It is optional, but most React projects use JSX for its convenience. All of the [tools we recommend for local development](https://react.dev/learn/installation) support JSX out of the box.

JSX is stricter than HTML. You have to close tags like `<br />`. Your component also can’t return multiple JSX tags. You have to wrap them into a shared parent, like a `<div>...</div>` or an empty `<>...</>` wrapper:

```

function AboutPage() {



  return (



    <>



      <h1>About</h1>



      <p>Hello there.<br />How do you do?</p>



    </>



  );



}
```

If you have a lot of HTML to port to JSX, you can use an [online converter.](https://transform.tools/html-to-jsx)

## Adding styles

In React, you specify a CSS class with `className`. It works the same way as the HTML [`class`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/class) attribute:

```

<img className="avatar" />
```

Then you write the CSS rules for it in a separate CSS file:

```

/* In your CSS */



.avatar {



  border-radius: 50%;



}
```

React does not prescribe how you add CSS files. In the simplest case, you’ll add a [`<link>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link) tag to your HTML. If you use a build tool or a framework, consult its documentation to learn how to add a CSS file to your project.

## Displaying data

JSX lets you put markup into JavaScript. Curly braces let you “escape back” into JavaScript so that you can embed some variable from your code and display it to the user. For example, this will display `user.name`:

```

return (



  <h1>



    {user.name}



  </h1>



);
```

You can also “escape into JavaScript” from JSX attributes, but you have to use curly braces *instead of* quotes. For example, `className="avatar"` passes the `"avatar"` string as the CSS class, but `src={user.imageUrl}` reads the JavaScript `user.imageUrl` variable value, and then passes that value as the `src` attribute:

```

return (



  <img



    className="avatar"



    src={user.imageUrl}



  />



);
```

You can put more complex expressions inside the JSX curly braces too, for example, [string concatenation](https://javascript.info/operators#string-concatenation-with-binary):

[Fork](https://codesandbox.io/api/v1/sandboxes/define?undefined&environment=create-react-app)

```
const user = {
  name: 'Hedy Lamarr',
  imageUrl: 'https://react.dev/images/docs/scientists/yXOvdOSs.jpg',
  imageSize: 90,
};

export default function Profile() {
  return (
    <>
      <h1>{user.name}</h1>
      <img
        className="avatar"
        src={user.imageUrl}
        alt={'Photo of ' + user.name}
        style={{
          width: user.imageSize,
          height: user.imageSize
        }}
      />
    </>
  );
}
```

In the above example, `style={{}}` is not a special syntax, but a regular `{}` object inside the `style={ }` JSX curly braces. You can use the `style` attribute when your styles depend on JavaScript variables.

## Conditional r

[... conteudo truncado em 5000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```