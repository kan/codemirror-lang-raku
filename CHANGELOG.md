## Unreleased

### New features

- Pod blocks have child nodes for their directives (`PodDirective`),
  headings (`PodHeading`) and formatting codes (`PodStrong`,
  `PodEmphasis`, `PodCode`, `PodLink`, `PodFormat`), which are highlighted.
- Variables, blocks and escapes are interpolated in `<<…>>` and `«…»`
  word lists of up to 24 characters.
- Completion offers the names that the document declares: the variables
  and attributes in scope, routines, classes, enums, subsets and
  constants, and after a `.` the methods.
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

### Bug fixes

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
