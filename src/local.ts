import {Completion} from "@codemirror/autocomplete"
import {EditorState} from "@codemirror/state"
import {IterMode, NodeWeakMap, SyntaxNode, Tree, TreeCursor} from "@lezer/common"

// The names that a document declares, for completion. They are
// gathered per scope (a block, or the whole document), and kept in a
// map that is keyed by syntax node, so that the parts of the document
// that an edit leaves alone are not gone over again.
//
// An edit replaces the node of every scope around it, the whole
// document's among them. What the parts of a scope declare is kept
// too, for each of the anonymous nodes that group the children of a
// long node: those that the edit leaves alone are reused by the new
// tree as they are (see `chunks`).

interface Scope {
  // The variables, routines, types and constants declared in the scope.
  // Those with a sigil, as in `$x` and `&f`, and those without.
  readonly variables: readonly Completion[]
  readonly names: readonly Completion[]
  // The methods declared in the scope or anywhere in it. Any of them
  // may be called on an object, wherever that is.
  readonly methods: readonly Completion[]
}

const scopes = new NodeWeakMap<Scope>()

const scopeNodes = new Set(["Block", "Interpolation", "Program"])
const variableNodes = new Set(["VariableName", "AttributeName"])
const declarators = new Set(["my", "our", "has", "state"])

function isDeclaration(name: string) { return name.endsWith("Declaration") }

/// Whether a variable is a placeholder, which is declared by being
/// used: $^a, and the named $:a
export function isPlaceholder(name: string) { return /^[$@%&][\^:]/.test(name) }

// Whether the node `name` is a term that a block can be the subscript
// of, when it touches the block: %h{$key}
function isSubscripted(name: string) { return /^[A-Z]/.test(name) && name != "Operator" }

// The name of the variable without a sigil that the backslash `node`
// comes right before, as in `\x`. A capitalized one reads as a type.
function sigillessName(state: EditorState, node: SyntaxNode) {
  let next = node.nextSibling
  return node.name == "Operator" && next && (next.name == "Identifier" || next.name == "TypeName") &&
    next.from == node.to && state.sliceDoc(node.from, node.to) == "\\" ? next : null
}

// Whether a block is a subscript, as in %h{$key}: it touches the term
// before it. It is not a scope for placeholder variables.
function isSubscript(block: SyntaxNode) {
  let prev = block.prevSibling
  return block.name == "Block" && prev != null && prev.to == block.from && isSubscripted(prev.name)
}

// The native types, whose names are not capitalized. Another word after
// a declarator is more likely a call that follows an unfinished `my`.
const nativeTypes = /^(u?int(8|16|32|64)?|num(32|64)?|str|atomicint|byte|bool|u?long(long)?|s?size_t)$/

// Whether `node`, which comes after a declarator, is (part of) the type
// of what is declared: my Int $x, my int $x, my Array[Int] @y, and the
// coercion type my Foo(Str) $x, whose parentheses touch the type name
// `prev`.
function isType(state: EditorState, node: SyntaxNode, prev: string) {
  let {name} = node
  return name == "TypeName" || name == "Brackets" || name == "Parens" && prev == "TypeName" ||
    name == "Identifier" && nativeTypes.test(state.sliceDoc(node.from, node.to))
}

function hasSigil(completion: Completion) { return /^[$@%&]/.test(completion.label) }

function variable(label: string): Completion {
  return {label, type: label[0] == "&" ? "function" : /^.[!.]/.test(label) ? "property" : "variable", boost: 1}
}

function isArrow(text: string) { return text == "->" || text == "<->" }

// What the children of a node that have been gone over tell about the
// next one.
interface Flow {
  // A declarator was seen, and what it declares is yet to come.
  declaring: boolean
  // The previous child is the backslash of a variable without a sigil
  // that is declared: my \x
  sigilless: boolean
  // The name of the previous child, and where it ends.
  prev: string
  prevTo: number
}

// The part of the flow that the first child of a part of a node, which
// starts at `from`, depends on.
function flowKey(flow: Flow, from: number) {
  let touching = flow.prevTo == from
  let prev = !touching ? 0 : flow.prev == "TypeName" ? 1 : isSubscripted(flow.prev) ? 2 : 0
  return (flow.declaring ? 1 : 0) | (touching && flow.sigilless ? 2 : 0) | prev << 2
}

