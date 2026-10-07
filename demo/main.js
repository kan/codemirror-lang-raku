// A page to try the language support in: an editor, and the syntax
// tree of its content. It loads the sources, so a change to the grammar
// shows up on reload. Start it with `npm run dev`.
import {EditorView, basicSetup} from "codemirror"
import {syntaxTree} from "@codemirror/language"
import {raku} from "../src/index.ts"

// The test fixtures, by file name.
const samples = import.meta.glob("../test/fixtures/*.raku", {query: "?raw", import: "default", eager: true})

const treeView = document.querySelector("#tree")
const status = document.querySelector("#status")
const select = document.querySelector("#sample")
// How much of a token's text the tree shows.
const maxText = 40

// Shows the tree one node per line, indented by depth, leaving out the
// nodes of punctuation.
function showTree(state) {
  let tree = syntaxTree(state), errors = 0, lines = document.createDocumentFragment()
  // The line of each open node, or null for a node that is not shown.
  let open = []
  tree.iterate({
    enter(node) {
      let line = null
      if (/^\w+$/.test(node.name) || node.type.isError) {
        line = document.createElement("div")
        line.textContent = "  ".repeat(open.length) + (node.type.isError ? "⚠" : node.name)
        if (node.type.isError) {
          line.className = "error"
          errors++
        }
        lines.append(line)
      }
      open.push(line)
    },
    leave(node) {
      let line = open.pop()
      // A node whose line is still the last one has no children: show its text.
      if (line && line == lines.lastChild && node.to > node.from) {
        let cut = node.to - node.from > maxText
        let text = state.sliceDoc(node.from, cut ? node.from + maxText : node.to)
        line.textContent += " " + JSON.stringify(text) + (cut ? "…" : "")
      }
    }
  })
  treeView.replaceChildren(lines)
  // The parser works through a long document in the background.
  let parsed = tree.length < state.doc.length ? `, parsed up to ${tree.length} of ${state.doc.length}` : ""
  status.textContent = `${errors} error node${errors == 1 ? "" : "s"}${parsed}`
}

// Draws the tree once per frame at most. A long document changes its
// tree many times in a row while the parser works through it.
let scheduled = false
function scheduleTree() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    showTree(view.state)
  })
}

const view = new EditorView({
  extensions: [
    basicSetup,
    raku(),
    EditorView.updateListener.of(update => {
      if (syntaxTree(update.startState) != syntaxTree(update.state)) scheduleTree()
    })
  ],
  parent: document.querySelector("#editor")
})

function load(path) {
  view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: samples[path]}, selection: {anchor: 0}})
}

// The samples that show what a version added come first, the latest
// version before the others.
const isNew = path => /\/new-in-/.test(path)
const paths = Object.keys(samples).sort((a, b) => {
  return isNew(b) - isNew(a) || (isNew(a) ? b.localeCompare(a, "en", {numeric: true}) : 0)
})
for (let path of paths) select.append(new Option(path.replace(/^.*\//, ""), path))
select.addEventListener("change", () => load(select.value))
load(select.value)
