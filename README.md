# codemirror-lang-raku

[![npm version](https://img.shields.io/npm/v/codemirror-lang-raku)](https://www.npmjs.com/package/codemirror-lang-raku)
[![Test](https://github.com/kan/codemirror-lang-raku/actions/workflows/test.yml/badge.svg)](https://github.com/kan/codemirror-lang-raku/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/npm/l/codemirror-lang-raku)](LICENSE)

[Raku](https://raku.org/) (formerly Perl 6) language support for the
[CodeMirror 6](https://codemirror.net/) code editor: syntax highlighting,
indentation, code folding, bracket matching and completion, built on a
[Lezer](https://lezer.codemirror.net/) grammar.

It covers comments and Pod, quotes of all kinds (`'…'`, `"…"`, `q` / `qq` /
`Q` with any delimiter, heredocs, `<word lists>`) with interpolation,
regexes, numbers, variables with sigils and twigils, keywords, operators,
blocks and declarations.

Try it in the [demo](https://kan.github.io/codemirror-lang-raku/), which
shows the syntax tree next to the editor.

> **Status: 0.x.** The node names of the syntax tree can still change
> between minor versions. See [Known limitations](#known-limitations) for
> what is missing.

## Installation

```sh
npm install codemirror-lang-raku
```

## Usage

```javascript
import {EditorView, basicSetup} from "codemirror"
import {raku} from "codemirror-lang-raku"

new EditorView({
  doc: 'say "Hello, Raku!";',
  extensions: [basicSetup, raku()],
  parent: document.body
})
```

Highlighting uses only the standard tags of `@lezer/highlight`, so any
CodeMirror theme or highlight style applies.

To load the language on demand, the way `@codemirror/language-data` does:

```javascript
import {LanguageDescription} from "@codemirror/language"

const rakuDescription = LanguageDescription.of({
  name: "Raku",
  alias: ["perl6"],
  extensions: ["raku", "rakumod", "rakutest", "rakudoc", "p6", "pl6", "pm6", "pod6"],
  load: () => import("codemirror-lang-raku").then(m => m.raku())
})
```

## API Reference

<dl>
<dt><code><strong>raku</strong>() → LanguageSupport</code></dt>
<dd><p>Raku language support, with completion.</p></dd>
<dt><code><strong>rakuLanguage</strong>: LRLanguage</code></dt>
<dd><p>A language provider based on the Lezer Raku parser, extended with
highlighting and indentation information.</p></dd>
<dt><code><strong>rakuCompletion</strong>: Extension</code></dt>
<dd><p>Completion of Raku keywords and of the commonly used built-in types,
routines, methods and special variables. <code>raku()</code> includes it. To
leave it out, use <code>rakuLanguage</code> in place of <code>raku()</code>.</p></dd>
<dt><code><strong>parser</strong>: LRParser</code></dt>
<dd><p>The Lezer parser for Raku, without the editor-specific node props.
Use <code>rakuLanguage.parser</code> for the configured one.</p></dd>
</dl>

## Syntax tree

The grammar does not parse statements and expressions. It tokenizes the
input, nests brackets, and recognizes declarations, which is enough for
highlighting, folding and building an outline, and keeps the tree usable
on incomplete code.

| Node | Covers |
|---|---|
| `PackageDeclaration` | `class`, `role`, `grammar`, `module`, `package`, with a `PackageName` child, up to the body `Block` or the `;` of a `unit` declaration |
| `RoutineDeclaration` | `sub`, `method`, `submethod`, with a `RoutineName` child (absent for anonymous routines), up to the body `Block` |
| `RegexDeclaration` | `token`, `rule`, `regex`, with a `RegexName` child, up to the body `Block`, which holds one `Regex` |
| `EnumDeclaration`, `SubsetDeclaration`, `ConstantDeclaration` | The declarator and its `EnumName`, `SubsetName` or `ConstantName` |
| `Block`, `Parens`, `Brackets` | `{ }`, `( )`, `[ ]` |
| `VariableName`, `AttributeName`, `SpecialVariable` | `$x` / `$^a`, `$!x` / `$.x`, `$*x` / `$?x` |
| `StringLiteral` | A quote of any kind. One that interpolates has `Escape`, `Interpolation`, variable, `Brackets`, `Parens` and `MethodCall` children |
| `Heredoc` | The text of a heredoc, from the line after its `q:to/END/` opener through its terminator. The opener is a `StringLiteral` |
| `Regex` | `/…/`, `rx//`, `m//`, `s///`, `tr///`, or the body of a regex declaration |
| `LineComment`, `DocComment`, `BlockComment`, `Pod` | `#`, `#|` / `#=`, `` #`( ) ``, `=begin` … `=end` and the other Pod blocks |

Each declarator keyword is a child node named after the keyword (`class`,
`sub`, `token`, …). The words `unit`, `multi`, `proto`, `my` and `our` are
not part of the declaration node. They are the nodes right before it.

## Known limitations

Not supported yet:

- Nothing is highlighted inside a regex. A regex literal, and the body of
  a `token` / `rule` / `regex` declaration, is a single `Regex` token,
  including any code blocks in it.
- Nothing is highlighted inside a heredoc, a `<<…>>` / `«…»` word list or
  a Pod block: no interpolation, no Pod formatting codes.
- A quote adverb that is switched off through its argument, as in
  `qq:c(False)[…]`, counts as switched on.
- `multi`, `proto` and `only` declarations without `sub` or `method` are
  not declaration nodes.
- A user-defined operator is recognized where it is declared
  (`sub infix:<+++>`) and as a routine (`&infix:<+++>`), not where it is
  used as an operator.
- Indentation follows brackets only. A statement continued on the next
  line is not indented further.
- Completion offers a fixed list of names. It does not offer the
  variables, routines and classes of the document, and after a `.` it
  offers the same methods whatever the type of the invocant. In a
  string, only the code in `{ }` and in a subscript is completed, not
  the method name of `"$x.name()"`.
- Toggling a block comment wraps the selection in `` #`( `` … `)`. When
  the parentheses in the selection are not balanced, the comment ends
  early or runs on past the selection.

Heuristics that can be wrong:

- A capitalized word is taken to be a type name.
- Whether `/` starts a regex and `<` starts a word list is decided from
  the token before it. After a bare name, spacing decides: `say /x/` and
  `say <a b>` are a regex and a word list, `pi / 2` and `n < 3` are not.
  After a closing brace, a line break decides.
- A `<…>` right after a term is a subscript only when it holds plain words
  on one line: `%h<key>`, but not `$a<$b`.
- `q`, `qq`, `Q`, `m`, `rx`, `s`, `tr` and their variants start a quote
  when a delimiter follows directly, so a sigilless `s/2` is misread, and
  `q {…}` with a space is not a quote.
- `%name` and `&name` are variables, except between two terms with no
  space on either side: `$a%b`.
- A word spelled like a keyword is a keyword wherever it appears, except
  as a method name, as a declared name, or before `=>`: `take(1)` is
  highlighted as a keyword.
- What happens to an unclosed construct depends on its kind. The opener
  of a quote that does not interpolate (`'…'`, `q`), of a regex or of a
  heredoc is read as ordinary code. A `"…"` or `qq` quote, a Pod block,
  an embedded comment or the body of a regex declaration runs to the end
  of the document.

## Development

```sh
npm install
npm test     # builds, then runs the tests in test/
npm run dev  # serves demo/, an editor next to the syntax tree of its content
```

The demo loads the sources, so a change to the grammar shows up on reload.

## License

[MIT](LICENSE)
