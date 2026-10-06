import {raku, rakuLanguage} from "../dist/index.js"
import {fileTests} from "@lezer/generator/dist/test"
import {LanguageSupport} from "@codemirror/language"
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
    let unstyled = []
    for (let type of rakuLanguage.parser.nodeSet.types) {
      if (!/^\w+$/.test(type.name)) continue
      let tree = rakuLanguage.parser.parse(type.name)
      if (tree.topNode.firstChild?.name != type.name) continue
      if (!highlight(type.name).length) unstyled.push(type.name)
    }
    assert.deepStrictEqual(unstyled, [])
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

describe("language support", () => {
  it("exports a LanguageSupport factory", () => {
    let support = raku()
    assert.ok(support instanceof LanguageSupport)
    assert.strictEqual(support.language, rakuLanguage)
    assert.strictEqual(rakuLanguage.name, "raku")
  })
})
