## Unreleased

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

## 0.3.0 (2026-10-07)

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

## 0.2.0 (2026-10-07)

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

## 0.1.0 (2026-10-06)

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
