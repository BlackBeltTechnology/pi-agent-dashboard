## ADDED Requirements

### Requirement: Named per-fire variable resolution

The interpolator SHALL accept an optional per-fire variable map and SHALL resolve
single-brace `${name}` tokens in a payload string against that map: a token whose
`name` is a key of the map is replaced with the mapped string value, and a token
whose `name` is absent from the map (or when no map is supplied) is left intact.
Named-variable resolution SHALL be additive to and independent of `${{trigger}}`
resolution — the double-brace trigger token SHALL continue to resolve as before
and SHALL NOT be consumed by the single-brace matcher. Named tokens SHALL be
resolved throughout the payload under the same recursive traversal as
`${{trigger}}`.

#### Scenario: Named token resolves from the variable map

- **WHEN** a payload string is `"${invoice_id}"` and the variable map is `{ invoice_id: "inv-42" }`
- **THEN** the interpolator returns `"inv-42"`
- **AND** a payload string `"id=${invoice_id}"` returns `"id=inv-42"`

#### Scenario: Unknown named token is left intact

- **WHEN** a payload string is `"${unknown}"` and the variable map does not contain `unknown` (or no map is supplied)
- **THEN** the interpolator returns `"${unknown}"` unchanged

#### Scenario: Named resolution coexists with trigger resolution

- **WHEN** the payload is `{ a: "${{trigger}}", b: "${invoice_id}" }`, the trigger value is `"/spool/x.pdf"`, and the variable map is `{ invoice_id: "inv-7" }`
- **THEN** the interpolator returns `{ a: "/spool/x.pdf", b: "inv-7" }`

#### Scenario: Named tokens resolve inside nested inputs and env

- **WHEN** the payload is `{ inputs: { invoice_id: "${invoice_id}" }, env: { IB_INVOICE_ID: "${invoice_id}", IB_TOOLSET: "scoped-invoice" } }` and the variable map is `{ invoice_id: "inv-9" }`
- **THEN** the interpolator returns `{ inputs: { invoice_id: "inv-9" }, env: { IB_INVOICE_ID: "inv-9", IB_TOOLSET: "scoped-invoice" } }`
