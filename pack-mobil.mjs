/**
 * Build familie-budsjett-mobil.html (single file) from modular sources.
 * Sync modules are inlined; supabase-config placeholders included.
 */
import fs from "fs";

const css = fs.readFileSync("styles.css", "utf8");
const config = fs.readFileSync("supabase-config.js", "utf8");
const calc = fs.readFileSync("calc-core.js", "utf8");
const sync = fs.readFileSync("sync-core.js", "utf8");
const cloud = fs.readFileSync("cloud-sync.js", "utf8");
let app = fs.readFileSync("app.js", "utf8");
// Remove XHR loader (files are inlined)
app = app.replace(/\/\* === familie sync loader === \*\/[\s\S]*?\/\* === end sync loader === \*\/\n*/, "");

let html = fs.readFileSync("index.html", "utf8");
html = html.replace(/<link rel="stylesheet" href="styles\.css"\s*\/>/, `<style>\n${css}\n</style>`);
html = html.replace(
  /<script src="calc-core\.js"><\/script>\s*<script src="app\.js"><\/script>/,
  `<script>\n${config}\n</script>\n<script>\n${calc}\n</script>\n<script>\n${sync}\n</script>\n<script>\n${cloud}\n</script>\n<script>\n${app}\n</script>`
);

fs.writeFileSync("familie-budsjett-mobil.html", html);
console.log("Wrote familie-budsjett-mobil.html", fs.statSync("familie-budsjett-mobil.html").size);
