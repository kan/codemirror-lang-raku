import {Completion, CompletionSource} from "@codemirror/autocomplete"
import {syntaxTree} from "@codemirror/language"
import {SyntaxNode, Tree} from "@lezer/common"
import {EditorState} from "@codemirror/state"
import {keywordTags} from "./keywords"
import {localNames, declaresVariable, hasSigil} from "./local"

function completions(type: string, ...labels: string[]): Completion[] {
  return labels.join(" ").split(" ").map(label => ({label, type}))
}

const keywords = completions("keyword", ...Object.keys(keywordTags))

const constants = completions("constant", "True False Nil Inf NaN Empty pi tau")

const types = completions(
  "type",
  "Mu Any Cool Bool Int UInt Num Rat FatRat Complex Str Numeric Real Rational Stringy",
  "int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 num num32 num64 str",
  "Array List Seq Slip Range Hash Map Pair Set SetHash Bag BagHash Mix MixHash",
  "Positional Associative Iterable Iterator Callable Code Block Routine Sub Method Signature Parameter Capture",
  "Regex Match Grammar Junction Whatever Order Version",
  "IO IO::Path IO::Handle Proc Proc::Async Buf Blob",
  "Promise Supply Supplier Channel Lock Thread",
  "Date DateTime Duration Instant",
  "Exception Failure X::AdHoc"
)

const routines = completions(
  "function",
  "say put print note printf sprintf prompt get lines words slurp spurt open close",
  "dir mkdir rmdir unlink chdir shell run exit die warn fail sleep await now time rand srand",
  "elems end keys values kv pairs antipairs map grep first sort reverse join split comb",
  "push pop shift unshift append prepend splice flat unique squish classify categorize",
  "min max minmax sum pick roll zip cross reduce produce",
  "abs sqrt floor ceiling round truncate exp log sin cos",
  "chars chr ord uc lc tc flip trim chomp chop index rindex substr",
  "defined EVAL"
)

const methods = completions(
  "method",
  "new clone defined WHAT gist raku Str Int Num Rat Bool Numeric Array List Hash Set Bag Seq",
  "say put print note lines words slurp spurt open close",
  "elems end keys values kv pairs antipairs map grep first sort reverse join split comb",
  "push pop shift unshift append prepend splice flat unique squish classify categorize",
  "min max minmax sum pick roll reduce produce head tail skip rotor batch",
  "abs sqrt floor ceiling round truncate",
  "chars ord uc lc tc flip trim chomp chop index rindex substr subst match contains",
  "starts-with ends-with fmt succ pred exists then tap"
)

const specialVariables = completions(
  "variable",
  "$*IN $*OUT $*ERR $*ARGFILES @*ARGS %*ENV $*CWD $*HOME $*TMPDIR $*PROGRAM $*PROGRAM-NAME",
  "$*EXECUTABLE $*PID $*USER $*KERNEL $*DISTRO $*VM $*RAKU $*REPO $*SPEC $*TZ",
  "$*THREAD $*SCHEDULER $*INIT-INSTANT",
  "$?FILE $?LINE $?PACKAGE $?MODULE $?CLASS $?ROLE $?DISTRIBUTION %?RESOURCES &?ROUTINE &?BLOCK"
)

const globals = [...keywords, ...constants, ...types, ...routines]

