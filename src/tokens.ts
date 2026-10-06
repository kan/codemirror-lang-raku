import {ContextTracker, ExternalTokenizer, InputStream, Stack} from "@lezer/lr"
import {Tree, TreeBuffer} from "@lezer/common"
import {
  BlockComment, DocComment, LineComment, Pod, Heredoc,
  MethodName, Version, Regex, Operator, Number as NumberTerm, radixNumber, PairKey,
  VariableName, AttributeName, SpecialVariable, operatorVariable,
  Identifier, TypeName, StringLiteral, Interpolation, self, True, False, Nil,
  PackageName, RoutineName, methodRoutineName, RegexName, EnumName, SubsetName, ConstantName,
  methodDot, declaredName, declaredMethodName, smiley, fatArrowKey, wordOperator,
  rawString, quoteStart, quoteContent, quoteNestOpen, quoteNestClose, quoteEnd, regexBody
} from "./syntax.grammar.terms"

const enum Ch {
  Tab = 9,
  Newline = 10,
  Return = 13,
  Space = 32,
  Bang = 33,
  DoubleQuote = 34,
  Hash = 35,
  Dollar = 36,
  Percent = 37,
  Amp = 38,
  Apostrophe = 39,
  ParenOpen = 40,
  ParenClose = 41,
  Star = 42,
  Plus = 43,
  Comma = 44,
  Hyphen = 45,
  Dot = 46,
  Slash = 47,
  _0 = 48,
  _9 = 57,
  Colon = 58,
  Semicolon = 59,
  Less = 60,
  Equals = 61,
  Greater = 62,
  Question = 63,
  At = 64,
  A = 65,
  D = 68,
  Q = 81,
  R = 82,
  U = 85,
  X = 88,
  Z = 90,
  BracketOpen = 91,
  Backslash = 92,
  BracketClose = 93,
  Caret = 94,
  Underscore = 95,
  Backtick = 96,
  a = 97,
  q = 113,
  v = 118,
  z = 122,
  BraceOpen = 123,
  Pipe = 124,
  BraceClose = 125,
  Tilde = 126,
  GuillemetOpen = 0xab,
  GuillemetClose = 0xbb,
}

// Opening bracket -> closing bracket, for the delimiters of quotes and
// embedded comments. Raku accepts any Unicode bracket pair; this lists
// the ones that are likely to be typed.
export const brackets: {[open: number]: number} = {}
for (let pair of ["()", "[]", "{}", "<>", "«»", "「」", "『』", "（）", "［］", "｛｝", "【】", "〈〉", "《》", "〔〕"])
  brackets[pair.charCodeAt(0)] = pair.charCodeAt(1)

function isAsciiLetter(ch: number) { return ch >= Ch.a && ch <= Ch.z || ch >= Ch.A && ch <= Ch.Z }

function isDigit(ch: number) { return ch >= Ch._0 && ch <= Ch._9 }

// The characters of the grammar's whitespace token.
function isSpace(ch: number) {
  return ch == Ch.Space || ch >= Ch.Tab && ch <= Ch.Return || ch == 0x85 || ch == 0xa0 || ch == 0x1680 ||
    ch >= 0x2000 && ch <= 0x200a || ch == 0x2028 || ch == 0x2029 || ch == 0x202f || ch == 0x205f || ch == 0x3000
}

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

