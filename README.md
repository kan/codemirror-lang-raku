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
<dd><p>Raku language support, with completion, and with block comment
tokens that fit the selection (<code>#`[ … ]</code> around text that holds an
unbalanced parenthesis).</p></dd>
<dt><code><strong>rakuLanguage</strong>: LRLanguage</code></dt>
<dd><p>A language provider based on the Lezer Raku parser, extended with
highlighting and indentation information.</p></dd>
<dt><code><strong>rakuCompletion</strong>: Extension</code></dt>
<dd><p>Completion of Raku keywords, of the commonly used built-in types,
routines, methods and special variables, and of the variables, routines,
types and methods that the document declares. <code>raku()</code> includes it. To
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
| `RoutineDeclaration` | `sub`, `method`, `submethod`, with a `RoutineName` child (absent for anonymous routines), up to the body `Block`. Also the `foo(…) { }` of `multi foo(…) { }`, which declares a sub without the word `sub`: that node starts with its `RoutineName` |
| `RegexDeclaration` | `token`, `rule`, `regex`, with a `RegexName` child, up to the body `Block`, which holds one `Regex` |
| `EnumDeclaration`, `SubsetDeclaration`, `ConstantDeclaration` | The declarator and its `EnumName`, `SubsetName` or `ConstantName` |
| `Block`, `Parens`, `Brackets` | `{ }`, `( )`, `[ ]` |
| `VariableName`, `AttributeName`, `SpecialVariable` | `$x` / `$^a`, `$!x` / `$.x`, `$*x` / `$?x` |
| `StringLiteral` | A quote of any kind. One that interpolates has `Escape`, `Interpolation`, variable, `Brackets`, `Parens` and `MethodCall` children |
| `Heredoc` | The text of a heredoc, from the line after its `q:to/END/` opener through its terminator. The opener is a `StringLiteral` |
| `Regex` | `/…/`, `rx//`, `m//`, `s///`, `tr///`, or the body of a regex declaration. In a declaration, its children are `CharacterClass` (`<[a..z]>`), `Assertion` (`<name>`, `<?before …>`), `StringLiteral`, `Escape` (`\d`), `Operator` (quantifiers, `\|`, anchors), `VariableName` (`$x`, `$<name>`), `LineComment`, and a `Block` for each `{ }` of code |
| `LineComment`, `DocComment`, `BlockComment` | `#`, `#|` / `#=`, `` #`( ) `` |
| `Pod` | `=begin` … `=end` and the other Pod blocks. Its children are `PodDirective` (`=begin`, `=head1`, `=end pod`), `PodHeading` (the text after `=head1`), and the formatting codes `PodStrong` (`B<…>`), `PodEmphasis` (`I<…>`), `PodCode` (`C<…>`), `PodLink` (`L<…>`) and `PodFormat` (the others) |

Each declarator keyword is a child node named after the keyword (`class`,
`sub`, `token`, …). The words `unit`, `multi`, `proto`, `only`, `my` and
`our` are not part of the declaration node. They are the nodes right
before it, also in `multi foo(…) { }`, where the declaration node has no
declarator keyword.

## Known limitations

Not supported yet:

- Nothing is highlighted inside a regex literal (`/…/`, `rx//`, `m//`,
  `s///`): it is a single `Regex` token, including any code in it.
- In the body of a `token` / `rule` / `regex` declaration, a `<…>` is one
  token, with the code or the nested `<…>` in it, and has to be closed on
  its line unless it is a character class. Groups (`[ ]`, `( )`) and
  adverbs (`:i`, `:my`) are plain text, so the text after `:my` is read
  as regex.
- Nothing is highlighted inside a heredoc: there is no interpolation in
  a `qq:to` heredoc.
- In Pod, a formatting code is one token: the codes inside it
  (`B<I<…>>`) are not told apart. Formatting codes are left alone in a
  block that is code (`=begin code`, `=code`, `=for code`), but not in a
  code block inside another block, nor in an indented code paragraph.
  Tables and the configuration after a directive (`:numbered`) are plain
  text.
