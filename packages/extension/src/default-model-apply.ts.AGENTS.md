# default-model-apply.ts — index

`applyDefaultModel(deps)` → pending model string or `null`. Settings `defaultModel` concrete `provider/id` or `@role[:level]` (resolved per call via `resolveDefaultModel`, no cache). Unresolved role → no `setModel`, no pending, log `[default-model] unresolved role @x; using pi default`. Level: non-empty `defaultThinkingLevel` > suffix > role level. See change: default-model-follows-role.
