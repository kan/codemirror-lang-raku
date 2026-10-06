import {raku, rakuLanguage, rakuCompletion} from "../dist/index.js"
import {fileTests} from "@lezer/generator/dist/test"
import {LanguageSupport, getIndentation, foldable, matchBrackets, ensureSyntaxTree} from "@codemirror/language"
import {EditorState} from "@codemirror/state"
import {CompletionContext} from "@codemirror/autocomplete"
import {toggleBlockComment} from "@codemirror/commands"
import {classHighlighter, highlightTree} from "@lezer/highlight"
import {TreeFragment, Tree, NodeProp} from "@lezer/common"

import * as assert from "assert"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from 'url';
let caseDir = path.dirname(fileURLToPath(import.meta.url))

for (let file of fs.readdirSync(caseDir)) {
  if (!/\.txt$/.test(file)) continue

  let name = /^[^\.]*/.exec(file)[0]
  describe(name, () => {
    for (let {name, run} of fileTests(fs.readFileSync(path.join(caseDir, file), "utf8"), file))
      it(name, () => run(rakuLanguage.parser))
  })
}

// The highlighted pieces of `code`, as [text, classes] pairs.
function highlight(code) {
  let result = []
  highlightTree(rakuLanguage.parser.parse(code), classHighlighter, (from, to, classes) => {
    result.push([code.slice(from, to), classes])
  })
  return result
}

// The keywords of the grammar. A keyword's node is named after the
// keyword, so its name parses to a node of that name.
function keywordNames() {
  let parser = rakuLanguage.parser
  return parser.nodeSet.types.map(type => type.name).filter(name => {
    // The word `TypeName` is a type name, which also gives a node of that name.
    return /^\w+$/.test(name) && name != "TypeName" && parser.parse(name).topNode.firstChild?.name == name
  })
}

describe("highlighting", () => {
  it("styles tokens with standard tags", () => {
    assert.deepStrictEqual(highlight('my Int $!n = 42; # x'), [
      ["my", "tok-keyword"],
      ["Int", "tok-typeName"],
      ["$!n", "tok-propertyName"],
      ["=", "tok-operator"],
      ["42", "tok-number"],
      [";", "tok-punctuation"],
      ["# x", "tok-comment"]
    ])
  })

  it("styles interpolations apart from the string around them", () => {
    assert.deepStrictEqual(highlight('"a $b\\n"'), [
      ['"a ', "tok-string"],
      ["$b", "tok-variableName"],
      ["\\n", "tok-string2"],
      ['"', "tok-string"]
    ])
  })

  it("styles declared names as definitions", () => {
    assert.deepStrictEqual(highlight("class Foo"), [
      ["class", "tok-keyword"],
      ["Foo", "tok-className"]
    ])
  })

  it("styles regexes, heredocs and Pod", () => {
    assert.deepStrictEqual(highlight("say /a b/, q:to/END/;\n  text\n  END\n=begin pod\nx\n=end pod"), [
      ["say", "tok-variableName"],
      ["/a b/", "tok-string2"],
      [",", "tok-punctuation"],
      ["q:to/END/", "tok-string"],
      [";", "tok-punctuation"],
      ["\n  text\n  END", "tok-string"],
      ["=begin pod", "tok-meta"],
      ["\nx\n", "tok-comment"],
      ["=end pod", "tok-meta"]
    ])
  })

  it("styles the directives, headings and formatting codes of Pod", () => {
    assert.deepStrictEqual(highlight("=begin pod\n=head1 Title\nSome B<bold> and C<code>, I<x> L<y> E<z>\n=end pod"), [
      ["=begin pod", "tok-meta"],
      ["\n", "tok-comment"],
      ["=head1", "tok-meta"],
      [" Title", "tok-comment tok-heading"],
      ["\nSome ", "tok-comment"],
      ["B<bold>", "tok-comment tok-strong"],
      // The class highlighter has no class for monospace text.
      [" and C<code>, ", "tok-comment"],
      ["I<x>", "tok-comment tok-emphasis"],
      [" ", "tok-comment"],
      ["L<y>", "tok-comment tok-link"],
      [" E<z>\n", "tok-comment"],
      ["=end pod", "tok-meta"]
    ])
  })

  it("styles a subscript in a string as part of the string", () => {
    assert.deepStrictEqual(highlight('"%h<k> $x.y()"'), [
      ['"', "tok-string"],
      ["%h", "tok-variableName"],
      ["<k> ", "tok-string"],
      ["$x", "tok-variableName"],
      [".", "tok-operator"],
      ["y", "tok-propertyName"],
      ["(", "tok-punctuation"],
      [")", "tok-punctuation"],
      ['"', "tok-string"]
    ])
  })

  // A keyword added to the grammar but not to styleTags would silently
  // stay unstyled.
  it("styles every keyword", () => {
    assert.deepStrictEqual(keywordNames().filter(name => !highlight(name).length), [])
  })
})

