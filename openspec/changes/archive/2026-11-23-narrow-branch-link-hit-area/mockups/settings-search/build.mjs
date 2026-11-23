// Inline tokens.css + mockup.css + app.js into a single self-contained index.html.
import { readFileSync, writeFileSync } from "node:fs";
const r = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
let html = r("./src.html")
  .replace('<link rel="stylesheet" href="tokens.css" />', () => `<style>\n${r("./tokens.css")}\n</style>`)
  .replace('<link rel="stylesheet" href="mockup.css" />', () => `<style>\n${r("./mockup.css")}\n</style>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${r("./app.js")}\n</script>`);
writeFileSync(new URL("./index.html", import.meta.url), html);
console.log("index.html", html.length, "bytes");
