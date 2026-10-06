import {Tag, tags as t} from "@lezer/highlight"

// The keywords of the grammar, with the tag each is highlighted with.
// Highlighting and completion both read this table. `True`, `False` and
// `Nil` are values, and are not in it.
export const keywordTags: {[keywords: string]: Tag} = {
  "my our has state temp let constant anon augment supersede unit multi proto only": t.definitionKeyword,
  "class role grammar module package sub method submethod token rule regex enum subset": t.definitionKeyword,
  "if elsif else unless with orwith without for while until loop repeat given when default": t.controlKeyword,
  "do gather take try return next last redo proceed succeed react whenever supply emit start": t.controlKeyword,
  "BEGIN CHECK INIT END ENTER LEAVE KEEP UNDO FIRST NEXT LAST PRE POST CATCH CONTROL QUIT CLOSE DOC": t.controlKeyword,
  "use need import require no": t.moduleKeyword,
  "is does of returns handles where will trusts hides": t.modifier,
  "and or not xor so andthen orelse notandthen div mod gcd lcm": t.operatorKeyword,
  "eq ne lt gt le ge cmp leg eqv but": t.operatorKeyword,
  self: t.self
}