// What a part of a node declares, and the flow after it.
interface Gathered {
  readonly variables: readonly Completion[]
  readonly names: readonly Completion[]
  readonly methods: readonly Completion[]
  readonly declaring: boolean
  readonly sigilless: boolean
  readonly prev: string
  // The distance from the end of the last child to the end of the part.
  readonly endGap: number
}

interface Chunk {
  // The distance from the start of the part to the start of its first child.
  readonly startGap: number
  // By the key of the flow before the part.
  readonly gathered: Map<number, Gathered>
}

// What the anonymous nodes that group the children of a long node
// declare. The tree after an edit reuses those that the edit leaves
// alone, with the same text in them. Only their position can differ,
// and what is kept does not depend on it.
const chunks = new WeakMap<Tree, Chunk>()

function append<T>(to: T[], from: readonly T[]) {
  for (let item of from) to.push(item)
}

class Gatherer {
  variables: Completion[] = []
  names: Completion[] = []
  methods: Completion[] = []
  // The number of children gone over by `child`.
  children = 0
  constructor(readonly state: EditorState) {}

  text(node: SyntaxNode) { return this.state.sliceDoc(node.from, node.to) }

  add(completion: Completion) {
    (hasSigil(completion) ? this.variables : this.names).push(completion)
  }

  declare(node: SyntaxNode) {
    let label = this.text(node)
    // A name without a sigil: my \x
    if (!variableNodes.has(node.name)) return this.names.push({label, type: "variable", boost: 1})
    this.variables.push(variable(label))
    // `has $.x` also makes the private `$!x`, and `$^a` can be written `$a`.
    if (label[1] == ".") this.variables.push(variable(label[0] + "!" + label.slice(2)))
    else if (isPlaceholder(label)) this.variables.push(variable(label[0] + label.slice(2)))
  }

  // Whether the variable `node` is a placeholder. Its first character is a sigil.
  isPlaceholderNode(node: SyntaxNode) {
    let second = this.state.sliceDoc(node.from + 1, node.from + 2)
    return second == "^" || second == ":"
  }

  // Declares the name after `node`, when `node` is the backslash of a
  // variable without a sigil: my \x = 1, sub f(\x) { }
  declareSigilless(node: SyntaxNode) {
    let name = sigillessName(this.state, node)
    if (name) this.declare(name)
    return name != null
  }

  // The variables of a signature, or of the parentheses of `my (...)`.
  // What follows a `=` or a `where`, up to the next comma, is a default
  // value or a constraint, and uses variables rather than declaring them.
  declareAll(node: SyntaxNode) {
    let uses = false
    for (let child = node.firstChild; child; child = child.nextSibling) {
      let {name} = child
      if (name == ",") uses = false
      else if (name == "where" || name == "Operator" && this.text(child) == "=") uses = true
      else if (uses) continue
      else if (this.declareSigilless(child)) continue
      else if (variableNodes.has(name)) this.declare(child)
      else if (name == "Parens" || name == "Brackets") this.declareAll(child)
    }
  }

  addMethods(scope: SyntaxNode) {
    append(this.methods, scopeOf(scope, this.state).methods)
  }

  // Goes over the content of a node that is not a scope of its own.
  content(node: SyntaxNode) {
    let cursor = node.cursor(IterMode.IncludeAnonymous)
    if (cursor.firstChild()) this.sequence(cursor, {declaring: false, sigilless: false, prev: "", prevTo: -1})
  }

  // Goes over the node at `cursor` and the siblings after it. They are
  // the children of a node, or the anonymous nodes that group them.
  sequence(cursor: TreeCursor, flow: Flow) {
    do {
      if (!cursor.type.isAnonymous) {
        this.child(cursor.node, flow)
      } else if (cursor.tree) {
        this.chunk(cursor, cursor.tree, flow)
      } else if (cursor.firstChild()) {
        this.sequence(cursor, flow)
        cursor.parent()
      }
    } while (cursor.nextSibling())
  }