// The characters that can start a name are listed both in the grammar
// and in the external tokenizers.
describe("identifier characters", () => {
  it("are the same in the grammar and in the tokenizers", () => {
    let mismatched = []
    for (let code = 33; code < 0xd800; code++) {
      let ch = String.fromCharCode(code)
      let asWord = /^(Identifier|TypeName)$/.test(rakuLanguage.parser.parse(ch).topNode.firstChild?.name)
      let asMethod = rakuLanguage.parser.parse("." + ch).topNode.firstChild?.name == "MethodCall"
      if (asWord != asMethod) mismatched.push("U+" + code.toString(16))
    }
    assert.deepStrictEqual(mismatched, [])
  })
})

describe("fixtures", () => {
  let dir = path.join(caseDir, "fixtures")
  for (let file of fs.readdirSync(dir)) {
    it(`parses ${file} without errors`, () => {
      let code = fs.readFileSync(path.join(dir, file), "utf8"), errors = []
      rakuLanguage.parser.parse(code).iterate({enter(node) {
        if (node.type.isError) errors.push(code.slice(0, node.from).split("\n").length)
      }})
      assert.deepStrictEqual(errors, [], "error nodes on lines " + errors.join(", "))
    })
  }
})

// A token that looks more than 25 characters past its own end makes the
// parser record that, and keeps it from reusing the tokens before that
// point after an edit. Nothing in ordinary code should do so.
describe("lookahead", () => {
  let dir = path.join(caseDir, "fixtures")
  for (let file of fs.readdirSync(dir)) {
    it(`stays close to the tokens in ${file}`, () => {
      // Repeated, because the record ends up on the nodes that group
      // the top-level tokens of a long document.
      let code = fs.readFileSync(path.join(dir, file), "utf8").replace(/^=finish[^]*/m, "").repeat(8), found = []
      let walk = (node, start) => {
        if (!(node instanceof Tree)) return
        if (node.prop(NodeProp.lookAhead)) found.push(code.slice(0, start).split("\n").length)
        node.children.forEach((child, i) => walk(child, start + node.positions[i]))
      }
      walk(rakuLanguage.parser.parse(code), 0)
      assert.deepStrictEqual(found, [], "nodes that record a lookahead start on lines " + found.join(", "))
    })
  }
})

// The tokenizers keep state between tokens, which incremental parsing
// has to restore when it reuses parts of an old tree. Apply a series of
// small edits, and check that reparsing with the old tree gives the
// same tokens as parsing from scratch. Only the tokens are compared:
// around a syntax error, the two can recover into differently nested
// trees, and both are valid.
function tokens(tree) {
  let result = []
  tree.iterate({enter(node) {
    if (!node.type.isError && !node.node.firstChild) result.push(`${node.name}@${node.from}-${node.to}`)
  }})
  return result.join(" ")
}

describe("incremental parsing", () => {
  let snippets = ['"', "'", "{", "}", "(", ")", "[", "]", "<", ">", "/", "#", "$x", " ", "\n", ";", "q", "qq[", "q:c[", ":!s",
                  "=begin pod\n", "=end pod\n", ":to/END/", "END\n", "token ", "\\", "x ", "%h", ".", "=>", "~~ "]
  let dir = path.join(caseDir, "fixtures")
  for (let file of fs.readdirSync(dir)) {
    it(`matches a full parse after edits to ${file}`, function() {
      this.timeout(20000)
      // Repeated, so that the document is long enough for old nodes to be reused.
      let original = fs.readFileSync(path.join(dir, file), "utf8").replace(/^=finish[^]*/m, "").repeat(4)
      let doc = original, seed = 42
      let random = max => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % max
      let parser = rakuLanguage.parser
      let fragments = TreeFragment.addTree(parser.parse(doc))
      for (let i = 0; i < 200; i++) {
        // Start over now and then, before the edits pile up into one long string.
        if (i % 20 == 0) {
          doc = original
          fragments = TreeFragment.addTree(parser.parse(doc))
        }
        let from = random(doc.length + 1), to = from, insert = ""
        if (random(3) == 0) to = Math.min(doc.length, from + 1 + random(4))
        else insert = snippets[random(snippets.length)]
        doc = doc.slice(0, from) + insert + doc.slice(to)
        fragments = TreeFragment.applyChanges(fragments, [{fromA: from, toA: to, fromB: from, toB: from + insert.length}])
        let tree = parser.parse(doc, fragments)
        assert.strictEqual(tokens(tree), tokens(parser.parse(doc)),
                           `after edit ${i} at ${from}: ${JSON.stringify(insert)}`)
        fragments = TreeFragment.addTree(tree, fragments)
      }
    })
  }
})

