# FormSchemaJSON reference

The complete schema contract, as implemented by this skill's TypeScript types
(`tools/src/schema/types.ts`). Re-implemented from the upstream
`SCHEMA_REFERENCE.md`; no upstream source is copied.

## Top level

```jsonc
{
  "formTitle": "string?",
  "formDescription": "string?",
  "pages": [Page, ...],            // required; normalization supplies one empty page if absent
  "crossFieldRules": [CrossFieldRule, ...],
  "translations": { "<locale>": { "<key>": "text" } }
}
```

## Layout hierarchy

```
Page → Section → Row → Column → Field
```

```jsonc
Page    = { "pageId?": string, "title?": string, "description?": string, "sections": [Section] }
Section = { "sectionId?": string, "title?": string, "description?": string,
            "rows": [Row], "conditionalRules?": [ConditionalRule] }   // visibility only
Row     = { "rowId?": string, "columns": [Column] }
Column  = { "columnId?": string, "width?": number /* span out of 12 at md+ */, "fields": [Field] }
```

Identifiers (`pageId`, `sectionId`, `rowId`, field `id`) are optional; `normalizeSchema`
generates deterministic ones where absent and preserves existing ones.

## Fields (discriminated union on `type`)

Common to every field: `id?`, `key` (answer key), `label?`, `placeholder?`,
`helpText?`, `required?`, `disabled?`, `conditionalRules?`.

| `type` | Type-specific properties |
|---|---|
| `header` | — (static; no answer) |
| `paragraph` | — (static; no answer) |
| `text` | `mask?`, `validationRegex?`, `errorMessage?`, `maxLength?` |
| `textarea` | `validationRegex?`, `errorMessage?`, `maxLength?`, `rows?` |
| `number` | `min?`, `max?`, `isCalculated?`, `formulaExpression?`, `isVisibleOnForm?` |
| `date` | `min?`, `max?` (`YYYY-MM-DD`) |
| `boolean` | — |
| `dropdown` | `options?`, `optionsType?` (`static`\|`api`), `optionsUrl?` |
| `radio` | `options?`, `optionsType?`, `optionsUrl?` |
| `checkbox` | `options?`, `optionsType?`, `optionsUrl?` |
| `matrix` | `matrixRows?` (options), `matrixColumns?` (options) |
| `repeater` | `rows?` (nested layout), `minItems?`, `maxItems?`, `addLabel?`, `removeLabel?` |
| `signature` | — |
| `file` | `acceptedTypes?` (string[]), `maxFileSizeMB?` (default 5) |

`isCalculated`, `formulaExpression` and `isVisibleOnForm` are reachable **only**
on `number`. `isVisibleOnForm: false` is honoured **only alongside**
`isCalculated: true`; elsewhere it is inert and the field renders normally.

## Conditions & rules

```jsonc
Condition = {
  "dependentFieldKey": "string",         // field whose answer is inspected
  "operator": "equals|notEquals|contains|notContains|greaterThan|greaterThanOrEquals|lessThan|lessThanOrEquals" | "gte" | "lte",
  "compareMode?": "value" | "field",     // default "value"
  "equalsValue?": any,                    // operand when compareMode = "value"
  "compareToFieldKey?": "string"          // operand field when compareMode = "field"
}
ConditionGroup   = { "conditions": [Condition] }          // OR within
ConditionalRule  = { "targetProperty": "visibility|required|disabled", "andGroups": [ConditionGroup] } // AND between
CrossFieldRule   = { "id?": string, "andGroups": [ConditionGroup], "targetFields": [string], "errorMessage": string }
```

See `logic.md` for evaluation semantics (they matter — several are surprising).

## Legacy forms (migrated on normalization, with an `info` diagnostic)

- `visibilityCondition` on a Field/Section → an equivalent `conditionalRules`
  entry with `targetProperty: "visibility"`.
- a free-text `expression` on a cross-field rule → retained for evaluation.

## Normalization & diagnostics

- `normalizeSchema(input)` → `{ schema, diagnostics }`. Non-mutating; idempotent.
- `diagnose(schema)` → findings `{ severity, code, message, path }`. Resolve
  every `error` before treating a schema as complete. Codes include:
  `duplicate-key`, `repeater-in-repeater`, `matrix-in-repeater`,
  `empty-and-groups`, `empty-condition-group`, `unrecognised-operator`,
  `contains-on-checkbox`, `options-api-unsupported`, `dangling-dependent-field`,
  `dangling-compare-field`, `dangling-target-field`, `inert-repeater-child-rule`,
  `isvisibleonform-without-calculated`, `unparseable-formula`.
