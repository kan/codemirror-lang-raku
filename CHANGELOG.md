# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Bug fixes

- A word list or a regex right after an operator, with no space between
  them, is no longer read as part of the operator: `my @a=<a b c>`,
  `foo |<a b>`, `say +<a b c>`, `my @w=«a b»`, `<1 2>|<2 1>`,
  `$s ~~/^\d+$/`, `say !/x/`. A quote in such a regex could turn the
  rest of the document inside out. Operators that hold these characters
  stay whole: `//=`, `<=>`, `<==`, `>>+<<`, `»+«`, `-<<`, the end of a
  hyper assignment with brackets (`@a >>[&f]=<< @b`, `@a »[+]=« @b`),
  and the shifts and negations `+<`, `~<`, `!<` after a term.
- `*<key>` is a subscript on the whatever star, and `$i++/2` and `*/2`
  divide.
- `=:=` is one operator.
- Characters that are no token, such as full-width digits (`say ４２;`),
  letterlike symbols that are no letters (`℃℃`, `№`) or backticks
  (`` 1 ``` 2 ``), no longer turn the code after them, up to the next
  blank line, into Pod. They are errors, and the code after them is read
  as code.
- After an edit, what follows a prefix `++` or `--` could be read
  differently than in a parse from scratch: the name in `++x` could
  become an operator.
- After an edit that makes a heredoc's opener no longer open it, the
  text of the heredoc stays a heredoc less often: in a test with 1,170
  such edits, 3 of them, down from 18. Which edits do it has changed, so
  a few that used to be read right now are not. See Known limitations in
  the README.
- A sigilless name that is spelled like a declarator, as in
  `sub f(\role, \class) { role.say }`, no longer makes a declaration that
  runs on past the signature. A lowercase word after a backslash is a
  name, and so is a declarator that a method is called on.
- After a character that is no token, the next word is no longer taken
  for the name of the declaration: in `class ４２ is Foo { }`, `is` is
  not a `PackageName`.
- `[/]` is a reduction: in `say [/] 8, 2; say 6 / 2;`, the code between
  the slashes is no longer a regex.
- Regex adverbs that start with a count, as in `m:2nd/x y/`, `m:1st/a/`
  and `s:3x/a/b/`, start a regex.
- `∞` is a number and `∅` a term, so the `/` after them divides:
  `∞ / 2`, `-∞..∞`.
- The letters among the letterlike symbols, the superscripts and the
  subscripts, and a few others, start a name: `my constant \ℝ = 1`,
  `ℵ`, `Ω`, `ⁿ`, `々`. They used to be errors.
- A number that is one character is a `Number`, as `½` was: the Roman
  numerals (`Ⅻ`, `ⅰ`), the subscripts (`₀`), the circled numbers (`①`,
  `⑴`, `❶`, `㉑`, `㊀`) and the ideographic numbers (`〇`, `〡`). The `/`
  after them divides. They used to be errors, operators (`①`) or names
  (`㉑`).
- A `++` or `--` at the start of a line after a block is a prefix: in
  `if 1 { }` followed by `++x;`, `x` is no longer read as an operator.
- A chain of method calls in a string that ends in an argument list is
  interpolated as a whole: `"$c.raku.subst(/ "(" .* /)"`. A quote in the
  arguments no longer closes the string and turns the code after it
  inside out.
- A backslash in a word list keeps the delimiter after it from closing
  the list: `<a \> b>`, `«a \» b»`, `<<a \>> b>>`.
- Completion offers the variables that are declared with a native type
  or a coercion type, as in `my int @a`, `my num $n` and
  `my Foo(Str) $x`, and offers nothing for the variable that such a
  declaration is making up, as in `my int $new`.
- In a string, an array, a hash or a routine with a twigil is
  interpolated when a subscript or a call follows it, as one without a
  twigil is: `"%*ENV<HOME>"`, `"@*ARGS[0]"`, `"@!items[]"`,
  `"%.h<k>"`, `"&?ROUTINE.name()"`.
- A named capture, `$<name>` or `@<name>`, is a variable, in code and
  in strings, as `$0` and `$/` are. It used to be a sigil and a
  subscript, which in a string were highlighted as its text. A name of
  more than 20 characters still is.
- `ff`, `fff`, `before`, `after`, `unicmp`, `coll` and `minmax` are
  operators where an operator is expected, as `x` and `min` are, and so
  are the meta operators on word operators: `Zmin`, `Xeq`, `Rcmp`. They
  used to be names, and the meta operators types.
- The word operators and the set operators are operators after a
  subscript in braces, or a block, on the same line: `%h{$k} x 3`,
  `{ rand } xx 3`, `%h{$k} (elem) $s`.
- `$%h` and `@%h` are a hash in a container, not a modulo.
- A type capture (`::T`, as in `role R[::T]`) and the types of the
  current package (`::?CLASS`, `::?ROLE`) are type names, and `$::x`
  is a variable. A `::` that no name follows, as in `::('Foo')` and
  `PROCESS::<$OUT>`, is one token, and `::=` is one operator. They used
  to be split into colons and pair keys.
- A `:sym<…>` that holds brackets with a space between them belongs to
  the name of a regex declaration, as in `token infix:sym<{ }> { … }`.
  The brackets used to be read as the body of the declaration, and the
  body as code.
- The import list after the version or the author of a module is a
  word list: `use Foo:ver<1>:auth<zef:me> <a b>`.
- A byte order mark at the start of a file is whitespace, not an error.
- Completion offers the variables that are declared with a type of the
  document's own whose name is not capitalized, as in
  `class point { }; my point $p`, when the type is declared in a scope
  around the variable. A word that the document does not declare as a
  type is still taken for a call after a `my` that is being typed on the
  line above it.

### Performance

- Reparsing after an edit reuses the rest of the document when the last
  statement of the document, or of a large block, opens a heredoc. Such a
  document used to be parsed from scratch after every edit: a 1-character
  edit in about 100 KB took about 50 ms, and takes about 1 ms. Documents
  with many heredocs gain as well: in about 95 KB with a heredoc every
  7 lines, an edit takes under 1 ms, down from about 8 ms.
- Reparsing after an edit is faster in a huge quote: a 1-character edit
  in a `"…"` or `qq[…]` of about 200 KB takes 55–70% of the time it did.
- The first completion after an edit no longer gathers the names of the
  whole scope again. The parts of the document that the edit leaves
  alone keep what they declare. In a document of about 17,000 lines, it
  takes under 1 ms, down from about 9 ms.
- While a `"…` or `qq[…` is not closed, an edit before or after it no
  longer reparses the whole document. Such a quote still runs to the end
  of the document, and is now closed there, also when a `{` of an
  interpolation in it is open. In a document of about 3,500 lines, a
  1-character edit takes 1–2 ms, down from 25–55 ms. The tree of such a
  quote changes: it no longer ends in an error node, as in
  `StringLiteral(VariableName)` for `"oops $x`. An error node is still
  left in what the quote does not close itself, such as a `{` or a
  nested `[` of its delimiters. A backslash at the end of such a quote
  is part of its text, and no longer an operator after it.

### Dependencies

- Requires `@lezer/lr` 1.4.12 or later. With 1.4.11, an edit
  can keep the parser from reusing the first child of the node that holds
  it, and a 1-character edit reads about three times as much text again.

## [0.4.1] - 2026-11-10

### Internal

- Releases are prepared by [tagpr](https://github.com/Songmu/tagpr): a
  release pull request carries the version bump and this file's section,
  and merging it tags the release and publishes it to npm with
  [Trusted Publishing](https://docs.npmjs.com/trusted-publishers), with
  provenance. The text of each GitHub release is still this file's section
  for the version.

## [0.4.0] - 2026-10-07

Most of this was found by parsing the test suite of
[mutsu](https://github.com/tokuhirom/mutsu), an implementation of Raku.

### Breaking changes

- The name of a constant with a sigil, as in `constant $LIMIT = 3`, is a
  `ConstantName` inside the `ConstantDeclaration`. It was a
  `VariableName` after the declaration, which had no name.
- A `:sym<…>` that follows the name of a declaration after blanks, as in
  `token word :sym<long> { }`, is part of the `RegexName`.
- A declarator comment with brackets, `#|( … )` or `#=( … )`, is one
  `DocComment` up to its closing bracket. It ended with its first line,
  and still does when the bracket is not closed.

### New features

- Corner quotes (`｢…｣`), also after a quote word (`Q｢…｣`), the low
  curly quotes (`„…”`, `„…“`, `‚…’`, `‚…‘`) and the reversed `”…”`.
- A quote word takes a backtick or a symbol outside of ASCII for a
  delimiter: ``qx`…` ``, `Q♥…♥`.
- Fractions that are one character (`½`, `⅔`) are numbers, and a power
  in superscript (`$x²`) is an operator.
- Symbols outside of ASCII are operators: the atomic operators
  (`⚛+=`), and the operators of one's own (`1 ⚡ 2`).
- The set operators that are written in parentheses, as in
  `$a (<=) $b` and `$x (elem) $s`, are operators.
- An operator in brackets as a routine, as in `&[+]`, is a
  `VariableName`.
- The name of an operator can be written in double angles:
  `infix:<< plus-one >>`, `&infix:<<(>=)>>`.
- The variable `$¢`.

### Bug fixes

- In a regex, `‘…’`, `“…”`, `‚…’`, `„…”` and `｢…｣` are quotes, in which
  the delimiter of the regex does not end it: `m/ab ‘/’ c/`.
- A list of words in a regex, `/ < a ' b > /`, no longer starts a quote
  at a `'` in it.
- A regex does not end at its delimiter in code: in the arguments of an
  assertion (`<name: /a/ >`, `<:name(/a/)>`), in `$( … )`, and in a
  declaration (`:my $m = $/;`).
- A `$/` in the replacement of a substitution does not end it:
  `s/(a)/[$/]/`.

## [0.3.0] - 2026-10-07

### Breaking changes

- A pair of a quote's own delimiters inside it, as the `[b]` of
  `qq[a [b] c]`, is a `NestedDelimiters` node in the `StringLiteral`.
  It was text without a node.

### Bug fixes

- After an edit in a long quote that interpolates and has bracket
  delimiters (`qq[…]`), the text after a nested `[` could be read as if
  the quote had ended, and every further edit parsed the quote again
  from its start.
- In such a quote, a `[…]` or `(…)` right after a nested pair of
  delimiters is text, not a subscript or a call: `qq[a [b](c)]`.
- After an edit, the text of a heredoc could be read as code when a long
  quote that interpolates and spans several lines followed the opener
  of the heredoc on its line.

## [0.2.0] - 2026-10-07

### New features

- Regexes are highlighted inside: the literals `/…/`, `rx/…/`, `m/…/` and
  the pattern of `s/…/…/`, and the body of a `token`, `rule` or `regex`
  declaration. A `Regex` node has children for character classes (`CharacterClass`),
  `<…>` assertions (`Assertion`), quoted literals, escapes, quantifiers
  and anchors, variables, comments, and the blocks of code in it, which
  are read as code.
- `multi foo(…) { }`, `proto foo(…) {*}` and `only foo(…) { }`, without the
  word `sub`, are `RoutineDeclaration` nodes with a `RoutineName`. The
  node has no declarator keyword, and `multi` is the node before it.
- Pod blocks have child nodes for their directives (`PodDirective`),
  headings (`PodHeading`) and formatting codes (`PodStrong`,
  `PodEmphasis`, `PodCode`, `PodLink`, `PodFormat`), which are highlighted.
- Variables, blocks and escapes are interpolated in the text of a
  `qq:to` heredoc. Its `Heredoc` node has the children of a string that
  interpolates.
- Variables, blocks and escapes are interpolated in `<<…>>` and `«…»`
  word lists. Such a list can hold code over several lines, and can be
  a subscript: `%h«$key»`, `:a<<b $c>>`.
- Completion offers the names that the document declares: the variables
  and attributes in scope, routines, classes, enums, subsets and
  constants, and after a `.` the methods.
- Completion also offers placeholder variables (`$^a`) in their block,
  and variables without a sigil (`my \x`).
- A line that starts with a trait, as in `is export {` under
  `sub f($a)`, is indented as the continuation of its statement.
- Toggling a block comment picks brackets that fit the selection:
  `` #`[ … ] `` when the selection holds an unbalanced parenthesis, and so
  on. A comment is removed whichever bracket it was written with.
- A line that continues a statement is indented one unit further: after
  a line that ends in an operator or a comma, and when it starts with a
  method call or an infix operator.
- The adverbs of a quote that switch kinds of interpolation on and off
  are taken into account: `q:c{…}` interpolates blocks, `qq:!s[…]` does
  not interpolate `$` variables. This covers `:c`, `:s`, `:a`, `:h`, `:f`,
  `:b`, `:qq`, `:q` and their long names.
- An operator referred to as a routine, as in `&infix:<+>`, is a single
  `VariableName`. Operator names can also be written as `circumfix:<[ ]>`
  and `infix:['+']`.
- `q`, `qq`, `Q` and their variants take a bracket after blanks: `q {…}`,
  `qw <a b>`.
- An adverb with an argument that is `False` or `0` is switched off:
  `qq:c(False)[…]`.

### Bug fixes

- A regex with bracket delimiters no longer ends at the `]` of a
  character class in it: `rx[ <[a..z]> ]`.
- `multi foo`, `proto foo` and `only foo` declare a sub also when the
  signature or the body starts on the next line.
- A long comment right after a type name (`my Foo  # …`) no longer makes
  every edit before it reparse the document up to that comment.
- After the built-in terms `pi`, `π`, `tau`, `τ`, `now`, `time` and `rand`, a
  `/` or `<` is an operator whatever the spacing: `pi /2`.
- A keyword that is a routine and is called with parentheses, as in
  `take(1)` or `not($x)`, is a plain name and not a keyword.
- The body of a regex declaration that is not closed ends before the next
  `token`, `rule` or `regex` declaration, so that the declarations after
  it are still found.
- A heredoc opener that is only mentioned in a string or in a comment no
  longer starts a heredoc. Heredocs are now found from the quote tokens
  of the line, not from its text.

## [0.1.0] - 2026-10-06

### New features

First release.

- Syntax highlighting with the standard tags of `@lezer/highlight`:
  comments and Pod, quotes of all kinds with interpolation, heredocs,
  regexes, numbers, variables with sigils and twigils, keywords, operators
  and declarations
- A syntax tree with nodes for package, routine, regex, enum, subset and
  constant declarations and their names
- Indentation, folding and matching of `{ }`, `( )` and `[ ]`, and folding
  of Pod blocks, heredocs and embedded comments
- Completion of keywords and of the commonly used built-in types,
  routines, methods and special variables

[0.4.1]: https://github.com/kan/codemirror-lang-raku/releases/tag/v0.4.1
[0.4.0]: https://github.com/kan/codemirror-lang-raku/releases/tag/v0.4.0
[0.3.0]: https://github.com/kan/codemirror-lang-raku/releases/tag/v0.3.0
[0.2.0]: https://github.com/kan/codemirror-lang-raku/releases/tag/v0.2.0
[0.1.0]: https://github.com/kan/codemirror-lang-raku/releases/tag/v0.1.0
