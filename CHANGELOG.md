## 0.1.0 (unreleased)

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
