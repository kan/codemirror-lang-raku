import {Completion} from "@codemirror/autocomplete"
import {EditorState} from "@codemirror/state"
import {NodeWeakMap, SyntaxNode} from "@lezer/common"

// The names that a document declares, for completion. They are
// gathered per scope (a block, or the whole document), and kept in a
// map that is keyed by syntax node, so that the parts of the document
// that an edit leaves alone are not gone over again.

interface Scope {
  // The variables, routines, types and constants declared in the scope.
  readonly names: readonly Completion[]
  // The methods declared in the scope or anywhere in it. Any of them
  // may be called on an object, wherever that is.
  readonly methods: readonly Completion[]
}

const scopes = new NodeWeakMap<Scope>()

const scopeNodes = /^(Block|Interpolation|Program)$/
const variableNodes = /^(VariableName|AttributeName)$/
const declarators = /^(my|our|has|state)$/

/// Whether a completion is for a name with a sigil.
export function hasSigil(completion: Completion) { return /^[$@%&]/.test(completion.label) }

function variable(label: string): Completion {
  return {label, type: label[0] == "&" ? "function" : /^.[!.]/.test(label) ? "property" : "variable", boost: 1}
}

function isArrow(text: string) { return text == "->" || text == "<->" }

class Gatherer {
  names: Completion[] = []
  methods: Completion[] = []
  constructor(readonly state: EditorState) {}

  text(node: SyntaxNode) { return this.state.sliceDoc(node.from, node.to) }

  declare(node: SyntaxNode) {
    let label = this.text(node)
    this.names.push(variable(label))
    // `has $.x` also makes the private `$!x`.
    if (label[1] == ".") this.names.push(variable(label[0] + "!" + label.slice(2)))
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
      else if (variableNodes.test(name)) this.declare(child)
      else if (name == "Parens" || name == "Brackets") this.declareAll(child)
    }
  }

  addMethods(scope: SyntaxNode) {
    for (let method of scopeOf(scope, this.state).methods) this.methods.push(method)
  }

  // Goes over the content of a node that is not a scope of its own.
  content(node: SyntaxNode) {
    // Whether a declarator was seen, and what it declares is yet to come.
    let declaring = false
    for (let child = node.firstChild; child; child = child.nextSibling) {
      let {name} = child
      if (declarators.test(name)) {
        declaring = true
        continue
      }
      // my Int $x, my Array[Int] @y
      if (declaring && (name == "TypeName" || name == "Brackets")) continue
      if (declaring && variableNodes.test(name)) this.declare(child)
      else if (declaring && name == "Parens") this.declareAll(child)
      else if (scopeNodes.test(name)) this.addMethods(child)
      else if (/Declaration$/.test(name)) this.declaration(child)
      else if (child.firstChild) this.content(child)
      // The name of a constant with a sigil is a variable after the
      // declaration node: constant $LIMIT = 3
      declaring = name == "ConstantDeclaration" && child.lastChild!.name == "constant"
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
        if (kind == "sub") this.names.push({label, type: "function", boost: 1}, variable("&" + label))
        // A private method is called as self!name, where nothing is completed.
        else if (/^[^!^]/.test(label)) this.methods.push({label, type: "method", boost: 1})
      } else if (name == "PackageName") {
        this.names.push({label: this.text(child), type: "class", boost: 1})
      } else if (name == "EnumName" || name == "SubsetName") {
        this.names.push({label: this.text(child), type: "type", boost: 1})
      } else if (name == "ConstantName") {
        let label = this.text(child)
        this.names.push(/^[$@%&]/.test(label) ? variable(label) : {label, type: "constant", boost: 1})
      } else if (scopeNodes.test(name)) {
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
      if (name == ";" || name == "Block" || /Declaration$/.test(name)) return
      if (name == "VariableName") {
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
  scope = {names: gatherer.names, methods: gatherer.methods}
  scopes.set(node, scope)
  return scope
}

/// The names that are in scope at `node`, innermost scope first, and
/// the methods of the whole document.
export function localNames(node: SyntaxNode, state: EditorState): Scope {
  let names: Completion[] = [], methods: readonly Completion[] = []
  for (let cur: SyntaxNode | null = node; cur; cur = cur.parent) {
    if (!scopeNodes.test(cur.name)) continue
    let scope = scopeOf(cur, state)
    // An edit to the parameters does not replace the block's node, so
    // these are read every time.
    let parameters = new Gatherer(state)
    parameters.parameters(cur)
    for (let name of parameters.names) names.push(name)
    for (let name of scope.names) names.push(name)
    methods = scope.methods
  }
  return {names, methods}
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
    if (parent.parent && parent.parent.name == "RoutineDeclaration" || before && declarators.test(before.name)) {
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
    if (declarators.test(name)) return first
    if (name == ";" || name == "Block" || name == "{" || /Declaration$/.test(name)) return false
    if (name == "Operator") {
      let operator = text(node)
      if (isArrow(operator)) return true
      if (operator == "=") return false
    }
    // Only a type can stand between a declarator and its variable.
    if (name != "TypeName" && name != "Brackets") first = false
  }
  return false
}
