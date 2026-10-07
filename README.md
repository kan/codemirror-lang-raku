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
| `RegexDeclaration` | `token`, `rule`, `regex`, with a `RegexName` child, up to the body `Block`, which holds one `Regex`. The name includes a `:sym<…>`, with the blanks before it if there are any (`word :sym<long>`) |
| `EnumDeclaration`, `SubsetDeclaration`, `ConstantDeclaration` | The declarator and its `EnumName`, `SubsetName` or `ConstantName`. The name of a constant includes its sigil if it has one (`constant $LIMIT`). A constant without a sigil that is declared with a backslash (`constant \x`) has no `ConstantName` |
| `Block`, `Parens`, `Brackets` | `{ }`, `( )`, `[ ]` |
| `VariableName`, `AttributeName`, `SpecialVariable` | `$x` / `$^a`, `$!x` / `$.x`, `$*x` / `$?x` |
| `StringLiteral` | A quote of any kind. One that interpolates has `Escape`, `Interpolation`, variable, `Brackets`, `Parens` and `MethodCall` children, and a `NestedDelimiters` for each pair of its own delimiters in it (the `[b]` of `qq[a [b] c]`) |
| `Heredoc` | The text of a heredoc, from the line after its `q:to/END/` opener through its terminator. The opener is a `StringLiteral`. The text of a `qq:to` heredoc has the same children as a string that interpolates. The texts of the heredocs that one line opens are a single node |
| `Regex` | `/…/`, `rx//`, `m//`, `s///`, `tr///`, or the body of a regex declaration. Its children are `CharacterClass` (`<[a..z]>`), `Assertion` (`<name>`, `<?before …>`), `StringLiteral`, `Escape` (`\d`), `Operator` (quantifiers, `\|`, anchors), `VariableName` (`$x`, `$<name>`), `LineComment`, and a `Block` for each `{ }` of code |
| `LineComment`, `DocComment`, `BlockComment` | `#`, `#|` / `#=`, `` #`( ) `` |
| `Pod` | `=begin` … `=end` and the other Pod blocks. Its children are `PodDirective` (`=begin`, `=head1`, `=end pod`), `PodHeading` (the text after `=head1`), and the formatting codes `PodStrong` (`B<…>`), `PodEmphasis` (`I<…>`), `PodCode` (`C<…>`), `PodLink` (`L<…>`) and `PodFormat` (the others) |

Each declarator keyword is a child node named after the keyword (`class`,
`sub`, `token`, …). The words `unit`, `multi`, `proto`, `only`, `my` and
`our` are not part of the declaration node. They are the nodes right
before it, also in `multi foo(…) { }`, where the declaration node has no
declarator keyword.

## Known limitations

Not supported yet:

- Nothing is highlighted in the replacement of `s/…/…/`, nor in
  `tr/…/…/`.
- In a regex, a `<…>` is one
  token, with the code or the nested `<…>` in it, and has to be closed on
  its line unless it is a character class. Groups (`[ ]`, `( )`) and
  adverbs (`:i`, `:my`) are plain text, so the text after `:my` is read
  as regex, and so is the code in `$( … )`. Such code does not end the
  regex when it holds the delimiter (`/ :my $m = $/; /`), if it is on
  one line.
- A heredoc is interpolated when everything interpolates in it, as in
  `qq:to`. One that interpolates in part (`q:c:to`, `qq:!s:to`) is not
  highlighted inside. When a line opens several heredocs, they are
  interpolated only if all of them are. A `{` that is not closed in the
  text takes the rest of the heredoc, with its terminator, for code.
- In Pod, a formatting code is one token: the codes inside it
  (`B<I<…>>`) are not told apart. Formatting codes are left alone in a
  block that is code (`=begin code`, `=code`, `=for code`), but not in a
  code block inside another block, nor in an indented code paragraph.
  Tables and the configuration after a directive (`:numbered`) are plain
  text.
- A `<<…>>` or `«…»` word list that holds `{ }`, `( )` or `;` can span up
  to 10 lines. A longer one is not taken to be a word list. Nothing is
  interpolated in a list that holds an unbalanced `{` or its own
  delimiter: it is a single token.
- A Pod block is read where a statement or a term can stand, not
  everywhere that whitespace can: one between `class` and the name of
  the class is not read as Pod.