  // Goes over the anonymous node `tree` at `cursor`, or takes what was
  // gathered from it before, with the same flow.
  chunk(cursor: TreeCursor, tree: Tree, flow: Flow) {
    let {from, to} = cursor, chunk = chunks.get(tree)
    let found = chunk && chunk.gathered.get(flowKey(flow, from + chunk.startGap))
    if (!found) {
      if (!cursor.firstChild()) return
      let start = cursor.from, key = flowKey(flow, start)
      let inner = new Gatherer(this.state), after = {...flow}
      inner.sequence(cursor, after)
      cursor.parent()
      // Without a child, the flow after the part is the one before it.
      if (!inner.children) return
      if (!chunk) chunks.set(tree, chunk = {startGap: start - from, gathered: new Map})
      found = {variables: inner.variables, names: inner.names, methods: inner.methods,
               declaring: after.declaring, sigilless: after.sigilless, prev: after.prev, endGap: to - after.prevTo}
      chunk.gathered.set(key, found)
    }
    // Only a part with children is kept.
    this.children++
    append(this.variables, found.variables)
    append(this.names, found.names)
    append(this.methods, found.methods)
    flow.declaring = found.declaring
    flow.sigilless = found.sigilless
    flow.prev = found.prev
    flow.prevTo = to - found.endGap
  }

  // Goes over a child of a node that is not a scope of its own. What it
  // declares depends on the children before it only through `flow`.
  child(child: SyntaxNode, flow: Flow) {
    let {name} = child, touching = flow.prevTo == child.from
    let {declaring} = flow, prev = touching ? flow.prev : ""
    let sigilless = flow.sigilless && touching
    this.children++
    flow.prev = name
    flow.prevTo = child.to
    flow.sigilless = false
    if (sigilless && (name == "Identifier" || name == "TypeName")) {
      this.declare(child)
      flow.declaring = false
      return
    }
    if (declarators.has(name)) {
      flow.declaring = true
      return
    }
    if (declaring && isType(this.state, child, prev)) return
    flow.declaring = false
    // A placeholder variable declares itself where it is used: { $^a + $^b }
    if (name == "VariableName" && this.isPlaceholderNode(child)) this.declare(child)
    else if (declaring && name == "Operator" && this.text(child) == "\\") flow.sigilless = true
    else if (declaring && variableNodes.has(name)) this.declare(child)
    else if (declaring && name == "Parens") this.declareAll(child)
    else if (scopeNodes.has(name)) {
      // The placeholders in a subscript are those of the block around it.
      if (name == "Block" && isSubscripted(prev)) this.placeholders(child)
      this.addMethods(child)
    } else if (isDeclaration(name)) {
      this.declaration(child)
      // A constant that is declared with a backslash has its name after
      // the declaration node: constant \limit = 3
      if (name == "ConstantDeclaration" && child.lastChild!.name == "constant") flow.declaring = true
    } else if (child.firstChild) this.content(child)
  }