// A heredoc's token depends on the quotes of the line before it, which
// the tokenizers' context carries to it.
describe("incremental parsing of heredocs", () => {
  let filler = "my $a = 1;\nsay $a + 2;\n".repeat(40)
  // The opener is far from the end of its line, so that an edit to it
  // leaves the tokens between it and the heredoc to be reused.
  let base = filler + "my $x = foo(1, 2, q:to/END/, 3, 4, " + "'padding', ".repeat(20) + "5);\n" +
    "  body { ' text\n  END\nsay 'after';\n" + filler
  let edits = {
    "renaming the terminator in the opener": ["END/", 3, "EOT"],
    "removing the adverb": [":to", 3, ""],
    "an edit earlier on the opener's line": ["foo(1", 3, "bar"],
    "commenting out the opener's line": ["my $x = foo", 0, "# "],
    "putting the opener in a string": ["q:to/END/", 9, '"q:to/END/"'],
    "a comment before the opener": ["q:to/END/", 0, "#`(x) "],
    "renaming the terminator": ["END\n", 3, "EOT"],
    "an edit in the body": ["body", 4, "x"]
  }
  for (let [name, [anchor, size, insert]] of Object.entries(edits)) {
    it(`matches a full parse after ${name}`, () => {
      let parser = rakuLanguage.parser, from = base.indexOf(anchor), to = from + size
      let doc = base.slice(0, from) + insert + base.slice(to)
      let fragments = TreeFragment.applyChanges(TreeFragment.addTree(parser.parse(base)),
                                                [{fromA: from, toA: to, fromB: from, toB: from + insert.length}])
      assert.strictEqual(tokens(parser.parse(doc, fragments)), tokens(parser.parse(doc)))
    })
  }
})

function stateFor(doc) {
  return EditorState.create({doc, extensions: raku()})
}

// The indentation computed for each line of `code`. The default indent
// unit is two spaces.
function indentation(code) {
  let state = stateFor(code), result = []
  for (let i = 1; i <= state.doc.lines; i++) result.push(getIndentation(state, state.doc.line(i).from))
  return result
}