// The characters that Operator runs are made of in syntax.grammar,
// leaving out the non-ASCII ones.
function isOperatorChar(ch: number) {
  return ch == Ch.Plus || ch == Ch.Hyphen || ch == Ch.Star || ch == Ch.Slash || ch == Ch.Tilde ||
    ch == Ch.Caret || ch == Ch.Pipe || ch == Ch.Less || ch == Ch.Greater || ch == Ch.Equals ||
    ch == Ch.Bang || ch == Ch.Question || ch == Ch.Percent || ch == Ch.Amp
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

function repeats(input: InputStream, pos: number, ch: number, count: number) {
  for (let i = 0; i < count; i++) if (input.peek(pos + i) != ch) return false
  return true
}

function word(input: InputStream, from: number, to: number) {
  let result = ""
  for (let i = from; i < to; i++) result += String.fromCharCode(input.peek(i))
  return result
}

// ---- Context ----
//
// The grammar does not parse expressions, so whether `/` divides or
// starts a regex, and whether `<` compares or starts a word list, is
// decided from the token before it.

const enum Mode {
  // A term is expected: at the start, after an operator, a keyword, an
  // opening bracket or a separator.
  Term,
  // The last token ended a term.
  AfterTerm,
  // The last token was a bare name, which can be a term, a call that
  // takes arguments, or a type in front of what it declares. Spacing
  // decides: `say /x/` and `Int %h` against `pi / 2`.
  AfterName,
  // The last token was a closing brace. A line break after it ends the
  // statement.
  AfterBlock,
}

// The things that a quote can interpolate, as bits. `"…"` and qq take
// all of them, and adverbs switch them one by one: q:c, qq:!s
const enum Interpolate {
  Closure = 1,
  Scalar = 2,
  Array = 4,
  Hash = 8,
  Function = 16,
  Backslash = 32,
  All = 63,
}

// A quote that is being read piece by piece because it interpolates.
class Quote {
  hash: number
  constructor(readonly parent: Quote | null,
              readonly open: number,
              readonly close: number,
              readonly count: number,
              // How many nested opening delimiters are unclosed.
              readonly depth: number,
              readonly interpolates: number,
              // Whether a backslash that does not start an escape still
              // takes the delimiter after it out of play: q:c[a \] b]
              readonly escapes: boolean) {
    let hash = parent ? parent.hash : 7
    for (let part of [open, count, depth, interpolates, escapes ? 1 : 0]) hash = (hash * 31 + part) | 0
    this.hash = hash
  }
  withDepth(depth: number) {
    return new Quote(this.parent, this.open, this.close, this.count, depth, this.interpolates, this.escapes)
  }
}

const noHeredocs: readonly string[] = []

class Context {
  // An old node is only reused where this is the same as where it was
  // made. The mode is left out: it changes with every token, which
  // would rule out nearly all reuse, and `reuse` works it out again.
  readonly hash: number
  constructor(readonly mode: Mode,
              readonly quote: Quote | null,
              // The terminators of the heredocs that were opened on the
              // current line, whose text starts on the next one.
              readonly heredocs: readonly string[],
              hash = -1) {
    if (hash < 0) {
      hash = quote ? quote.hash : 0
      for (let terminator of heredocs) {
        hash = (hash * 31 + 17) | 0
        for (let i = 0; i < terminator.length; i++) hash = (hash * 31 + terminator.charCodeAt(i)) | 0
      }
      // Negative values stand for "not worked out yet".
      hash &= 0x7fffffff
    }
    this.hash = hash
  }
  withMode(mode: Mode) {
    return mode == this.mode ? this : new Context(mode, this.quote, this.heredocs, this.hash)
  }
  withHeredocs(heredocs: readonly string[]) {
    return heredocs == this.heredocs ? this : new Context(this.mode, this.quote, heredocs)
  }
}

// The mode after a token or a node, for those where the term settles
// it. Shifting a token and reusing a node both look here, so that they
// agree.
const termModes = new Map<number, Mode>()
for (let term of [VariableName, AttributeName, SpecialVariable, operatorVariable, NumberTerm, radixNumber, Version, MethodName,
                  PairKey, rawString, quoteEnd, StringLiteral, Regex, regexBody, self, True, False, Nil])
  termModes.set(term, Mode.AfterTerm)
for (let term of [Identifier, TypeName, smiley, declaredName, declaredMethodName, PackageName, RoutineName,
                  methodRoutineName, RegexName, EnumName, SubsetName, ConstantName])
  termModes.set(term, Mode.AfterName)
// The `}` of "{...}" in a string does not take a subscript.
for (let term of [quoteContent, Interpolation]) termModes.set(term, Mode.Term)

// The mode after an operator, from its first three characters. `after`
// is the mode before it.
function modeAfterOperator(first: number, second: number, third: number, after: Mode) {
  // A lone `*` is as often the whatever star as a multiplication.
  if (first == Ch.Star && !isOperatorChar(second)) return Mode.AfterName
  // Postfix increment and decrement leave the term complete.
  if ((first == Ch.Plus || first == Ch.Hyphen) && second == first && !isOperatorChar(third) &&
      (after == Mode.AfterTerm || after == Mode.AfterBlock)) return Mode.AfterTerm
  return Mode.Term
}

// The mode after a token that the terms file has no name for, from its
// first character. Keywords and identifiers come through here alike;
// an identifier gets its mode when the Identifier node is reduced.
function modeAfterChar(first: number) {
  if (first == Ch.ParenClose || first == Ch.BracketClose || first == Ch.Dollar || first == Ch.At) return Mode.AfterTerm
  // A capitalized name, taken to be a type.
  if (first >= Ch.A && first <= Ch.Z) return Mode.AfterName
  return first == Ch.BraceClose ? Mode.AfterBlock : Mode.Term
}

// The mode after the token of the given term at the input's position.
// `before` is the mode before it.
function modeAfter(term: number, input: InputStream, offset: number, before: Mode) {
  let mode = termModes.get(term)
  if (mode != null) return mode
  let first = input.peek(offset)
  if (term == Operator || term == wordOperator)
    return modeAfterOperator(first, input.peek(offset + 1), input.peek(offset + 2), before)
  return modeAfterChar(first)
}

const skippedTerms = new Set([LineComment, DocComment, BlockComment, Pod, Heredoc])

// The terminator that the quote at offset `at` names, when that quote
// opens a heredoc: END for q:to/END/
function heredocTerminator(input: InputStream, at: number) {
  let first = input.peek(at)
  if (first != Ch.q && first != Ch.Q) return null
  let opening = readOpening(input, at)
  if (!opening || !opening.heredoc) return null
  let end = opening.start
  while (input.peek(end) != opening.close && input.peek(end) != Ch.Newline && input.peek(end) >= 0) end++
  // An empty one, as in the `q:to//` of a quote that is being typed,
  // would end the heredoc at the next blank line.
  return word(input, opening.start, end).trim() || null
}

// `heredocs`, with the heredoc that the quote at offset `at` opens, if
// it opens one.
function withHeredocAt(heredocs: readonly string[], input: InputStream, at: number) {
  let terminator = heredocTerminator(input, at)
  return terminator == null ? heredocs : heredocs.concat(terminator)
}

function hasNewline(input: InputStream, from: number, to: number) {
  for (let i = from; i < to; i++) if (input.peek(i) == Ch.Newline) return true
  return false
}

// The heredocs that are open after a reused node, of which the input is
// at the start. As when tokens are shifted, a line break between tokens
// and the text of a heredoc close the ones before them.
function heredocsAfter(node: Tree, input: InputStream, before: readonly string[]) {
  // Most reused nodes are single tokens.
  if (!node.children.length && node.type.id != StringLiteral && node.type.id != Heredoc) return before
  let cursor = node.cursor(), found: {pos: number, terminator: string}[] = [], closedAt = -1
  // Goes over the node at the cursor from its end, and tells whether
  // the heredocs before some point in it are closed.
  function scan(): boolean {
    let type = cursor.type.id, {from, to} = cursor
    if (type == Heredoc) { closedAt = to; return true }
    if (type == StringLiteral) {
      let terminator = heredocTerminator(input, from)
      if (terminator != null) found.push({pos: from, terminator})
    }
    if (!cursor.lastChild()) return false
    // Between the pieces of a string lies its text, not whitespace.
    let gaps = type != StringLiteral
    for (let gapEnd = to;;) {
      if (gaps && hasNewline(input, cursor.to, gapEnd)) { closedAt = gapEnd; break }
      if (scan()) break
      gapEnd = cursor.from
      if (!cursor.prevSibling()) {
        if (gaps && hasNewline(input, from, gapEnd)) closedAt = gapEnd
        break
      }
    }
    cursor.parent()
    return closedAt >= 0
  }
  scan()
  if (!found.length && closedAt < 0) return before
  let after = found.filter(heredoc => heredoc.pos >= closedAt).sort((a, b) => a.pos - b.pos).map(heredoc => heredoc.terminator)
  return closedAt < 0 ? before.concat(after) : after.length ? after : noHeredocs
}

export const trackContext = new ContextTracker<Context>({
  start: new Context(Mode.Term, null, noHeredocs),
  shift(context, term, _stack, input) {
    if (term == Heredoc) return context.withHeredocs(noHeredocs)
    if (skippedTerms.has(term)) return context
    switch (term) {
      case quoteStart: {
        let opening = readOpening(input)
        if (!opening) return context
        let quote = new Quote(context.quote, opening.open, opening.close, opening.count, 0,
                              opening.interpolates, opening.escapes)
        return new Context(Mode.Term, quote, withHeredocAt(context.heredocs, input, 0))
      }
      case quoteNestOpen: case quoteNestClose: {
        let quote = context.quote
        if (!quote) return context
        let depth = quote.depth + (term == quoteNestOpen ? 1 : -1)
        return new Context(Mode.Term, quote.withDepth(depth), context.heredocs)
      }
      case quoteEnd:
        return new Context(Mode.AfterTerm, context.quote && context.quote.parent, context.heredocs)
    }
    // The whitespace token has no term to go by. It is the only token
    // that starts with a space. A line break in it leaves the heredocs
    // that found no terminator behind.
    if (!termModes.has(term) && isSpace(input.next)) {
      if (!context.heredocs.length) return context
      for (let pos = 0; isSpace(input.peek(pos)); pos++)
        if (input.peek(pos) == Ch.Newline) return context.withHeredocs(noHeredocs)
      return context
    }
    if (term == rawString) context = context.withHeredocs(withHeredocAt(context.heredocs, input, 0))
    return context.withMode(modeAfter(term, input, 0, context.mode))
  },
  reduce(context, term) {
    return term == Identifier || term == Interpolation ? context.withMode(termModes.get(term)!) : context
  },
  reuse(context, node, _stack, input) {
    // Walk down to the last token, keeping its offset from the node's
    // start, where the input is positioned. Stop at a node that settles
    // the mode by itself.
    let last: Tree | TreeBuffer = node, offset = 0
    while (last instanceof Tree && last.children.length && !termModes.has(last.type.id)) {
      offset += last.positions[last.children.length - 1]
      last = last.children[last.children.length - 1]
    }
    let term
    if (last instanceof Tree) {
      term = last.type.id
    } else {
      // A buffer holds its nodes in pre-order, as type, start, end and
      // the index after the node's last descendant.
      let {buffer} = last, index = 0
      for (let from = 0, to = buffer.length;;) {
        index = from
        while (buffer[index + 3] < to) index = buffer[index + 3]
        from = index + 4
        to = buffer[index + 3]
        if (from == to || termModes.has(buffer[index])) break
      }
      term = buffer[index]
      offset += buffer[index + 1]
    }
    context = context.withHeredocs(heredocsAfter(node, input, context.heredocs))
    if (skippedTerms.has(term)) return context
    // What comes before a trailing `++` in a reused node is a term.
    return context.withMode(modeAfter(term, input, offset, Mode.AfterTerm))
  },
  hash: context => context.hash
})

function context(stack: Stack): Context { return stack.context }

// Whether a token of `size` characters at the current position is where
// a term starts, as opposed to an infix operator.
function inTermPosition(input: InputStream, mode: Mode, size: number) {
  if (mode == Mode.Term) return true
  if (mode == Mode.AfterTerm) return false
  if (mode == Mode.AfterName) return isSpace(input.peek(-1)) && !isSpace(input.peek(size))
  return atLineStart(input)
}

// ---- Comments and Pod ----

// #`( ... ), with any bracket pair. A repeated opening bracket, as in
// #`(( ... )), needs the same number of closing ones. Brackets of the
// same kind nest. An unclosed comment runs to the end of the input.
export const blockComment = new ExternalTokenizer(input => {
  if (input.next != Ch.Hash || input.peek(1) != Ch.Backtick) return
  let open = input.peek(2), close = brackets[open]
  if (close == null) return
  let count = 1
  while (input.peek(2 + count) == open) count++
  let end = rawEnd(input, 2 + count, {open, close, count, escapes: false})
  if (end < 0) skipToEnd(input)
  else input.advance(end)
  input.acceptToken(BlockComment)
})

function isBlank(ch: number) { return ch == Ch.Space || ch == Ch.Tab || ch == Ch.Return }

// The offset of the first character at or after `pos` that is not a blank.
function blanksEnd(input: InputStream, pos: number) {
  while (isBlank(input.peek(pos))) pos++
  return pos
}

// Whether only blanks separate the current position from the start of its line.
function atLineStart(input: InputStream) {
  for (let i = -1;; i--) {
    let ch = input.peek(i)
    if (ch == Ch.Newline || ch < 0) return true
    if (!isBlank(ch)) return false
  }
}

// Whether only blanks separate offset `pos` from the end of its line.
function isLineEnd(input: InputStream, pos: number) {
  let ch = input.peek(blanksEnd(input, pos))
  return ch == Ch.Newline || ch < 0
}

function skipLine(input: InputStream) {
  while (input.next >= 0 && input.next != Ch.Newline) input.advance()
}

function skipToEnd(input: InputStream) {
  while (input.next >= 0) input.advance()
}

function skipBlanks(input: InputStream) {
  input.advance(blanksEnd(input, 0))
}

// Skips blanks, and tells whether the rest of the line starts with `text`.
function lineStartsWith(input: InputStream, text: string) {
  skipBlanks(input)
  for (let i = 0; i < text.length; i++) if (input.peek(i) != text.charCodeAt(i)) return false
  return !continuesName(input, text.length)
}

const podDirective = /^(begin|for|end|finish|head\d*|item\d*|para|code|input|output|defn|comment|table|pod|rakudoc|config|alias|nested|data|[A-Z]{2,})$/

// A Pod block, from its `=directive` at the start of a line.
//   =begin name ... =end name   delimited, can hold blocks of other names
//   =finish                     the rest of the file
//   =for name, =head1, ...      up to the next blank line
export const podToken = new ExternalTokenizer(input => {
  if (input.next != Ch.Equals || !isAsciiLetter(input.peek(1)) || !atLineStart(input)) return
  let end = 1
  while (isAsciiLetter(input.peek(end)) || isDigit(input.peek(end))) end++
  let directive = word(input, 1, end)
  if (!podDirective.test(directive) || continuesName(input, end)) return
  // A semantic block such as =TITLE has to start in the first column.
  // An indented `=FOO + 1` continues an assignment.
  if (directive.charCodeAt(0) <= Ch.Z && input.peek(-1) >= 0 && input.peek(-1) != Ch.Newline) return
  input.advance(end)
  if (directive == "finish") {
    skipToEnd(input)
  } else if (directive == "begin") {
    skipBlanks(input)
    let name = word(input, 0, Math.max(0, nameEnd(input, 0)))
    for (;;) {
      skipLine(input)
      if (input.next < 0) break
      input.advance()
      if (!lineStartsWith(input, "=end")) continue
      input.advance(4)
      if (lineStartsWith(input, name)) { skipLine(input); break }
    }
  } else {
    for (;;) {
      skipLine(input)
      if (input.next < 0) break
      // Stop before a blank line or another directive.
      let i = blanksEnd(input, 1), ch = input.peek(i)
      if (ch == Ch.Newline || ch < 0 || ch == Ch.Equals && isAsciiLetter(input.peek(i + 1))) break
      input.advance()
    }
  }
  input.acceptToken(Pod)
})

// ---- Quotes ----

interface Opening {
  // The delimiters, and how many times they are repeated: 2 for q<<...>>.
  open: number, close: number, count: number
  // The offset of the first character after the opening delimiter.
  start: number
  kind: "raw" | "interpolating" | "regex" | "substitution"
  // What it interpolates, as Interpolate bits. Zero for the "raw" kind.
  interpolates: number
  // Whether a backslash escapes the next character.
  escapes: boolean
  // Whether the adverbs make it a heredoc: q:to/END/
  heredoc?: boolean
}

const quoteWords: {[name: string]: Opening["kind"]} = {
  q: "raw", Q: "raw", qw: "raw", qww: "raw", qx: "raw", Qw: "raw", Qww: "raw", Qx: "raw",
  qq: "interpolating", qqw: "interpolating", qqww: "interpolating", qqx: "interpolating",
  rx: "regex", m: "regex", ms: "regex",
  s: "substitution", ss: "substitution", S: "substitution", tr: "substitution", TR: "substitution"
}

// The kinds of interpolation that the adverbs of a quote switch.
const interpolationAdverbs = new Map<string, number>([
  ["c", Interpolate.Closure], ["closure", Interpolate.Closure],
  ["s", Interpolate.Scalar], ["scalar", Interpolate.Scalar],
  ["a", Interpolate.Array], ["array", Interpolate.Array],
  ["h", Interpolate.Hash], ["hash", Interpolate.Hash],
  ["f", Interpolate.Function], ["function", Interpolate.Function],
  ["b", Interpolate.Backslash], ["backslash", Interpolate.Backslash],
  ["qq", Interpolate.All], ["double", Interpolate.All]
])

// The opening of a quote that starts with a quote character at offset `at`.
function quoteCharOpening(open: number, close: number, at: number, interpolates: number, escapes = true): Opening {
  return {open, close, count: 1, start: at + 1, kind: interpolates ? "interpolating" : "raw", interpolates, escapes}
}

// The delimiters, other than brackets, that are accepted after a quote word.
function isQuoteDelimiter(ch: number) {
  return ch == Ch.Slash || ch == Ch.Bang || ch == Ch.Pipe || ch == Ch.Tilde || ch == Ch.Caret ||
    ch == Ch.Percent || ch == Ch.At || ch == Ch.DoubleQuote || ch == Ch.Apostrophe
}

// Reads the start of a quote at offset `at`: a quote character, or a
// quote word (q, qq, m, s, ...) with its adverbs and its delimiter.
// The offsets in the result count from the current position.
function readOpening(input: InputStream, at = 0): Opening | null {
  let next = input.peek(at)
  if (next == Ch.DoubleQuote) return quoteCharOpening(next, next, at, Interpolate.All)
  if (next == Ch.Apostrophe) return quoteCharOpening(next, next, at, 0)
  if (next == 0x201c /* “ */) return quoteCharOpening(next, 0x201d, at, Interpolate.All)
  if (next == 0x2018 /* ‘ */) return quoteCharOpening(next, 0x2019, at, 0)
  if (next == 0x300c /* 「 */) return quoteCharOpening(next, 0x300d, at, 0, false)
  if (!isAsciiLetter(next)) return null

  let pos = at + 1
  while (isAsciiLetter(input.peek(pos))) pos++
  if (pos - at > 4) return null
  let name = word(input, at, pos), kind = quoteWords[name]
  if (!kind) return null

  // Adverbs: :w, :to, :g, :x(2). Those of a regex mean other things
  // than those of a quote: m:s/a b/
  let adverbs = false, heredoc = false, isQuote = kind == "raw" || kind == "interpolating"
  let interpolates = kind == "interpolating" ? Interpolate.All : 0
  // Whether a backslash escapes the delimiter, apart from the escapes
  // of :b. That comes with q and its :q adverb: Q and qq:!b have none.
  let escapes = isQuote ? kind == "raw" && next == Ch.q : true
  while (input.peek(pos) == Ch.Colon && (isAsciiLetter(input.peek(pos + 1)) || input.peek(pos + 1) == Ch.Bang)) {
    adverbs = true
    let negated = input.peek(pos + 1) == Ch.Bang, adverbStart = pos + (negated ? 2 : 1)
    pos += 2
    while (isAsciiLetter(input.peek(pos)) || isDigit(input.peek(pos))) pos++
    let adverb = word(input, adverbStart, pos)
    if (isQuote) {
      let bits = interpolationAdverbs.get(adverb)
      if (bits != null) interpolates = negated ? interpolates & ~bits : interpolates | bits
      else if (!negated && (adverb == "q" || adverb == "single")) escapes = true
      else if (!negated && (adverb == "to" || adverb == "heredoc")) heredoc = true
    }
    if (input.peek(pos) == Ch.ParenOpen) {
      while (input.peek(pos) != Ch.ParenClose) {
        if (input.peek(pos) < 0 || input.peek(pos) == Ch.Newline) return null
        pos++
      }
      pos++
    }
  }
  if (!adverbs && continuesName(input, pos)) return null

  // The delimiter has to follow directly. Raku also takes `q {...}`, but
  // then `S { ... }` and `m ($x)` on a name that is not a quote word
  // would turn into quotes.
  let open = input.peek(pos), close = brackets[open]
  if (close == null) {
    if (!isQuoteDelimiter(open)) return null
    close = open
  }
  // q(...) is a call.
  if (open == Ch.ParenOpen && !adverbs) return null
  let count = 1
  if (close != open) while (input.peek(pos + count) == open) count++
  if (isQuote) kind = interpolates ? "interpolating" : "raw"
  if (interpolates & Interpolate.Backslash) escapes = true
  return {open, close, count, start: pos + count, kind, interpolates, escapes, heredoc}
}

// The offset after the delimiter that closes a quote whose content
// starts at `pos`, or -1 when it is not closed.
function rawEnd(input: InputStream, pos: number, opening: Pick<Opening, "open" | "close" | "count" | "escapes">) {
  let {open, close, count} = opening
  for (let depth = 1;;) {
    let ch = input.peek(pos)
    if (ch < 0) return -1
    if (ch == Ch.Backslash && opening.escapes) pos += 2
    else if (ch == close && repeats(input, pos, close, count)) {
      pos += count
      if (--depth == 0) return pos
    } else if (ch == open && repeats(input, pos, open, count)) {
      pos += count
      depth++
    } else pos++
  }
}

// The offset after a quoted string that starts at `pos`, or -1.
function quotedEnd(input: InputStream, pos: number) {
  let quote = input.peek(pos)
  for (pos++;;) {
    let ch = input.peek(pos)
    if (ch < 0 || ch == Ch.Newline) return -1
    if (ch == Ch.Backslash) pos += 2
    else if (ch == quote) return pos + 1
    else pos++
  }
}

// The offset of the delimiter that closes a regex whose content starts
// at `pos`, or -1. Delimiters do not count inside quotes, character
// classes, comments and code blocks.
function regexEnd(input: InputStream, pos: number, open: number, close: number, count: number) {
  for (let depth = 1;;) {
    let ch = input.peek(pos)
    if (ch < 0) return -1
    if (ch == Ch.Backslash) {
      pos += 2
    } else if (ch == close && repeats(input, pos, close, count)) {
      if (--depth == 0) return pos
      pos += count
    } else if (ch == open && repeats(input, pos, open, count)) {
      pos += count
      depth++
    } else if (ch == Ch.Apostrophe || ch == Ch.DoubleQuote) {
      let end = quotedEnd(input, pos)
      pos = end < 0 ? pos + 1 : end
    } else if (ch == Ch.Less && (input.peek(pos + 1) == Ch.BracketOpen ||
               (input.peek(pos + 1) == Ch.Hyphen || input.peek(pos + 1) == Ch.Plus) && input.peek(pos + 2) == Ch.BracketOpen)) {
      // <[...]>, <-[...]>, and combinations: <+[a..z]-[aeiou]>
      for (pos++;;) {
        while (input.peek(pos) != Ch.BracketOpen) {
          if (input.peek(pos) < 0) return -1
          pos++
        }
        for (pos++; input.peek(pos) != Ch.BracketClose; pos++) {
          if (input.peek(pos) < 0) return -1
          if (input.peek(pos) == Ch.Backslash) pos++
        }
        let more = pos + 1
        while (input.peek(more) == Ch.Space) more++
        if (input.peek(more) != Ch.Plus && input.peek(more) != Ch.Hyphen) break
        do more++; while (input.peek(more) == Ch.Space)
        if (input.peek(more) != Ch.BracketOpen) break
        pos = more
      }
    } else if (ch == Ch.Hash) {
      while (input.peek(pos) >= 0 && input.peek(pos) != Ch.Newline) pos++
    } else if (ch == Ch.BraceOpen && close != Ch.BraceClose) {
      let end = regexEnd(input, pos + 1, Ch.BraceOpen, Ch.BraceClose, 1)
      pos = end < 0 ? pos + 1 : end + 1
    } else {
      pos++
    }
  }
}

// The offset after a regex or substitution, given its opening, or -1.
function regexTokenEnd(input: InputStream, opening: Opening) {
  let {open, close, count} = opening
  let end = regexEnd(input, opening.start, open, close, count)
  if (end < 0) return -1
  end += count
  // s/a/b/ has a second part. s{a} = 'b' does not.
  if (opening.kind == "substitution" && open == close) end = rawEnd(input, end, opening)
  return end
}

// The offset after a word list that opens at the current position, or
// -1. A list that spans lines has to hold plain words, so that a stray
// `<` does not swallow the code up to some later `>`. `strict` is for
// a subscript, which has to be on one line, and cannot hold what
// would make it a comparison: `$a<5 && $b>3`.
function wordListEnd(input: InputStream, strict: boolean) {
  let open = input.next, close = open == Ch.GuillemetOpen ? Ch.GuillemetClose : Ch.Greater
  let count = open == Ch.Less && input.peek(1) == Ch.Less ? 2 : 1
  for (let pos = count, lines = 0, code = false;; pos++) {
    let ch = input.peek(pos)
    if (ch == close && repeats(input, pos, close, count)) return pos + count
    if (ch < 0) return -1
    if (ch == Ch.Newline) lines++
    else if (ch == Ch.Semicolon || ch == Ch.BraceOpen || ch == Ch.BraceClose ||
             ch == Ch.ParenOpen || ch == Ch.ParenClose) code = true
    if (lines && (code || strict)) return -1
    if (strict && (code || ch == Ch.Dollar || ch == Ch.At || ch == Ch.Percent || ch == Ch.Amp ||
                   ch == Ch.Pipe || ch == Ch.Equals || ch == Ch.Comma || ch == Ch.Question ||
                   ch == Ch.Bang || ch == Ch.DoubleQuote || ch == Ch.Less)) return -1
  }
}

// A `<` subscript right after a term: %h<key>
function subscriptEnd(input: InputStream) {
  if (input.next != Ch.Less || isSpace(input.peek(-1)) || input.peek(1) == Ch.Less) return -1
  return wordListEnd(input, true)
}

const operatorCategory = /^(infix|prefix|postfix|circumfix|postcircumfix|term)$/

function isWordOperator(name: string) {
  return name == "x" || name == "xx" || name == "min" || name == "max" || name == "Z" || name == "X"
}

// The tokens that depend on whether a term or an operator is expected.
export const termToken = new ExternalTokenizer((input, stack) => {
  if (!stack.canShift(Regex)) return
  let next = input.next, {mode} = context(stack)

  if (isIdentifierStart(next)) {
    // The Z, X and R meta operators: Z+, X~, R-, Z=>
    if (mode == Mode.AfterTerm && (next == Ch.Z || next == Ch.X || next == Ch.R) &&
        isOperatorChar(input.peek(1)) && !continuesName(input, 1)) {
      let pos = 2
      while (isOperatorChar(input.peek(pos))) pos++
      return input.acceptToken(wordOperator, pos)
    }
    // A word before `=>` is a key, whatever it spells.
    let end = nameEnd(input, 0), after = end
    while (input.peek(after) == Ch.Space || input.peek(after) == Ch.Tab) after++
    if (input.peek(after) == Ch.Equals && input.peek(after + 1) == Ch.Greater)
      return input.acceptToken(fatArrowKey, end)
    if (mode == Mode.AfterTerm) {
      // x, xx, min, max, Z and X are operators where one is expected.
      if (isWordOperator(word(input, 0, end))) input.acceptToken(wordOperator, end)
      return
    }
  } else if (next == Ch.Percent || next == Ch.Amp) {
    // Squeezed between two terms, a sigil is the operator: $a%b. With a
    // space before it, it is a variable: `my Array[Int] %h`.
    if (mode == Mode.AfterTerm && isIdentifierStart(input.peek(1)) && !isSpace(input.peek(-1)))
      return input.acceptToken(wordOperator, 1)
    // An operator as a routine: &infix:<+>
    if (next == Ch.Amp) {
      let end = nameEnd(input, 1)
      if (end > 0 && operatorCategory.test(word(input, 1, end))) {
        let categoryTo = categoryEnd(input, 1, end)
        if (categoryTo > end) input.acceptToken(operatorVariable, categoryTo)
      }
    }
    return
  } else if (next == Ch.Less || next == Ch.GuillemetOpen) {
    let end
    if (inTermPosition(input, mode, 1)) {
      // [<] and [<=] are reductions, <-> starts a pointy block.
      let after = input.peek(1)
      if (after == Ch.Equals || after == Ch.BracketClose || after == Ch.Hyphen && input.peek(2) == Ch.Greater) return
      end = wordListEnd(input, false)
    } else {
      end = subscriptEnd(input)
    }
    if (end > 0) input.acceptToken(rawString, end)
    return
  } else if (next == Ch.Slash) {
    if (input.peek(1) == Ch.Slash || !inTermPosition(input, mode, 1)) return
    let end = regexEnd(input, 1, Ch.Slash, Ch.Slash, 1)
    if (end > 0) input.acceptToken(Regex, end + 1)
    return
  }

  let opening = readOpening(input)
  if (!opening) return
  if (opening.kind == "interpolating") return input.acceptToken(quoteStart, opening.start)
  let end = opening.kind == "raw" ? rawEnd(input, opening.start, opening) : regexTokenEnd(input, opening)
  if (end > 0) input.acceptToken(opening.kind == "raw" ? rawString : Regex, end)
})

// Whether a sigil other than `$` interpolates: only when a subscript or
// a call follows its name. `end` is the offset after the name.
function hasPostfix(input: InputStream, end: number) {
  let ch = input.peek(end)
  if (ch == Ch.BracketOpen || ch == Ch.ParenOpen || ch == Ch.BraceOpen || ch == Ch.Less) return true
  if (ch != Ch.Dot) return false
  let methodEnd = nameEnd(input, end + 1)
  return methodEnd > 0 && input.peek(methodEnd) == Ch.ParenOpen
}

// The pieces of a quote that interpolates.
export const quoteToken = new ExternalTokenizer((input, stack) => {
  if (!stack.canShift(quoteEnd)) return
  let {quote, mode} = context(stack)
  if (!quote) return
  let {open, close, count, interpolates} = quote, nests = open != close
  // After a variable, a subscript or a call continues the interpolation.
  // `[` and `(` are left to the grammar's own tokens.
  if (mode == Mode.AfterTerm) {
    if (input.next == Ch.BracketOpen || input.next == Ch.ParenOpen) return
    let end = subscriptEnd(input)
    if (end > 0) return input.acceptToken(rawString, end)
  }
  let start = input.pos
  for (;;) {
    let next = input.next
    if (next < 0) break
    let atClose = next == close && repeats(input, 0, close, count)
    if (atClose || nests && next == open && repeats(input, 0, open, count)) {
      if (input.pos > start) break
      input.advance(count)
      return input.acceptToken(!atClose ? quoteNestOpen : quote.depth ? quoteNestClose : quoteEnd)
    }
    if (next == Ch.Backslash) {
      if (interpolates & Interpolate.Backslash) break
      // Still keeps a delimiter after it from closing the quote.
      if (quote.escapes && input.peek(1) >= 0) input.advance()
    } else if (next == Ch.Dollar) {
      if (interpolates & Interpolate.Scalar) break
    } else if (next == Ch.BraceOpen) {
      if (interpolates & Interpolate.Closure) break
    } else if (next == Ch.At && interpolates & Interpolate.Array ||
               next == Ch.Percent && interpolates & Interpolate.Hash ||
               next == Ch.Amp && interpolates & Interpolate.Function) {
      let end = nameEnd(input, 1)
      if (end > 0 && hasPostfix(input, end)) break
    }
    input.advance()
  }
  if (input.pos > start) input.acceptToken(quoteContent)
})

// The text of a heredoc: the lines after the one that holds its opener,
// up to the line that holds only its terminator. As a skipped token, it
// leaves the rest of the opener's line to be parsed as usual. The
// context holds the terminators of the heredocs that the line opened.
export const heredocToken = new ExternalTokenizer((input, stack) => {
  let {heredocs} = context(stack)
  if (!heredocs.length) return
  let pos = blanksEnd(input, 0)
  if (input.peek(pos) != Ch.Newline) return
  input.advance(pos)
  for (let terminator of heredocs) {
    for (;;) {
      // Without its terminator, this is not taken to be a heredoc.
      if (input.next < 0) return
      input.advance()
      if (lineStartsWith(input, terminator) && isLineEnd(input, terminator.length)) {
        input.advance(terminator.length)
        break
      }
      skipLine(input)
    }
  }
  input.acceptToken(Heredoc)
})

// The body of a token, rule or regex declaration, up to its closing brace.
export const regexBodyToken = new ExternalTokenizer((input, stack) => {
  if (!stack.canShift(regexBody)) return
  let end = regexEnd(input, 0, Ch.BraceOpen, Ch.BraceClose, 1)
  if (end < 0) {
    // Not closed: the rest of the input.
    skipToEnd(input)
    if (input.pos > stack.pos) input.acceptToken(regexBody)
  } else if (end > 0) {
    input.acceptToken(regexBody, end)
  }
})

// ---- Names ----

// The dot of a method call, with its optional `?`, `+`, `*`, `^` or `&`
// modifier. It is only produced when a name follows. In a string, a
// method call is only interpolated after a variable, and when it has
// an argument list: "$x.foo()"
export const methodDotToken = new ExternalTokenizer((input, stack) => {
  if (input.next != Ch.Dot) return
  let size = 1, next = input.peek(1)
  if (next == Ch.Question || next == Ch.Plus || next == Ch.Star || next == Ch.Caret || next == Ch.Amp)
    next = input.peek(++size)
  if (!isIdentifierStart(next)) return
  let {quote, mode} = context(stack)
  if (quote && stack.canShift(quoteEnd) &&
      (mode != Mode.AfterTerm || input.peek(nameEnd(input, size)) != Ch.ParenOpen)) return
  input.acceptToken(methodDot, size)
})

// The offset after an operator name's `:<...>` part, as in infix:<+>,
// circumfix:<[ ]>, infix:['+'] and term:sym<x>, or `pos` when there is
// none there. The name before it runs from `nameStart` to `pos`.
function categoryEnd(input: InputStream, nameStart: number, pos: number) {
  if (input.peek(pos) != Ch.Colon) return pos
  let open = pos + 1
  if (word(input, open, open + 3) == "sym") open += 3
  let first = input.peek(open)
  if (first == Ch.BracketOpen) {
    // Only a quoted operator: ['+']
    let quote = input.peek(open + 1)
    if (quote != Ch.Apostrophe && quote != Ch.DoubleQuote) return pos
    let end = quotedEnd(input, open + 1)
    return end > 0 && input.peek(end) == Ch.BracketClose ? end + 1 : pos
  }
  let close = first == Ch.Less ? Ch.Greater : first == Ch.GuillemetOpen ? Ch.GuillemetClose : -1
  if (close < 0) return pos
  // The two halves of a circumfix are separated by one space.
  let spaces = /circumfix$/.test(word(input, nameStart, pos)) ? 1 : 0
  for (let i = open + 1;; i++) {
    let ch = input.peek(i)
    if (ch < 0 || isSpace(ch) && (ch != Ch.Space || i == open + 1 || --spaces < 0)) return pos
    // The operator itself can be `>`, so the last closer before a break counts.
    if (ch == close && !(input.peek(i + 1) == close)) return i + 1
  }
}

// A name after a method dot or a declarator. The grammar's keywords are
// specialized identifiers, and specialization does not look at the
// parse state, so these positions get tokens of their own.
export const nameToken = new ExternalTokenizer((input, stack) => {
  // Only a method declaration takes a mark: `method !private`, `method ^meta`.
  let mark = input.next == Ch.Bang || input.next == Ch.Caret ? 1 : 0
  let end = nameEnd(input, mark)
  if (end < 0) return
  if (stack.canShift(MethodName)) {
    if (!mark) input.acceptToken(MethodName, end)
    return
  }
  end = categoryEnd(input, mark, end)
  if (!mark && stack.canShift(declaredName)) input.acceptToken(declaredName, end)
  else if (stack.canShift(declaredMethodName)) input.acceptToken(declaredMethodName, end)
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