  // The placeholder variables in a node, and in the subscripts in it.
  placeholders(node: SyntaxNode) {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name == "VariableName") { if (this.isPlaceholderNode(child)) this.declare(child) }
      else if (child.firstChild && (!scopeNodes.has(child.name) || isSubscript(child))) this.placeholders(child)
    }
  }

  declaration(node: SyntaxNode) {
    let kind = node.firstChild!.name
    for (let child = node.firstChild; child; child = child.nextSibling) {
      let {name} = child
      if (name == "RoutineName") {
        let label = this.text(child)
        // An operator is not called by its name: infix:<+>
        if (/:[<«\[]/.test(label)) continue
        // `multi foo` has no declarator, and declares a sub.
        if (kind == "sub" || kind == "RoutineName") {
          this.names.push({label, type: "function", boost: 1})
          this.variables.push(variable("&" + label))
        }
        // A private method is called as self!name, where nothing is completed.
        else if (/^[^!^]/.test(label)) this.methods.push({label, type: "method", boost: 1})
      } else if (name == "PackageName") {
        this.names.push({label: this.text(child), type: "class", boost: 1})
      } else if (name == "EnumName" || name == "SubsetName") {
        this.names.push({label: this.text(child), type: "type", boost: 1})
      } else if (name == "ConstantName") {
        let label = this.text(child)
        this.add(/^[$@%&]/.test(label) ? variable(label) : {label, type: "constant", boost: 1})
      } else if (scopeNodes.has(name)) {
        this.addMethods(child)
      } else if (name != "Parens" && child.firstChild) {
        // The signature belongs to the scope of the body.
        this.content(child)
      }
    }
  }

  // The parameters of a block: those of the routine that it is the body
  // of, or the ones after the arrow of a pointy block.
  parameters(block: SyntaxNode) {
    let parent = block.parent
    if (parent && parent.name == "RoutineDeclaration") {
      for (let child = parent.firstChild; child; child = child.nextSibling)
        if (child.name == "Parens") this.declareAll(child)
      return
    }
    // Going backwards, the variables of a parameter come before the
    // `=` of its default value.
    let found: SyntaxNode[] = [], parameter: SyntaxNode[] = []
    for (let prev = block.prevSibling; prev; prev = prev.prevSibling) {
      let {name} = prev
      if (name == ";" || name == "Block" || isDeclaration(name)) return
      if (name == "VariableName") {
        parameter.push(prev)
      } else if (prev.prevSibling && sigillessName(this.state, prev.prevSibling)) {
        // -> \item { }
        parameter.push(prev)
      } else if (name == ",") {
        found = found.concat(parameter)
        parameter = []
      } else if (name == "Operator") {
        let text = this.text(prev)
        if (text == "=") parameter = []
        else if (isArrow(text)) {
          for (let node of found.concat(parameter)) this.declare(node)
          return
        }
      }
    }
  }
}

// The names that the scope node `node` declares in its content. The
// parameters of a block are not part of its node, and are left out.
function scopeOf(node: SyntaxNode, state: EditorState): Scope {
  let scope = scopes.get(node)
  if (scope) return scope
  let gatherer = new Gatherer(state)
  gatherer.content(node)
  scope = {variables: gatherer.variables, names: gatherer.names, methods: gatherer.methods}
  scopes.set(node, scope)
  return scope
}

/// The names that are in scope at `node`, innermost scope first, and
/// the methods of the whole document.
export function localNames(node: SyntaxNode, state: EditorState): Scope {
  let variables: Completion[] = [], names: Completion[] = [], methods: readonly Completion[] = []
  for (let cur: SyntaxNode | null = node; cur; cur = cur.parent) {
    if (!scopeNodes.has(cur.name)) continue
    let scope = scopeOf(cur, state)
    // An edit to the parameters does not replace the block's node, so
    // these are read every time.
    let parameters = new Gatherer(state)
    parameters.parameters(cur)
    append(variables, parameters.variables)
    append(names, parameters.names)
    append(variables, scope.variables)
    append(names, scope.names)
    methods = scope.methods
  }
  return {variables, names, methods}
}

/// Whether a variable is in a place where variables are declared, so
/// that its name is a new one. The variable is a child of `parent`, and
/// comes after the sibling `prev`.
export function declaresVariable(state: EditorState, parent: SyntaxNode, prev: SyntaxNode | null) {
  let text = (node: SyntaxNode) => state.sliceDoc(node.from, node.to)
  // A signature, or the list of `my ($a, $b)`, unless the variable is
  // in a default value or in a constraint.
  if (parent.name == "Parens") {
    let before = parent.prevSibling
    if (parent.parent && parent.parent.name == "RoutineDeclaration" || before && declarators.has(before.name)) {
      for (let node = prev; node && node.name != ","; node = node.prevSibling)
        if (node.name == "where" || node.name == "Operator" && text(node) == "=") return false
      return true
    }
  }
  // After a declarator, or after the arrow of a pointy block.
  let first = true
  for (let node = prev; node; node = node.prevSibling) {
    let {name} = node
    // `my $a, $b` declares the first one only.
    if (declarators.has(name)) return first
    if (name == ";" || name == "Block" || name == "{" || isDeclaration(name)) return false
    if (name == "Operator") {
      let operator = text(node)
      if (isArrow(operator)) return true
      if (operator == "=") return false
    }
    // Only a type can stand between a declarator and its variable.
    let before = node.prevSibling
    if (!isType(state, node, before && before.to == node.from ? before.name : "")) first = false
  }
  return false
}