describe("indentation", () => {
  // Checks that every line of `code` is indented the way it is written.
  function keeps(code) {
    return () => assert.deepStrictEqual(indentation(code), code.split("\n").map(line => /^ */.exec(line)[0].length))
  }

  it("indents blocks", keeps(`
class Foo {
  has $.x;
  method m {
    if $!x {
      say 1;
    }
    else {
      say 2;
    }
  }
}`))

  it("indents parentheses and brackets", keeps(`
my @a = [
  1,
  2,
];
foo(
  $a,
  $b
);
bar($a,
    $b);`))

  it("indents the body of a regex declaration", keeps(`
grammar G {
  token t {
    \\d+
    <word>
  }
}`))

  it("indents an interpolated block", keeps(`
say "a {
  $x
} b";`))

  it("indents in a block that is not closed", keeps(`
sub f {
  if $x {
    `))

  it("indents a line that continues after an operator", keeps(`
my $total = $price * $count +
  $shipping;
my $x = $a ??
  1 !!
  2;
sub f {
  return $a eq
    $b;
}
say 1;`))

  it("indents a line that starts with an operator or a method call", keeps(`
my @sorted = @items
  .grep(*.defined)
  .sort;
say $a
  ~ $b
  ~ $c;
if $a
  && $b {
  say 1;
}
sub f {
  return $x
    || 3;
}`))

  it("indents the lines of a list", keeps(`
my @list = 1,
  2,
  3;
sub f {
  say 'a',
    'b';
  say 2;
}`))

  it("does not indent after a statement that has ended", keeps(`
for @a {
  .say;
  .put
}
.say;
$i++
say 3;
say $x; # ends in +
-1;
!!! 'todo';
...
say 4;
sub g { }
.say;`))

  it("does not take a Pod block for part of a statement", () => {
    assert.deepStrictEqual(indentation("my $x = 1;\n=begin pod\ntext\n=end pod\nfor @a { }\n=head1 Title\n\n.say;"),
                           [0, 0, null, null, 0, 0, 0, 0])
  })

  it("does not indent the pairs of a hash in braces", keeps(`
my %h = {
  a => 1,
  b => 2,
};
f({
  :a,
  :b,
});`))

  it("only follows the brackets in parentheses and square brackets", keeps(`
foo(1 +
    2,
    3);
my @a = [
  1 +
  2,
  3,
];`))

  it("indents a block that opens on a continued line like its statement", keeps(`
if $a
  && $b {
  say 1;
}
my $f = $c ??
  sub {
    1
  } !! 2;
my @b = @a
  .map({
    $_ + 1
  });
say 1;
for @a
  -> $x {
  say 2;
}
sub g { }
if $a
  && foo(
    1
  ) {
  say 3;
}
class A {
  method m {
    say 4
  }
}
while $a
  || $b {
  say 5;
}`))

  it("indents after a subscript in braces, and after a comment", keeps(`
my $v = %h{$key}
  // 'default';
my %h = { # comment
  a => 1,
  b => 2,
};
my $n = $a
  eq $b;
sub f {
  say 2
    unless $z;
  say 3 + # comment
    4;
}`))

  // The text of these belongs to the program, so a line in them keeps
  // the indentation it has.
  it("leaves the lines of a heredoc alone", () => {
    assert.deepStrictEqual(indentation("sub f {\n  my $x = q:to/END/;\n      text\n      END\n  say $x;\n}"),
                           [0, 2, null, null, 2, 0])
  })

  it("leaves the lines of a Pod block alone", () => {
    assert.deepStrictEqual(indentation("sub f {\n  =begin pod\ntext\n  =end pod\n  say 1;\n}"),
                           [0, 2, null, null, 2, 0])
  })

  it("leaves the lines of a string and of an embedded comment alone", () => {
    assert.deepStrictEqual(indentation("sub f {\n  say 'a\nb';\n  #`(\nc\n  )\n  say 1;\n}"),
                           [0, 2, null, 2, null, null, 2, 0])
  })
})

describe("folding", () => {
  // The text that folding the given line hides, or null.
  function fold(code, lineNumber) {
    let state = stateFor(code), line = state.doc.line(lineNumber)
    let range = foldable(state, line.from, line.to)
    return range && state.sliceDoc(range.from, range.to)
  }

  it("folds blocks, parentheses and brackets", () => {
    assert.strictEqual(fold("sub f {\n  1\n}", 1), "\n  1\n")
    assert.strictEqual(fold("f(\n  1\n)", 1), "\n  1\n")
    assert.strictEqual(fold("my @a = [\n  1\n];", 1), "\n  1\n")
    assert.strictEqual(fold("sub f { 1 }\nsay 2", 1), null)
  })

  it("folds the body of a regex declaration", () => {
    assert.strictEqual(fold("token t {\n  \\d+\n}", 1), "\n  \\d+\n")
  })

  it("folds a Pod block after its first line", () => {
    assert.strictEqual(fold("=begin pod\ntext\n=end pod\nsay 1", 1), "\ntext\n=end pod")
  })

  it("folds a heredoc from the line of its opener", () => {
    assert.strictEqual(fold("say q:to/END/;\n  text\n  END\nsay 1", 1), "\n  text\n  END")
  })

  it("folds an embedded comment", () => {
    assert.strictEqual(fold("#`(\n  text\n)\nsay 1", 1), "(\n  text\n)")
  })
})

