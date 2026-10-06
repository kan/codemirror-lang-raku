import {Language, syntaxTree} from "@codemirror/language"
import {EditorState, Extension, Prec} from "@codemirror/state"
import {brackets} from "./tokens"

// An embedded comment, #`( ... ), counts the brackets of its own kind
// in its text. Wrapping a selection that holds a lone `)` in #`( and )
// would end the comment early, and one that holds a lone `(` would let
// it run on. So the brackets of a new comment are picked to fit the
// text that goes in it.

interface Delimiters { open: string, close: string }

function closing(open: string) { return String.fromCharCode(brackets[open.charCodeAt(0)]) }

// The brackets to try, in this order. A bracket that is repeated has
// to be closed as many times.
const pairs: Delimiters[] = ["(", "[", "{", "<", "«", "「", "((", "[[", "{{", "(((", "[[[", "{{{"].map(open => {
  return {open, close: closing(open).repeat(open.length)}
})

// Whether `text` can stand between the delimiters: none of them is
// left open in it, and none closes more than were opened.
function fits(text: string, {open, close}: Delimiters) {
  let depth = 0
  for (let pos = 0; pos < text.length;) {
    if (text.startsWith(close, pos)) {
      if (--depth < 0) return false
      pos += close.length
    } else if (text.startsWith(open, pos)) {
      depth++
      pos += open.length
    } else {
      pos++
    }
  }
  return depth == 0
}

// The delimiters of the comment that a block comment command would
// remove for the range, if there is one: the range is that comment, or
// all of its text, give or take whitespace.
function commentAt(state: EditorState, from: number, to: number): Delimiters | null {
  let start = from + /^\s*/.exec(state.sliceDoc(from, to))![0].length
  let node = syntaxTree(state).resolveInner(start, 1)
  if (node.name != "BlockComment") return null
  let text = state.sliceDoc(node.from, node.to), open = /^#`(.)\1*/.exec(text)
  if (!open || brackets[open[1].charCodeAt(0)] == null) return null
  let close = closing(open[1]).repeat(open[0].length - 2)
  if (!text.endsWith(close)) return null
  let blank = (a: number, b: number) => a >= b || !/\S/.test(state.sliceDoc(a, b))
  let isComment = start == node.from && blank(node.to, to)
  let isContent = blank(node.from + open[0].length, from) && blank(to, node.to - close.length) && to <= node.to
  return isComment || isContent ? {open: open[0], close} : null
}

function blockTokens(state: EditorState, pos: number): Delimiters {
  // The command asks at the start of what it works on, which is a
  // selection range, or the first text of a selected line.
  let range = state.selection.ranges.find(range => range.from == pos)
  let existing = range && commentAt(state, range.from, range.to)
  if (existing) return existing
  // The command that goes by lines wraps up to the end of the line, so
  // the brackets have to fit that text as well.
  let texts = [], line = state.doc.lineAt(pos)
  if (range) {
    texts.push(state.sliceDoc(range.from, range.to))
    line = state.doc.lineAt(range.to)
  } else {
    let onLine = state.selection.ranges.find(range => range.from <= pos && range.from >= line.from)
    if (onLine) line = state.doc.lineAt(onLine.to)
  }
  if (!range || range.to < line.to) texts.push(state.sliceDoc(pos, line.to))
  // The spaces keep a bracket at the edge of the text from joining the delimiters.
  let pair = pairs.find(pair => texts.every(text => fits(" " + text + " ", pair))) || pairs[0]
  return {open: "#`" + pair.open, close: pair.close}
}

/// Language data that gives `language` block comment tokens which fit
/// the selection. It takes precedence over the fixed tokens in the
/// language's own data.
export function embeddedCommentTokens(language: Language): Extension {
  return Prec.high(EditorState.languageData.of((state, pos, side) => {
    if (!language.isActiveAt(state, pos, side)) return []
    // Only worked out when asked for: this is called for every kind of
    // language data, and the line comment commands do not read `block`.
    return [{get commentTokens() {
      return {line: "#", get block() { return blockTokens(state, pos) }}
    }}]
  }))
}
