import {parser as grammarParser} from "./syntax.grammar"
import {LRParser} from "@lezer/lr"
import {LRLanguage, LanguageSupport, indentNodeProp, foldNodeProp, foldInside, delimitedIndent} from "@codemirror/language"
import {styleTags, tags as t} from "@lezer/highlight"
import {Extension} from "@codemirror/state"
import {rakuCompletionSource} from "./complete"
import {keywordTags} from "./keywords"
import {statementIndent, topIndent} from "./indent"
import {embeddedCommentTokens} from "./comment"

/// The Lezer parser for Raku, without the editor-specific node props.
export const parser: LRParser = grammarParser

/// A language provider based on the Lezer Raku parser, extended with
/// highlighting and indentation information.
export const rakuLanguage = LRLanguage.define({
  name: "raku",
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        Program: topIndent,
        "Block Interpolation": statementIndent("}"),
        Parens: delimitedIndent({closing: ")"}),
        Brackets: delimitedIndent({closing: "]"}),
        // The lines of these are text, which keeps its indentation.
        "StringLiteral Heredoc Pod BlockComment": () => null
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
        ...keywordTags,
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
        CharacterClass: t.character,
        Assertion: t.function(t.variableName),
        "Pod PodFormat": t.docComment,
        PodDirective: t.meta,
        // These are still part of a comment, and are styled as one where
        // a theme has no style for the second tag.
        PodHeading: [t.docComment, t.heading],
        PodStrong: [t.docComment, t.strong],
        PodEmphasis: [t.docComment, t.emphasis],
        PodCode: [t.docComment, t.monospace],
        PodLink: [t.docComment, t.link],
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
    // An embedded comment can use any bracket. Parentheses are the usual choice.
    commentTokens: {line: "#", block: {open: "#`(", close: ")"}},
    closeBrackets: {brackets: ["(", "[", "{", "'", '"', "「"]},
    indentOnInput: /^\s*[\}\]\)]$/
  }
})

/// Completion of Raku keywords, of the commonly used built-in types,
/// routines, methods and special variables, and of the names that the
/// document declares.
export const rakuCompletion: Extension = rakuLanguage.data.of({autocomplete: rakuCompletionSource})

/// Raku language support, with completion, and with block comment
/// tokens that fit the selection.
export function raku() {
  return new LanguageSupport(rakuLanguage, [rakuCompletion, embeddedCommentTokens(rakuLanguage)])
}