describe("block comments", () => {
  // The document after toggling a block comment on the part of `code`
  // between the two `|` marks.
  function toggle(code) {
    let from = code.indexOf("|"), to = code.lastIndexOf("|") - 1
    let state = EditorState.create({doc: code.replace(/\|/g, ""), selection: {anchor: from, head: to}, extensions: raku()})
    let result = null
    toggleBlockComment({state, dispatch: tr => result = tr.state.doc.toString()})
    return result
  }

  it("wraps a selection in an embedded comment", () => {
    assert.strictEqual(toggle("say 1; |say (2 + 3);| say 4;"), "say 1; #`( say (2 + 3); ) say 4;")
  })

  it("picks a bracket that the selection does not unbalance", () => {
    assert.strictEqual(toggle("f(|1) + g(2|)"), "f(#`[ 1) + g(2 ])")
    assert.strictEqual(toggle('|say "(";|'), '#`[ say "("; ]')
    assert.strictEqual(toggle("|) ] [ (|"), "#`{ ) ] [ ( }")
    assert.strictEqual(toggle("|) ] } > » 」|"), "#`(( ) ] } > » 」 ))")
    assert.strictEqual(toggle("|)) ]|"), "#`{ )) ] }")
  })

  it("makes a comment that covers exactly the selection", () => {
    for (let code of ["a |b) c| d", "a |( b| c", "a |) ] } (( b| c", "a |b| c"]) {
      let result = toggle(code), from = code.indexOf("|")
      let comment = rakuLanguage.parser.parse(result).resolveInner(from, 1)
      assert.strictEqual(comment.name, "BlockComment", code)
      assert.strictEqual(result.slice(comment.to), code.slice(code.lastIndexOf("|") + 1), code)
    }
  })

  it("removes a comment, whichever bracket it uses", () => {
    assert.strictEqual(toggle("say 1; |#`[ a) b ]| say 2;"), "say 1; a) b say 2;")
    assert.strictEqual(toggle("say 1; #`[ |a) b| ] say 2;"), "say 1; a) b say 2;")
    assert.strictEqual(toggle("|#`(( a ) b ))|"), "a ) b")
    assert.strictEqual(toggle("|#`『 a 』|"), "a")
    assert.strictEqual(toggle("|  #`[ a) ]\n|say 1"), "  a)\nsay 1")
    assert.strictEqual(toggle("x; |#`[ a) ] |y"), "x; a) y")
  })

  it("picks a fitting bracket for a part of a comment's text", () => {
    assert.strictEqual(toggle("#`[ a |[ b| ] c ]"), "#`[ a #`( [ b ) ] c ]")
  })

  it("picks a bracket that also fits the rest of the line", () => {
    assert.strictEqual(toggle("|a| )"), "#`[ a ] )")
    let state = EditorState.create({doc: "  a) b", selection: {anchor: 3, head: 6}, extensions: raku()})
    assert.deepStrictEqual(state.languageDataAt("commentTokens", 2, 1)[0].block, {open: "#`[", close: "]"})
  })

  it("gives the line comment token along with the block tokens", () => {
    let state = EditorState.create({doc: "a) b", selection: {anchor: 0, head: 4}, extensions: raku()})
    let tokens = state.languageDataAt("commentTokens", 0, 1)[0]
    assert.strictEqual(tokens.line, "#")
    assert.deepStrictEqual(tokens.block, {open: "#`[", close: "]"})
  })

  it("leaves the tokens alone where the language is used without its support", () => {
    let state = EditorState.create({doc: "a) b", selection: {anchor: 0, head: 4}, extensions: rakuLanguage})
    assert.deepStrictEqual(state.languageDataAt("commentTokens", 0), [{line: "#", block: {open: "#`(", close: ")"}}])
  })
})

describe("bracket matching", () => {
  // The text from the bracket at `at` through the one it matches.
  function match(code, at) {
    let state = stateFor(code), found = matchBrackets(state, at, 1)
    return found && found.matched ? state.sliceDoc(found.start.from, found.end.to) : null
  }

  it("matches the three kinds of brackets", () => {
    assert.strictEqual(match("f(1, [2, 3], { 4 })", 1), "(1, [2, 3], { 4 })")
    assert.strictEqual(match("f(1, [2, 3], { 4 })", 5), "[2, 3]")
    assert.strictEqual(match("f(1, [2, 3], { 4 })", 13), "{ 4 }")
  })

  it("skips brackets in strings, comments and regexes", () => {
    assert.strictEqual(match("{ ')' # }\n '}' }", 0), "{ ')' # }\n '}' }")
    assert.strictEqual(match("( /\\)/ )", 0), "( /\\)/ )")
  })

  it("matches the braces of a regex declaration and of an interpolation", () => {
    assert.strictEqual(match("token t { a ** {2} }", 8), "{ a ** {2} }")
    assert.strictEqual(match('"a { 1 } b"', 3), "{ 1 }")
  })
})

