// check-bugs.mjs — isola o caso 4 (blocos normais com nav/main).
import { extractLinks } from "../src/html-parser.mjs";

const log = (...a) => console.log(...a);
const show = (rotulo, html) => {
  const h = extractLinks(html, "https://exemplo.com/").map((l) => l.href);
  log(`${rotulo}: ${JSON.stringify(h)}`);
};

show("1 nav+main", '<nav><a href="/a">A</a><a href="/b">B</a></nav><main><a href="/c">C</a></main>');
show("2 so nav", '<nav><a href="/a">A</a><a href="/b">B</a></nav>');
show("3 so main", '<main><a href="/c">C</a></main>');
show("4 nav aberto sem fechar", '<nav><a href="/a">A</a><main><a href="/c">C</a></main>');
show("5 div+nav", '<div><a href="/d">D</a></div><nav><a href="/a">A</a></nav>');
show("6 nav dentro de main", '<main><nav><a href="/a">A</a></nav><a href="/c">C</a></main>');
