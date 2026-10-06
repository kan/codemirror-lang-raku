import {raku, rakuLanguage} from "../dist/index.js"
import {fileTests} from "@lezer/generator/dist/test"
import {LanguageSupport} from "@codemirror/language"
import {classHighlighter, highlightTree} from "@lezer/highlight"

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

describe("language support", () => {
  it("exports a LanguageSupport factory", () => {
    let support = raku()
    assert.ok(support instanceof LanguageSupport)
    assert.strictEqual(support.language, rakuLanguage)
    assert.strictEqual(rakuLanguage.name, "raku")
  })
})