// The offered names are all ASCII, so there is no need to follow the
// grammar's notion of an identifier here.
// A name cannot start with a colon: after a request at `f(|`, typing
// `:key` is not a name from the list.
const nameTail = /^(\w[\w:'\-]*)?$/
const specialVariableTail = /^[$@%&][*?][\w\-]*$/
const variableTail = /^[$@%&][!.^:]?[\w'\-]*$/

// Whether the position of `node` holds code, as opposed to the text of
// a string, a regex, a comment or Pod. An interpolation is code again.
function inCode(node: SyntaxNode | null) {
  for (; node; node = node.parent) {
    // The body of a regex declaration, which has no Regex node when it is empty.
    if (node.name == "Block" && node.parent?.name == "RegexDeclaration") return false
    if (/^(Interpolation|Block|Parens|Brackets)$/.test(node.name)) return true
    if (/^(StringLiteral|Heredoc|Regex|Pod|LineComment|DocComment|BlockComment)$/.test(node.name)) return false
  }
  return true
}

// Whether the word at `node` is the name of a private method, as in
// `self!name`: it follows a `!` that is attached to a term. A `!` after
// anything else negates, as in `f(!defined $x)`.
function isPrivateMethodName(tree: Tree, state: EditorState, node: SyntaxNode) {
  let mark = tree.resolveInner(node.from, -1)
  if (mark.name != "Operator" || mark.to != node.from || state.sliceDoc(mark.from, mark.to) != "!") return false
  let invocant = tree.resolveInner(mark.from, -1)
  return invocant.to == mark.from &&
    /^(self|VariableName|AttributeName|SpecialVariable|Identifier|TypeName|Parens|Brackets|[)\]])$/.test(invocant.name)
}

// The names declared in the document, followed by the built-in ones
// that they do not hide.
function withLocal(local: readonly Completion[], builtin: readonly Completion[]) {
  if (!local.length) return builtin
  let labels = new Set<string>(), result = []
  for (let completion of local) {
    if (labels.has(completion.label)) continue
    labels.add(completion.label)
    result.push(completion)
  }
  for (let completion of builtin) if (!labels.has(completion.label)) result.push(completion)
  return result
}

/// A completion source for Raku keywords, for the commonly used
/// built-in types, routines, methods and special variables, and for the
/// names that the document declares.
export const rakuCompletionSource: CompletionSource = context => {
  let {state, pos} = context, tree = syntaxTree(state), node = tree.resolveInner(pos, -1)
  if (!inCode(node)) return null

  // `$*` alone is not a variable token yet.
  let special = node.name == "SpecialVariable" ? node : context.matchBefore(/[$@%&][*?]$/)
  if (special) return {from: special.from, options: specialVariables, validFor: specialVariableTail}

  // A variable, or a sigil that is about to be one. A lone `%` or `&`
  // is as often an operator, and has to be followed by a name first.
  let isVariableNode = node.name == "VariableName" || node.name == "AttributeName"
  let sigil = isVariableNode ? null : context.matchBefore(/[$@]$|[$@%&][!.]$/)
  if (isVariableNode || sigil) {
    let from = isVariableNode ? node.from : sigil!.from
    // A lone sigil is not a node. It lies in the node around it.
    let parent = isVariableNode ? node.parent! : tree.resolveInner(from, 0)
    let prev = isVariableNode ? node.prevSibling : parent.childBefore(from)
    if (declaresVariable(state, parent, prev)) return null
    let options = withLocal(localNames(parent, state).names.filter(hasSigil), [])
    return options.length ? {from, options, validFor: variableTail} : null
  }

  let local = localNames(node, state), localMethods = () => withLocal(local.methods, methods)
  if (node.name == "MethodName") return {from: node.from, options: localMethods(), validFor: nameTail}
  // A dot or `.=` with no name after it yet. Two dots are a range operator.
  let before = state.sliceDoc(Math.max(0, pos - 2), pos)
  if (before == ".=") return {from: pos, options: localMethods(), validFor: nameTail}
  if (/(^|[^.])\.$/.test(before)) {
    // The dot of `1.5` and of `v6.d` is far more often typed than a
    // method call on a number.
    let numeric = /^(Number|Version)$/.test(tree.resolveInner(pos - 1, -1).name)
    return numeric && !context.explicit ? null : {from: pos, options: localMethods(), validFor: nameTail}
  }

  let localGlobals = () => withLocal(local.names.filter(completion => !hasSigil(completion)), globals)
  // A keyword's node is named after the keyword, as are those of `,` and `;`.
  let isKeyword = /^\w/.test(node.name) && node.name == state.sliceDoc(node.from, node.to)
  if (isKeyword || node.name == "Identifier" || node.name == "TypeName") {
    if (isPrivateMethodName(tree, state, node)) return null
    // `$x .= trim` calls a method.
    let prev = node.prevSibling
    let afterDotAssign = prev != null && prev.name == "Operator" && state.sliceDoc(prev.from, prev.to) == ".="
    return {from: node.from, options: afterDotAssign ? localMethods() : localGlobals(), validFor: nameTail}
  }

  // Other names (pair keys, names being declared) are made up by the
  // user, so only a position where no token has been started gets the
  // whole list, and only on request.
  if (context.explicit && /^[\s(\[{,;=]?$/.test(state.sliceDoc(Math.max(0, pos - 1), pos)))
    return {from: pos, options: localGlobals(), validFor: nameTail}
  return null
}
