import {lezer} from "@lezer/generator/rollup"

// The term ids that tokens.ts imports come from a virtual module, which
// Vite does not tie to the grammar file. Without this, a change to the
// grammar reloads the parser and leaves the tokenizers with the old ids.
const reloadOnGrammarChange = {
  name: "reload-on-grammar-change",
  handleHotUpdate({file, server}) {
    if (!file.endsWith(".grammar")) return
    server.moduleGraph.invalidateAll()
    server.ws.send({type: "full-reload"})
    return []
  }
}

export default {
  // The built page is served from a subdirectory on GitHub Pages.
  base: "./",
  // Builds the parser from src/syntax.grammar, as rollup.config.js does.
  plugins: [lezer(), reloadOnGrammarChange],
  // The samples are read from test/fixtures, outside this directory.
  server: {fs: {allow: [".."]}},
  build: {outDir: "../dist-demo", emptyOutDir: true}
}
