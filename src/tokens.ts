import {ExternalTokenizer, InputStream} from "@lezer/lr"
import {
  BlockComment, MethodName, Version, methodDot, declaredName, declaredMethodName, smiley, stringContent
} from "./syntax.grammar.terms"

const enum Ch {
  Bang = 33,
  DoubleQuote = 34,
  Hash = 35,
  Dollar = 36,
  Amp = 38,
  Apostrophe = 39,
  Star = 42,
  Plus = 43,
  Hyphen = 45,
  Dot = 46,
  _0 = 48,
  _9 = 57,
  Colon = 58,
  Question = 63,
  A = 65,
  D = 68,
  U = 85,
  Z = 90,
  Backslash = 92,
  Caret = 94,
  Underscore = 95,
  Backtick = 96,
  a = 97,
  v = 118,
  z = 122,
  BraceOpen = 123,
}

// Opening bracket -> closing bracket, for the delimiters of embedded
// comments. Raku accepts any Unicode bracket pair; this lists the ones
// that are likely to be typed.
const brackets: {[open: number]: number} = {}
for (let pair of ["()", "[]", "{}", "<>", "«»", "「」", "『』", "（）", "［］", "｛｝", "【】", "〈〉", "《》", "〔〕"])
  brackets[pair.charCodeAt(0)] = pair.charCodeAt(1)

function isAsciiLetter(ch: number) { return ch >= Ch.a && ch <= Ch.z || ch >= Ch.A && ch <= Ch.Z }

function isDigit(ch: number) { return ch >= Ch._0 && ch <= Ch._9 }

// Keep these ranges in sync with identifierStart in syntax.grammar. The
// input is read in UTF-16 code units, so the astral planes show up here
// as the surrogate range.
function isIdentifierStart(ch: number) {
  return isAsciiLetter(ch) || ch == Ch.Underscore ||
    ch == 0xaa || ch == 0xb5 || ch == 0xba ||
    ch >= 0xc0 && ch <= 0x1fff && ch != 0xd7 && ch != 0xf7 && ch != 0x1680 ||
    ch >= 0x2c00 && ch <= 0x2fef ||
    ch >= 0x3040 && ch <= 0xdfff ||
    ch >= 0xf900 && ch <= 0xfdff ||
    ch >= 0xff21 && ch <= 0xff3a || ch >= 0xff41 && ch <= 0xff5a || ch >= 0xff66 && ch <= 0xffdc
}

// Whether the character at offset `pos` would continue a name that ends
// right before it.
function continuesName(input: InputStream, pos: number) {
  let ch = input.peek(pos)
  return isIdentifierStart(ch) || isDigit(ch) ||
    (ch == Ch.Hyphen || ch == Ch.Apostrophe) && isIdentifierStart(input.peek(pos + 1))
}

// The offset after the (possibly `::`-qualified) name that starts at
// offset `pos`, or -1 when there is no name there.
function nameEnd(input: InputStream, pos: number) {
  if (!isIdentifierStart(input.peek(pos))) return -1
  for (pos++;;) {
    let ch = input.peek(pos)
    if (continuesName(input, pos)) pos++
    else if (ch == Ch.Colon && input.peek(pos + 1) == Ch.Colon && isIdentifierStart(input.peek(pos + 2))) pos += 3
    else return pos
  }
}

function repeats(input: InputStream, ch: number, count: number) {
  for (let i = 0; i < count; i++) if (input.peek(i) != ch) return false
  return true
}

// #`( ... ), with any bracket pair. A repeated opening bracket, as in
// #`(( ... )), needs the same number of closing ones. Brackets of the
// same kind nest. An unclosed comment runs to the end of the input.
export const blockComment = new ExternalTokenizer(input => {
  if (input.next != Ch.Hash || input.peek(1) != Ch.Backtick) return
  let open = input.peek(2), close = brackets[open]
  if (close == null) return
  let count = 1
  while (input.peek(2 + count) == open) count++
  input.advance(2 + count)
  for (let depth = 1; input.next >= 0;) {
    if (input.next != close && input.next != open) {
      input.advance()
    } else if (repeats(input, close, count)) {
      input.advance(count)
      if (--depth == 0) break
    } else if (repeats(input, open, count)) {
      input.advance(count)
      depth++
    } else {
      input.advance()
    }
  }
  input.acceptToken(BlockComment)
})

// The dot of a method call, with its optional `?`, `+`, `*`, `^` or `&`
// modifier. It is only produced when a name follows.
export const methodDotToken = new ExternalTokenizer(input => {
  if (input.next != Ch.Dot) return
  let size = 1, next = input.peek(1)
  if (next == Ch.Question || next == Ch.Plus || next == Ch.Star || next == Ch.Caret || next == Ch.Amp)
    next = input.peek(++size)
  if (isIdentifierStart(next)) input.acceptToken(methodDot, size)
})

// A name after a method dot or a declarator. The grammar's keywords are
// specialized identifiers, and specialization does not look at the
// parse state, so these positions get tokens of their own.
export const nameToken = new ExternalTokenizer((input, stack) => {
  // Only a method declaration takes a mark: `method !private`, `method ^meta`.
  let mark = input.next == Ch.Bang || input.next == Ch.Caret ? 1 : 0
  let end = nameEnd(input, mark)
  if (end < 0) return
  if (mark) {
    if (stack.canShift(declaredMethodName)) input.acceptToken(declaredMethodName, end)
    return
  }
  for (let term of [MethodName, declaredName, declaredMethodName])
    if (stack.canShift(term)) return input.acceptToken(term, end)
})

// The type smiley in Int:D, Str:U and Any:_. It has to touch the type
// name, and must not be the start of a longer pair such as :Default.
export const smileyToken = new ExternalTokenizer((input, stack) => {
  if (input.next != Ch.Colon || !stack.canShift(smiley) || !continuesName(input, -1)) return
  let kind = input.peek(1)
  if ((kind == Ch.D || kind == Ch.U || kind == Ch.Underscore) && !continuesName(input, 2))
    input.acceptToken(smiley, 2)
})

// v6, v6.d, v1.2.3, v1.2+, v1.*. A name such as v8-engine is not a version.
export const versionToken = new ExternalTokenizer((input, stack) => {
  if (input.next != Ch.v || !isDigit(input.peek(1)) || !stack.canShift(Version)) return
  let pos = 2
  for (;;) {
    while (isDigit(input.peek(pos))) pos++
    if (input.peek(pos) != Ch.Dot) break
    let part = input.peek(pos + 1)
    if (part == Ch.Star) { pos += 2; break }
    if (isDigit(part)) pos++
    else if (isAsciiLetter(part)) { pos += 2; while (isAsciiLetter(input.peek(pos))) pos++ }
    else break
  }
  if (input.peek(pos) == Ch.Plus) pos++
  else if (continuesName(input, pos)) return
  input.acceptToken(Version, pos)
})

// The literal text inside a double-quoted string, up to the next escape,
// closing quote, `{` or `$`. Whether a `$` starts a variable is left to
// the grammar's variable tokens.
export const stringContentToken = new ExternalTokenizer(input => {
  let start = input.pos
  for (;;) {
    let next = input.next
    if (next < 0 || next == Ch.DoubleQuote || next == Ch.Backslash || next == Ch.BraceOpen ||
        next == Ch.Dollar) break
    input.advance()
  }
  if (input.pos > start) input.acceptToken(stringContent)
})
