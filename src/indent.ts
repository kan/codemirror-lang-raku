import {TreeIndentContext, delimitedIndent} from "@codemirror/language"
import {EditorState} from "@codemirror/state"
import {SyntaxNode} from "@lezer/common"

// The grammar has no statement nodes, so whether a line continues the
// statement before it is worked out here, from the token that precedes
// the line and from what the line starts with.

const skipped = /^(LineComment|DocComment|BlockComment|Pod|Heredoc)$/
const brackets = /^(Block|Parens|Brackets|Interpolation|Program)$/
const wordOperators = /^(and|or|xor|andthen|orelse|notandthen|div|mod|gcd|lcm|eq|ne|lt|gt|le|ge|cmp|leg|eqv|but)$/
// Operators that end a term or stand for a whole statement.
const closingOperators = /^(\+\+|--|\.\.\.|!!!|\?\?\?)$/

// A line that starts with an infix: an operator that has a space after
// it and more on the line, an operator that is a word, or a statement
// modifier. A prefix operator touches its operand, and `...` stands
// alone.
const startsWithInfix = new RegExp("^\\s*(?:[~+\\-*/%<>=|&^?!]+[ \\t]+\\S|(?:" + wordOperators.source.slice(2, -2) +
                                   "|if|unless|for|while|until|given|when|with|without)(?![\\w'-]))")
const startsWithMethod = /^\s*\.[^\s\d.]/

// The last token of `node`. A string counts as one token.
function lastToken(node: SyntaxNode) {
  while (node.lastChild && node.name != "StringLiteral") node = node.lastChild
  return node
}

// The last token that ends at or before `pos` in `bracket`, not
// counting comments.
function tokenBefore(bracket: SyntaxNode, pos: number) {
  let node: SyntaxNode | null = bracket.resolveInner(pos, -1)
  // Either the node that ends there, or the one around the position.
  if (node.to > pos) node = node.childBefore(pos)
  while (node) {
    let token = lastToken(node)
    if (!skipped.test(token.name)) return token
    // Go to what comes before the comment, in this node or around it.
    while (node && !node.prevSibling) node = node.parent
    node = node && node.prevSibling
  }
  return null
}

function bracketAround(node: SyntaxNode) {
  for (let parent = node.parent; parent; parent = parent.parent) if (brackets.test(parent.name)) return parent
  return null
}

// The bracket node whose content a token is part of. The brackets of a
// node are part of the content around that node.
function bracketOf(token: SyntaxNode) {
  let around = bracketAround(token)
  return around && around == token.parent && /^[()\[\]{}]$/.test(token.name) ? bracketAround(around) : around
}

// The first node after `node` that is not a comment.
function nextCode(node: SyntaxNode | null) {
  do node = node && node.nextSibling
  while (node && skipped.test(node.name))
  return node
}

// Whether a block in braces holds the pairs of a hash, in which a comma
// separates items that line up.
function holdsPairs(block: SyntaxNode, state: EditorState) {
  let first = block.name == "Block" ? nextCode(block.firstChild) : null
  if (!first) return false
  if (first.name == "PairKey") return true
  let second = nextCode(first)
  return second != null && second.name == "Operator" && state.sliceDoc(second.from, second.to) == "=>"
}

// Whether a line continues a statement of `bracket`. The line starts at
// `pos` with the text `after`.
function continuesStatement(state: EditorState, bracket: SyntaxNode, pos: number, after: string) {
  let before = tokenBefore(bracket, pos)
  if (!before || bracketOf(before) != bracket) return false
  let name = before.name, text = state.sliceDoc(before.from, before.to)
  if (name == "Operator") return !closingOperators.test(text)
  if (wordOperators.test(name) && name == text) return true
  if (name == ",") return !holdsPairs(bracket, state)
  if (name == ";" || name == "{") return false
  if (name == "}") {
    // A block ends its statement. A subscript, which touches the term
    // that it follows, does not: %h{$key}
    let block = before.parent!
    return block.from > 0 && !/\s/.test(state.sliceDoc(block.from - 1, block.from)) && startsWithInfix.test(after)
  }
  // After the end of a statement, a `.` calls a method on the topic.
  return startsWithInfix.test(after) || startsWithMethod.test(after)
}

// Whether the content of a bracket node starts on the line of its
// opening bracket, which `delimitedIndent` then aligns the rest with.
function isAligned(node: SyntaxNode, state: EditorState) {
  let open = node.firstChild, next = nextCode(open)
  return open != null && next != null && next != node.lastChild && next.from < state.doc.lineAt(open.from).to
}

const bodyKeywords = /^(if|elsif|else|unless|with|orwith|without|for|while|until|loop|repeat|given|when|default|whenever|react|supply|gather|do|try|start)$/
const declarationPrefixes = /^(my|our|has|state|anon|augment|supersede|unit|multi|proto|only)$/

// The first node of the statement that a block is the body of, when it
// is the body of a control statement or of a declaration. A block that
// is a term in an expression has none: `my $f = sub { ... }`
function statementOfBody(block: SyntaxNode, state: EditorState) {
  let declaration = block.parent && /Declaration$/.test(block.parent.name) ? block.parent : null
  let first = declaration || block
  for (let prev = first.prevSibling; prev; prev = prev.prevSibling) {
    if (skipped.test(prev.name)) continue
    if (prev.name == ";" || prev.name == "{") break
    // A closing brace that is followed by a line break ends a statement.
    if (lastToken(prev).name == "}" && /\n/.test(state.sliceDoc(prev.to, first.from))) break
    if (declaration && !declarationPrefixes.test(prev.name)) return null
    first = prev
  }
  return declaration || bodyKeywords.test(first.name) ? first : null
}

/// The indentation of the lines in a node that holds statements between
/// braces: that of `delimitedIndent`, and one unit more for a line that
/// continues a statement.
export function statementIndent(closing: string) {
  let delimited = delimitedIndent({closing})
  return (context: TreeIndentContext) => {
    let {node, state, unit} = context, after = context.textAfter
    let closed = after.slice(/^\s*/.exec(after)![0].length).startsWith(closing)
    // The body of a statement is indented from the line where the
    // statement starts, which need not be the line of its brace.
    //   if $a
    //     && $b {
    //     say 1;
    //   }
    let statement = isAligned(node, state) ? null : statementOfBody(node, state)
    let indent = statement ? context.lineIndent(statement.from) + (closed ? 0 : unit) : delimited(context)
    return !closed && continuesStatement(state, node, context.pos, after) ? indent + unit : indent
  }
}

/// The indentation of the lines at the top level.
export function topIndent(context: TreeIndentContext) {
  return continuesStatement(context.state, context.node, context.pos, context.textAfter) ? context.unit : 0
}