describe("completion", () => {
  // The labels offered at the `|` in `code`, or null when there is no
  // completion there.
  function complete(code, explicit = false) {
    let pos = code.indexOf("|"), state = stateFor(code.slice(0, pos) + code.slice(pos + 1))
    let [source] = state.languageDataAt("autocomplete", pos)
    let result = source(new CompletionContext(state, pos, explicit))
    if (!result) return null
    let typed = state.sliceDoc(result.from, pos)
    return result.options.map(option => option.label).filter(label => label.startsWith(typed))
  }

  it("completes keywords, types and routines", () => {
    assert.deepStrictEqual(complete("subm|"), ["submethod"])
    assert.deepStrictEqual(complete("my Rati|"), ["Rational"])
    assert.deepStrictEqual(complete("sprin|"), ["sprintf"])
    assert.deepStrictEqual(complete("my IO::Pa|"), ["IO::Path"])
    assert.deepStrictEqual(complete("{ els|"), ["elsif", "else"])
  })

  it("completes methods after a dot", () => {
    assert.deepStrictEqual(complete("$x.ele|"), ["elems"])
    assert.ok(complete("$x.|").includes("elems"))
    assert.ok(!complete("$x.e|").includes("elsif"))
    assert.strictEqual(complete("1..|"), null)
  })

  it("completes methods after a mutating dot", () => {
    assert.deepStrictEqual(complete("$x.=contai|"), ["contains"])
    assert.deepStrictEqual(complete("$x .= contai|"), ["contains"])
    assert.ok(complete("$x.=|").includes("elems"))
  })

  it("only completes after the dot of a number when asked to", () => {
    for (let code of ["1.|", "say 1.|", "use v6.|"]) {
      assert.strictEqual(complete(code), null, code)
      assert.ok(complete(code, true).includes("elems"), code)
    }
    assert.ok(complete("$n1.|").includes("elems"))
  })

  it("stops when the typed text is no longer a name", () => {
    let state = stateFor("f()"), {validFor} = state.languageDataAt("autocomplete", 2)[0](new CompletionContext(state, 2, true))
    for (let [text, valid] of [["", true], ["sa", true], ["IO::Pa", true], ["starts-w", true], [":sa", false], ["sa ", false]])
      assert.strictEqual(validFor.test(text), valid, text)
  })

  it("completes dynamic and compile-time variables", () => {
    assert.deepStrictEqual(complete("say %*E|"), ["%*ENV"])
    assert.deepStrictEqual(complete("say $?FI|"), ["$?FILE"])
    assert.ok(complete("say $*|").includes("$*OUT"))
  })

  // The names that are declared in the document.
  const scoped = `my $count = 1; my Int @items; our %registry;
sub outer($arg, :$named, *@rest) {
  my %seen;
  for @items -> $item, $index {
    say CURSOR
  }
}
sub other($elsewhere) { my $inner; state $kept }
`
  const at = text => complete(scoped.replace("CURSOR", text)).sort()

  it("completes the variables that are declared in scope", () => {
    assert.deepStrictEqual(at("$|"), ["$arg", "$count", "$index", "$item", "$named"])
    assert.deepStrictEqual(at("@|"), ["@items", "@rest"])
    assert.deepStrictEqual(at("%s|"), ["%seen"])
    assert.deepStrictEqual(at("%re|"), ["%registry"])
    assert.deepStrictEqual(at("$it|"), ["$item"])
    assert.deepStrictEqual(complete("my ($a, $b) = 1, 2; say $|").sort(), ["$a", "$b"])
    assert.deepStrictEqual(complete("my &callback = sub ($p) { say $| }; my $after;").sort(), ["$after", "$p"])
    assert.deepStrictEqual(complete('my $name; say "a { $n| } b"'), ["$name"])
  })

  it("completes the attributes of the class", () => {
    let code = "class A { has $.name; has Int $!secret; has @.list; method m { say CURSOR } }\nclass B { has $.b }"
    let at = text => complete(code.replace("CURSOR", text)).sort()
    assert.deepStrictEqual(at("$!|"), ["$!name", "$!secret"])
    assert.deepStrictEqual(at("$.|"), ["$.name"])
    assert.deepStrictEqual(at("@.l|"), ["@.list"])
    assert.deepStrictEqual(at("$|"), ["$!name", "$!secret", "$.name"])
  })

  it("completes declared routines, types and constants", () => {
    let code = "sub my-helper { }; class Widget { method spin { } }; constant LIMIT = 1; enum Shade <a b>; subset Small of Int;\n"
    assert.deepStrictEqual(complete(code + "my-h|"), ["my-helper"])
    assert.deepStrictEqual(complete(code + "Wid|"), ["Widget"])
    assert.deepStrictEqual(complete(code + "LIM|"), ["LIMIT"])
    assert.deepStrictEqual(complete(code + "my Sha|"), ["Shade"])
    assert.deepStrictEqual(complete(code + "my Sma|"), ["Small"])
    assert.deepStrictEqual(complete(code + "spi|"), [])
    assert.deepStrictEqual(complete("sub a { sub nested-one { } }; nested|"), [])
    assert.deepStrictEqual(complete("sub a { sub nested-one { }; nested| }"), ["nested-one"])
  })

  it("completes the methods of the document after a dot", () => {
    let code = "class Widget { method spin { }; method !hidden { }; submethod BUILD { } }\nsub spiral { }\n"
    assert.deepStrictEqual(complete(code + "$w.spi|"), ["spin"])
    assert.deepStrictEqual(complete(code + "$w.|").filter(label => /^spi|^BUILD|^hidden|^elems$/.test(label)).sort(),
                           ["BUILD", "elems", "spin"])
    assert.deepStrictEqual(complete(code + "$w .= spi|"), ["spin"])
  })

  it("offers a name once when it is both declared and built in", () => {
    for (let code of ["sub say { }; class Int { }; |", "class A { method elems { } }; $x.|"]) {
      let labels = complete(code, true)
      assert.deepStrictEqual(labels.filter((label, i) => labels.indexOf(label) != i), [], code)
    }
  })

  it("does not offer variables where one is being declared", () => {
    for (let code of ["my $count; my $c|", "my $count; my Int $c|", "my $count; sub f($c|", "my $count; for @a -> $c|",
                      "my $count; my ($a, $c|", "my $count; has $.c|", "my $count; f(-> $x, $c|"])
      assert.strictEqual(complete(code), null, code)
    assert.deepStrictEqual(complete("my $count; f($c|"), ["$count"])
    assert.deepStrictEqual(complete("my $count; my $x = $c|"), ["$count"])
    // The sigil alone, before a name is typed.
    for (let code of ["my $count; my $|", "my $count; sub f($|", "my $count; my ($a, $|", "my $count; for @a -> $|"])
      assert.strictEqual(complete(code), null, code)
  })

  it("offers variables in a default value, a constraint, and after the first declared one", () => {
    for (let code of ["my $count; sub f($a = $c|", "my $count; sub f($a where $c|", "my $count; my Int $a, $c|",
                      "my $count; my $a, $c|", "my $count; -> $x = $c|"])
      assert.deepStrictEqual(complete(code), ["$count"], code)
  })

  it("finds the parameters and variables of less plain declarations", () => {
    assert.deepStrictEqual(complete("for @a -> $x, :$named, *@rest { say $| }").sort(), ["$named", "$x"])
    assert.deepStrictEqual(complete("for @a -> $x is rw { say $| }"), ["$x"])
    assert.deepStrictEqual(complete("my $d; for @a -> $x = $d { say $| }").sort(), ["$d", "$x"])
    assert.deepStrictEqual(complete("sub f($a = $b, :$c where $e) { say $| }").sort(), ["$a", "$c"])
    assert.deepStrictEqual(complete("my Array[Int] @items; say @|"), ["@items"])
    assert.deepStrictEqual(complete("class A { has ($.a, $.b); method m { say $.| } }").sort(), ["$.a", "$.b"])
    assert.deepStrictEqual(complete("constant $LIMIT = 3; constant @list = 1, 2; say $L|"), ["$LIMIT"])
  })

  it("offers a routine with and without its sigil, and leaves operators out", () => {
    let code = "sub my-helper { }; sub infix:<+++>($a, $b) { };\n"
    assert.deepStrictEqual(complete(code + "say &my|"), ["&my-helper"])
    assert.deepStrictEqual(complete(code + "my-h|"), ["my-helper"])
    assert.deepStrictEqual(complete(code + "inf|"), [])
    assert.deepStrictEqual(complete(code + "say &inf|"), [])
  })

  // The parameters of a block are outside its node, so they are not
  // kept with the names that are cached for it.
  it("sees a change to the parameters of a block that is reused", () => {
    let body = "  my $local = 1;\n".repeat(400)
    let doc = "sub f($alpha, $beta) {\n" + body + "  say $\n}\n", pos = doc.lastIndexOf("$") + 1
    // A state only parses the start of a long document by itself.
    let parsed = state => {
      ensureSyntaxTree(state, state.doc.length, 1e4)
      return state.update({}).state
    }
    let state = parsed(stateFor(doc)), source = state.languageDataAt("autocomplete", pos)[0]
    let labels = state => source(new CompletionContext(state, pos, false)).options.map(option => option.label)
    assert.ok(labels(state).includes("$alpha"))
    let from = doc.indexOf("alpha")
    state = parsed(state.update({changes: {from, to: from + 5, insert: "omega"}}).state)
    assert.ok(labels(state).includes("$omega"))
    assert.ok(!labels(state).includes("$alpha"))
  })

  it("does not list variables for a sigil that is as often an operator", () => {
    assert.strictEqual(complete("my %h; my &f; $a %|"), null)
    assert.strictEqual(complete("my %h; my &f; $a &|"), null)
    assert.deepStrictEqual(complete("my %h; my &f; say %h|"), ["%h"])
    assert.strictEqual(complete("say $|"), null)
  })

  it("does not complete where a name is being made up", () => {
    assert.strictEqual(complete("my $sa|"), null)
    assert.strictEqual(complete("sub sa|"), null)
    assert.strictEqual(complete("class Int|"), null)
    assert.strictEqual(complete("f(:sa|"), null)
    assert.strictEqual(complete("self!sa|"), null)
    assert.strictEqual(complete("$x!sa|"), null)
    assert.strictEqual(complete("f()!sa|"), null)
    for (let code of ["say !defin|", "f(!defin|", "$x=!defin|", "$x !defin|"])
      assert.deepStrictEqual(complete(code), ["defined"], code)
    assert.strictEqual(complete("my $sa|", true), null)
    assert.strictEqual(complete("sub sa|", true), null)
  })

  it("does not complete in strings, comments, regexes, heredocs and Pod", () => {
    assert.strictEqual(complete("'sa|'"), null)
    assert.strictEqual(complete('"sa|"'), null)
    assert.strictEqual(complete("# sa|"), null)
    assert.strictEqual(complete("#`( sa| )"), null)
    assert.strictEqual(complete("/ sa| /"), null)
    assert.strictEqual(complete("say q:to/END/;\n  sa|\n  END\n"), null)
    assert.strictEqual(complete("=begin pod\nsa|\n=end pod\n"), null)
    assert.strictEqual(complete("'a |'", true), null)
    assert.strictEqual(complete("token t {|}", true), null)
    assert.strictEqual(complete("token t { |a }", true), null)
  })

  it("completes in the code of an interpolation", () => {
    assert.deepStrictEqual(complete('"a { sprin|'), ["sprintf"])
    assert.deepStrictEqual(complete('"a { sprin| } b"'), ["sprintf"])
  })

  it("only lists everything when asked to", () => {
    assert.strictEqual(complete("say 1; |"), null)
    assert.ok(complete("say 1; |", true).includes("say"))
    assert.ok(complete("|", true).includes("class"))
  })

  it("offers every keyword of the grammar", () => {
    let labels = new Set(complete("|", true))
    assert.deepStrictEqual(keywordNames().filter(name => !labels.has(name)), [])
  })

  it("offers each name once", () => {
    for (let code of ["|", "$x.|", "$*|"]) {
      let labels = complete(code, true)
      assert.deepStrictEqual(labels.filter((label, i) => labels.indexOf(label) != i), [])
    }
  })
})

