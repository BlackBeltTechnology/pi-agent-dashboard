# Conditional logic & formula grammar

Two systems share one CNF evaluator: field/section `conditionalRules`
(`visibility` / `required` / `disabled`) and root `crossFieldRules`. Semantics
below were read from the reference source (design D15), not from documentation —
several are surprising and were verified against `src/renderer.js`.

## CNF: `andGroups`

- **AND between groups, OR within a group.** A rule is satisfied when **every**
  group holds **at least one** satisfied condition.
- An **empty `andGroups` is NOT inert — it evaluates to *not satisfied*.** A
  visibility rule so declared therefore **hides** its target. Diagnosed as
  `empty-and-groups`.
- A group with **no conditions** makes the whole rule not satisfied
  (`empty-condition-group`).

## Rules replace the static value

When **any** rule targets a property, the OR of those rules **replaces** the
field's static value for that property (it does not augment it). So a statically
`required: true` field with an *unsatisfied* `required` rule becomes **optional**.
With no rule for a property, the static value stands (default: visible, not
required, not disabled). A field is visible only when **both** its own visibility
and its **section's** visibility are visible.

## Operators

| Operator | Semantics |
|---|---|
| `equals` | strict equality **or** equality of string coercions |
| `notEquals` | exact negation of `equals` |
| `contains` | **case-insensitive substring** of the *stringified* operands (`null`/`undefined` → `""`). Arrays are joined first, so on a `checkbox` this matches the joined string, **not** array membership (diagnosed `contains-on-checkbox`). |
| `notContains` | exact negation of `contains` |
| `greaterThan` / `greaterThanOrEquals` / `lessThan` / `lessThanOrEquals` | ordinal comparison (below) |
| `gte` / `lte` | undocumented aliases of `greaterThanOrEquals` / `lessThanOrEquals` (accepted silently) |

An **unrecognised operator falls back to `equals`** (matching upstream) and
raises a `warning` diagnostic — it does **not** throw.

## Ordering (three-tier fallback)

Applied **regardless of field type and `compareMode`**, in order:

1. **numeric** — when neither operand is the empty string and both coerce to
   finite numbers (so `"9" < "10"` is numeric, not string);
2. **chronological** — when both operands parse as dates (`Date.parse`);
3. **locale-aware string** comparison otherwise.

When **either operand is `undefined`** the ordering is **indeterminate** and all
four ordering operators are **false** — an unanswered field never spuriously
satisfies a comparison.

## Comparison modes

- `compareMode: "value"` (or absent): compare against the static `equalsValue`.
- `compareMode: "field"`: compare against the **live** answer of
  `compareToFieldKey`; the result updates when that field changes. An unresolved
  reference evaluates the condition as not satisfied and is diagnosed.

## Cross-field rules

A `crossFieldRule` whose `andGroups` are **satisfied** is a **violation** and
**blocks** submission. Its `errorMessage` attaches to **every** currently-visible,
non-disabled key in `targetFields`. A target that is hidden, disabled, dangling,
static (`header`/`paragraph`), or nested in a repeater receives no field-level
error — the rule still blocks and its message appears in the **error summary**.
An empty `andGroups` never blocks.

## Calculated fields & the formula grammar

A `number` with `isCalculated: true` derives its value from `formulaExpression`
and accepts no direct input. With `isVisibleOnForm: false` it is not rendered but
**still computes** and participates in rules and the payload. Values recompute
when any referenced answer changes.

Formulas are evaluated by a **purpose-written recursive-descent parser** — never
`eval` / `new Function`. Grammar:

```
numeric literals · {fieldKey} references
+ - * / %  · parentheses
comparisons  > < >= <= == !=  · ternary  cond ? a : b
Math.min | Math.max | Math.round | Math.abs | Math.floor | Math.ceil
```

Anything outside the grammar (property access, arbitrary calls, identifiers)
evaluates to **`0`** and raises an `unparseable-formula` diagnostic. Division or
modulo by zero yields `0`.

## Inspecting rules

`explainRules(schema, answers)` returns each rule's outcome with per-condition
operand values — this drives the preview harness's rule-debug panel.
