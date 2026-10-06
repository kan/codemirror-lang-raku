import {raku, rakuLanguage, rakuCompletion} from "../dist/index.js"
import {fileTests} from "@lezer/generator/dist/test"
import {LanguageSupport, getIndentation, foldable, matchBrackets} from "@codemirror/language"
import {EditorState} from "@codemirror/state"
import {CompletionContext} from "@codemirror/autocomplete"
import {classHighlighter, highlightTree} from "@lezer/highlight"
import {TreeFragment} from "@lezer/common"

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
      ["=begin pod\nx\n=end pod", "tok-comment"]
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
  let snippets = ['"', "'", "{", "}", "(", ")", "[", "]", "<", ">", "/", "#", "$x", " ", "\n", ";", "q", "qq[",
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

// A heredoc is found from the text of the line before it, which the
// parser does not know the heredoc's token depends on.
describe("incremental parsing of heredocs", () => {
  let filler = "my $a = 1;\nsay $a + 2;\n".repeat(40)
  let base = filler + "my $x = foo(1, 2, q:to/END/, 3, 4);\n  body { ' text\n  END\nsay 'after';\n" + filler
  let edits = {
    "renaming the terminator in the opener": ["END/", 3, "EOT"],
    "removing the adverb": [":to", 3, ""],
    "an edit earlier on the opener's line": ["foo(1", 3, "bar"],
    "commenting out the opener's line": ["my $x = foo", 0, "# "],
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
    assert.deepStrictEqual(stateFor("").languageDataAt("commentTokens", 0),
                           [{line: "#", block: {open: "#`(", close: ")"}}])
  })

  it("includes the completion source", () => {
    assert.ok(raku().support.includes(rakuCompletion))
    assert.strictEqual(EditorState.create({extensions: rakuLanguage}).languageDataAt("autocomplete", 0).length, 0)
  })
})
