import {parser as grammarParser} from "./syntax.grammar"
import {LRParser} from "@lezer/lr"
import {LRLanguage, LanguageSupport, indentNodeProp, foldNodeProp, foldInside, delimitedIndent} from "@codemirror/language"
import {styleTags, tags as t} from "@lezer/highlight"

/// The Lezer parser for Raku, without the editor-specific node props.
export const parser: LRParser = grammarParser

/// A language provider based on the Lezer Raku parser, extended with
/// highlighting and indentation information.
export const rakuLanguage = LRLanguage.define({
  name: "raku",
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        "Block Interpolation": delimitedIndent({closing: "}"}),
        Parens: delimitedIndent({closing: ")"}),
        Brackets: delimitedIndent({closing: "]"})
      }),
      foldNodeProp.add({
        "Block Parens Brackets": foldInside,
        BlockComment(tree) { return {from: tree.from + 2, to: tree.to} },
        // Keep the first line, which holds the directive, visible.
        Pod(tree, state) { return {from: state.doc.lineAt(tree.from).to, to: tree.to} },
        // A heredoc starts with the line break before its first line.
        Heredoc(tree) { return {from: tree.from, to: tree.to} }
      }),
      styleTags({
        "my our has state temp let constant anon augment supersede unit multi proto only": t.definitionKeyword,
        "class role grammar module package sub method submethod token rule regex enum subset": t.definitionKeyword,
        "if elsif else unless with orwith without for while until loop repeat given when default": t.controlKeyword,
        "do gather take try return next last redo proceed succeed react whenever supply emit start": t.controlKeyword,
        "BEGIN CHECK INIT END ENTER LEAVE KEEP UNDO FIRST NEXT LAST PRE POST CATCH CONTROL QUIT CLOSE DOC": t.controlKeyword,
        "use need import require no": t.moduleKeyword,
        "is does of returns handles where will trusts hides": t.modifier,
        "and or not xor so andthen orelse notandthen div mod gcd lcm": t.operatorKeyword,
        "eq ne lt gt le ge cmp leg eqv but": t.operatorKeyword,
        self: t.self,
        "True False": t.bool,
        Nil: t.null,
        Identifier: t.function(t.variableName),
        TypeName: t.typeName,
        PackageName: t.definition(t.className),
        "EnumName SubsetName": t.definition(t.typeName),
        ConstantName: t.definition(t.constant(t.variableName)),
        "RoutineName RegexName": t.function(t.definition(t.variableName)),
        MethodName: t.function(t.propertyName),
        VariableName: t.variableName,
        AttributeName: t.propertyName,
        SpecialVariable: t.special(t.variableName),
        PairKey: t.attributeName,
        Number: t.number,
        Version: t.literal,
        "StringLiteral Heredoc": t.string,
        Regex: t.regexp,
        Pod: t.docComment,
        Escape: t.escape,
        "Interpolation/{ Interpolation/}": t.special(t.brace),
        LineComment: t.lineComment,
        BlockComment: t.blockComment,
        DocComment: t.docComment,
        Operator: t.operator,
        ".": t.derefOperator,
        ", ;": t.separator,
        ":": t.punctuation,
        "( )": t.paren,
        "[ ]": t.squareBracket,
        "{ }": t.brace
      })
    ]
  }),
  languageData: {
    commentTokens: {line: "#"},
    closeBrackets: {brackets: ["(", "[", "{", "'", '"', "「"]},
    indentOnInput: /^\s*[\}\]\)]$/
  }
})

/// Raku language support.
export function raku() {
  return new LanguageSupport(rakuLanguage)
}