- A `<<…>>` or `«…»` word list that spans lines and holds `{ }`, `( )` or
  `;` is not taken to be a word list, and neither is one in a subscript
  or after a pair key (`%h«$key»`, `:a<<b $c>>`). Nothing is interpolated
  in one that is longer than 24 characters, or that holds an unbalanced
  `{` or its own delimiter: it is a single token.
- A Pod block is read where a statement or a term can stand, not
  everywhere that whitespace can: one between `class` and the name of
  the class is not read as Pod.
- A quote adverb is switched off by the argument `False` or `0`, as in
  `qq:c(False)[…]`. With any other argument, such as a variable, it
  counts as switched on.
- The brackets of a block comment are picked for the `toggleBlockComment`
  command. Text that unbalances every bracket that is tried gets
  `` #`( `` … `)`, which then does not cover exactly that text.
- A user-defined operator is recognized where it is declared
  (`sub infix:<+++>`) and as a routine (`&infix:<+++>`), not where it is
  used as an operator.
- Completion does not know types. After a `.` it offers the built-in
  methods and every method that the document declares, whatever the
  invocant is. Names from other files are not offered.
- Completion takes a variable to be declared by `my`, `our`, `state` or
  `has`, in a signature, or after the `->` of a pointy block. Placeholder
  variables (`$^a`) and sigilless variables (`my \x`) are not offered.
- In a string, only the code in `{ }` and in a subscript is completed,
  not the method name of `"$x.name()"`.

Heuristics that can be wrong:

- A line is indented as the continuation of a statement when the line
  before it ends in an operator or a comma, or when it starts with a
  method call or with an operator that has a space after it. A statement
  that continues in another way, as in a trait on its own line
  (`sub f($a)` / `is export {`), is not indented further. Inside `( )`
  and `[ ]`, indentation follows the brackets only.
- A capitalized word is taken to be a type name.
- Whether `/` starts a regex and `<` starts a word list is decided from
  the token before it. After a bare name, spacing decides: `say /x/` and
  `say <a b>` are a regex and a word list, `foo / 2` and `n < 3` are not.
  The built-in terms `pi`, `π`, `tau`, `τ`, `now`, `time` and `rand` are
  followed by an operator whatever the spacing (`pi /2`), also when a
  routine of your own has one of these names. After a closing brace, a
  line break decides.
- A `<…>` right after a term is a subscript only when it holds plain words
  on one line: `%h<key>`, but not `$a<$b`.
- `q`, `qq`, `Q`, `m`, `rx`, `s`, `tr` and their variants start a quote
  when a delimiter follows directly, so a sigilless `s/2` is misread.
  `q`, `qq` and `Q` also take a bracket after blanks (`q {…}`), so a
  routine or a sigilless variable of your own named `q`, before a block
  or a subscript, is misread. The
  regex words do not: `m {…}` and `s {…}` are calls.
- `%name` and `&name` are variables, except between two terms with no
  space on either side: `$a%b`.
- After `multi`, `proto` or `only`, a name is taken to declare a sub when
  a `(` or a `{` follows it, on the same line or the next:
  `multi foo($x) { }`. One that follows a comment or more than 20
  characters of whitespace is not seen, and a call such as `only foo(1)`, of a
  routine of your own that is named `only`, is read as a declaration.
- A word spelled like a keyword is a keyword wherever it appears, except
  as a method name, as a declared name, before `=>`, and for the
  keywords that are routines (`take`, `return`, `next`, `not`, …) right
  before a `(`: `take(1)`. A sigilless variable or a routine of your own
  that is named like a keyword is highlighted as one.
- A quote that does not interpolate (`'…'`, `q{…}`), a regex and a
  heredoc have to be closed. Otherwise their opener is read as ordinary
  code.
- A quote that interpolates (`"…`, `qq[…`), a Pod block or an embedded
  comment that is not closed runs to the end of the document.
- The body of a regex declaration that is not closed runs up to the next
  line that starts a `token`, `rule` or `regex` declaration, or to the
  end of the document.

## Development

```sh
npm install
npm test     # builds, then runs the tests in test/
npm run dev  # serves demo/, an editor next to the syntax tree of its content
```

The demo loads the sources, so a change to the grammar shows up on reload.

## License

[MIT](LICENSE)