- In a quote that has braces for delimiters, a `{ }` is taken to be a
  nested pair of the delimiters, not a block of code: the `{$b + 1}` of
  `qq{a {$b + 1} c}` is text, in which `$b` is interpolated. With other
  delimiters, as in `qq[a {$b + 1} c]`, it is a block.
- A quote adverb is switched off by the argument `False` or `0`, as in
  `qq:c(False)[…]`. With any other argument, such as a variable, it
  counts as switched on.
- The brackets of a block comment are picked for the `toggleBlockComment`
  command. Text that unbalances every bracket that is tried gets
  `` #`( `` … `)`, which then does not cover exactly that text.
- A user-defined operator is recognized where it is declared
  (`sub infix:<+++>`) and as a routine (`&infix:<+++>`). Where it is
  used, it is an operator when it is made of operator characters or of
  symbols outside of ASCII (`1 ⚡ 2`). One that is a word is a plain
  name, also between hyper marks (`@a »plus« @b`), and a term or a
  circumfix of one's own is not known.
- The `native` declarator, which NativeCall uses internally, does not
  make a declaration node.
- Completion does not know types. After a `.` it offers the built-in
  methods and every method that the document declares, whatever the
  invocant is. Names from other files are not offered.
- Completion takes a variable to be declared by `my`, `our`, `state` or
  `has`, in a signature, after the `->` of a pointy block, or by being a
  placeholder variable (`$^a`, `$:a`). A sigilless variable is offered
  when it is declared with a backslash (`my \x`, `sub f(\x)`, `-> \x`),
  not as a term (`my constant x`, `sub term:<x>`).
- In a string, only the code in `{ }` and in a subscript is completed,
  not the method name of `"$x.name()"`.

Heuristics that can be wrong:

- A line is indented as the continuation of a statement when the line
  before it ends in an operator or a comma, or when it starts with a
  method call, with an operator that has a space after it, or with a
  trait (`is`, `does`, `returns`, `handles`, `where`, `will`, as in
  `is export {`). A statement that continues in another way is not
  indented further. A line that starts with one of these words for
  another reason, such as a call of the `is` of `Test`, is indented when
  the line before it does not end in a `;` or a `}`. Inside `( )` and
  `[ ]`, indentation follows the brackets only.
- A capitalized word is taken to be a type name.
- Whether `/` starts a regex and `<` starts a word list is decided from
  the token before it. After a bare name, spacing decides: `say /x/` and
  `say <a b>` are a regex and a word list, `foo / 2` and `n < 3` are not.
  The built-in terms `pi`, `π`, `tau`, `τ`, `now`, `time` and `rand` are
  followed by an operator whatever the spacing (`pi /2`), also when a
  routine of your own has one of these names. After a closing brace, a
  line break decides.
- A `<…>` right after a term is a subscript only when it holds plain words
  on one line: `%h<key>`, but not `$a<$b`. A `<<…>>` or `«…»` that touches
  the term before it is a subscript when it is at most 24 characters
  long and starts and ends in a word, a variable or a quote: `%h«$key»`,
  but not the hyper operators of `@a<<+>>@b` and `@a«R-»@b`. A hyper
  operator that is a word and touches both of its operands, as in
  `@a<<min>>@b`, is misread as a subscript.
- A `<<` or `«` where a term is expected starts a word list when a `>>`
  or `»` follows, within 10 lines if there is a `{ }`, `( )` or `;` in
  between. One that is being typed takes the code up to there for its
  content.
- In a `<<…>>` word list, a `>>` in a subscript or a call that is
  interpolated ends the list: `<<@a[1 >> 2]>>`. A heredoc that is opened
  in a block in a word list or in a regex literal is not read as one.
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

To release a version:

1. Run `npm version 1.2.3 --no-git-tag-version`, and turn the
   `## Unreleased` heading of `CHANGELOG.md` into `## 1.2.3 (2026-01-31)`.
   Commit and push.
2. Run `npm publish` from that commit. It first runs the tests and checks
   that `CHANGELOG.md` has that section and that nothing is uncommitted.
3. Tag that commit `v1.2.3` and push the tag. A workflow then checks that
   the tag matches `package.json` and that npm has the version, published
   from that commit, and creates the GitHub release from the section of
   `CHANGELOG.md`.

## License

[MIT](LICENSE)
