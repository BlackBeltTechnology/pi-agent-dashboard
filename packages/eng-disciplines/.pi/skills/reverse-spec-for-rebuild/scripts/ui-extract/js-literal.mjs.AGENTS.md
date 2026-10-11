# .pi/skills/reverse-spec-for-rebuild/scripts/ui-extract/js-literal.mjs — index

`parseLiteralAt(src, pos)` → `{ value, end }`: static JS literal reader (objects/arrays/strings/numbers/true/false/null/undefined, comments, trailing commas). Non-literal → throws `not a literal`. Never evaluates. `__proto__` keys stay own props.
