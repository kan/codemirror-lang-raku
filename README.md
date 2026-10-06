# codemirror-lang-raku

[Raku](https://raku.org/) (formerly Perl 6) language support for the
[CodeMirror 6](https://codemirror.net/) code editor: syntax highlighting,
indentation and code folding, built on a [Lezer](https://lezer.codemirror.net/)
grammar.

> **Status: early development.** The package is not on npm yet. Comments,
> simple strings, numbers, keywords, variables, blocks and declarations are
> covered. See [Known limitations](#known-limitations) for what is missing.

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

Highlighting only uses the standard tags of `@lezer/highlight`, so any
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
<dd><p>Raku language support.</p></dd>
<dt><code><strong>rakuLanguage</strong>: LRLanguage</code></dt>
<dd><p>A language provider based on the Lezer Raku parser, extended with
highlighting and indentation information.</p></dd>
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
| `RegexDeclaration` | `token`, `rule`, `regex`, with a `RegexName` child, up to the body `Block` |
| `EnumDeclaration`, `SubsetDeclaration`, `ConstantDeclaration` | The declarator and its `EnumName`, `SubsetName` or `ConstantName` |
| `Block`, `Parens`, `Brackets` | `{ }`, `( )`, `[ ]` |
| `VariableName`, `AttributeName`, `SpecialVariable` | `$x` / `$^a`, `$!x` / `$.x`, `$*x` / `$?x` |
| `StringLiteral` | Quoted strings, with `Escape`, `Interpolation` and variable children |
| `LineComment`, `DocComment`, `BlockComment` | `#`, `#|` / `#=`, `` #`( ) `` |

Each declarator keyword is a child node named after the keyword (`class`,
`sub`, `token`, …).

## Known limitations

Not supported yet. Such code is still tokenized, but may be highlighted
wrongly:

- Quote constructs other than `'…'` and `"…"`: `q` / `qq` / `Q` with
  arbitrary delimiters and adverbs, heredocs (`q:to`), `「…」`, `<a b c>`
  word lists
- Interpolation of `@array[]`, `%hash{}`, `&call()` and method calls
  (`"$obj.method()"`) in strings
- Regexes: `/…/`, `rx//`, `m//`, `s///`, `tr///`, and the bodies of
  `token` / `rule` / `regex` declarations. A quote or bracket inside a
  regex is read as code, so it can open a string or a block that swallows
  the code after it (`\{`, `\"` and the like are safe)
- Pod (`=begin` … `=end`, `=head1`, …). An apostrophe in Pod text starts
  a string that runs to the next apostrophe
- The word operators `x`, `xx`, `min` and `max` are not highlighted as
  operators
- Meta operators as such (`[+]`, `Z+`, `X~`, `R-`), and user-defined
  operators (`infix:<+++>`)
- Radix literals such as `:16<FF>`
- `multi` and `proto` declarations without `sub` or `method`

Heuristics that can be wrong:

- A capitalized word is taken to be a type name.
- `%`, `&` and `@` directly followed by a name are taken to be sigils, so
  `$a %b` is read as a hash variable.
- A word spelled like a keyword is a keyword wherever it appears, except
  as a method name or a declared name: `next => 1` and `take(1)` are
  highlighted as keywords.
- A declarator used as a pair key (`class => 'x'`) starts a declaration.

## Development

```sh
npm install
npm test     # builds, then runs the grammar tests in test/*.txt
```

## License

[MIT](LICENSE)