// Only dist/index.* is published, so the declarations must not refer
// to the other files that the build leaves in dist.
describe("package", () => {
  it("has declarations that stand on their own", () => {
    let dist = path.join(caseDir, "../dist")
    let declarations = fs.readFileSync(path.join(dist, "index.d.ts"), "utf8")
    assert.deepStrictEqual(declarations.match(/["']\.\.?\/[^"']*["']/g), null)
    assert.strictEqual(fs.readFileSync(path.join(dist, "index.d.cts"), "utf8"), declarations)
  })
})

describe("language support", () => {
  it("exports a LanguageSupport factory", () => {
    let support = raku()
    assert.ok(support instanceof LanguageSupport)
    assert.strictEqual(support.language, rakuLanguage)
    assert.strictEqual(rakuLanguage.name, "raku")
  })

  it("declares its comment syntax", () => {
    // The first one is used. The second is the fixed one of the language.
    let [tokens, fixed] = stateFor("").languageDataAt("commentTokens", 0)
    assert.deepStrictEqual({line: tokens.line, block: tokens.block}, fixed)
    assert.deepStrictEqual(fixed, {line: "#", block: {open: "#`(", close: ")"}})
  })

  it("includes the completion source", () => {
    assert.ok(raku().support.includes(rakuCompletion))
    assert.strictEqual(EditorState.create({extensions: rakuLanguage}).languageDataAt("autocomplete", 0).length, 0)
  })
})
