# Field type → MUI widget → value shape

All 14 upstream field types, the MUI widget each renders as, and the **exact**
submitted value shape. Value shapes are preserved so answers stay interchangeable
with upstream consumers.

| `type` | MUI widget | Submitted value | Empty value |
|---|---|---|---|
| `header` | `Typography` + `Divider` | *(no key)* | — |
| `paragraph` | `Typography` | *(no key)* | — |
| `text` | `TextField` | `string` | `""` |
| `textarea` | `TextField multiline` | `string` | `""` |
| `number` | `TextField type=number` | `number \| null` | `null` |
| `date` | `DatePicker` (x-date-pickers) | `string` `YYYY-MM-DD` | `""` |
| `boolean` | `Switch` + `FormControlLabel` | `boolean` | `false` |
| `dropdown` | `TextField select` | `string` | `""` |
| `radio` | `RadioGroup` | `string` | `""` |
| `checkbox` | `FormGroup` of `Checkbox` | `string[]` | `[]` |
| `matrix` | `Table` (cards below `md`) | `{ [rowKey]: columnValue }` | `{}` |
| `repeater` | `useFieldArray` cards | `Array<{ [childKey]: value }>` | `[]` |
| `signature` | self-contained canvas | `string` (base64 PNG data URL) | `""` |
| `file` | `Button` + hidden `input[type=file]` | `{ name, size, type, content }` (`content` = base64 data URL) | `null` |

## Value-shape rules that bite

- **`header` / `paragraph` contribute no answer key.**
- **`number` empty is `null`**, not `""` — including calculated fields. Validators
  accept `null` (and `""`) for a non-required number before applying shape rules.
- **`checkbox` is always `string[]`**, even for a single selection.
- **`matrix`** submits only the rows the user answered; an unanswered matrix is `{}`.
- **`repeater`** contributes exactly **one** top-level array. Each row object
  carries **every** child key using the empty-value table above, so a `number`
  child is `null` (this deliberately deviates from upstream's `""`; one
  empty-value definition avoids a shape a `number` validator would reject). No
  child key ever appears at the top level.
- **`file`** is never a raw browser `File` — always the descriptor object with a
  base64 `content`. Size/type are enforced **before** encoding: an oversized file
  (`maxFileSizeMB`, default 5) or a disallowed `acceptedTypes` is rejected and
  not encoded into state.
- **`signature`** default is a ~60-line pointer-event canvas (no dependency).
  Supply an alternative via the `SignatureComponent` prop; it must still emit a
  base64 PNG data URL.

## Applicability (what is actually submitted)

The payload keys on **applicability**, not rendering:

- A field hidden by a rule (or a hidden section) is **omitted**; its value is
  retained in form state and restored if it becomes visible again.
- A **disabled** field **is** included (it commonly carries prefilled/system
  data) — this overrides react-hook-form's default of stripping disabled inputs.
- A calculated `isVisibleOnForm: false` field **is** included when effectively
  visible; **omission wins** when it also sits in a hidden branch.
- Every applicable field contributes its empty value rather than `undefined`, so
  no key is dropped by JSON serialisation.
- `onFieldChange` receives the **complete** state (retained hidden values
  included) — this is *not* the payload; do not forward it as one.
- Supplementary data travels as the **second `onSubmit` argument**
  (`{ submissionContext, diagnostics }`), structurally segregated from answers.

## `optionsType: "api"`

Renders **disabled with an empty option list and a visible explanation**, plus a
diagnostic. This is deferred scope, not a bug — never a silently empty control.
