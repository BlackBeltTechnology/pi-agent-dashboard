## MODIFIED Requirements

### Requirement: Strict parameter schema per method

The `ask_user` tool SHALL declare its parameters with a JSON Schema whose **root** is `{"type": "object"}` (preserving OpenAI strict-mode compatibility per commit `a53933f`'s rationale) AND whose **body** carries a `oneOf` discriminator over the `method` literal so each method's required fields and array `minItems` constraints are enforced at the schema level (restoring Anthropic's discriminated-union strictness that was lost when the per-method `Type.Object` arms were collapsed into a single flat object).

Concretely the parameters schema SHALL emit (after typebox compilation):

```json
{
  "type": "object",
  "properties": { "method": {...}, "title": {...}, "message": {...}, "options": {...}, "placeholder": {...}, "questions": {...} },
  "required": ["method"],
  "oneOf": [
    { "properties": { "method": { "const": "confirm" } },     "required": ["method", "title"] },
    { "properties": { "method": { "const": "select" } },      "required": ["method", "title", "options"], "properties": { "options": { "minItems": 2 } } },
    { "properties": { "method": { "const": "multiselect" } }, "required": ["method", "title", "options"], "properties": { "options": { "minItems": 1 } } },
    { "properties": { "method": { "const": "input" } },       "required": ["method", "title"] },
    { "properties": { "method": { "const": "batch" } },       "required": ["method", "questions"], "properties": { "questions": { "minItems": 1 } } }
  ]
}
```

The same `oneOf` pattern (with four arms — `confirm` / `select` / `multiselect` / `input`, no batch nesting) SHALL be applied to `SubQuestionSchema` so a batch's individual sub-questions are subjected to the same per-method strictness.

The runtime `prepareArguments` rescue layer and `execute` empty-options throws (already in place) MUST remain unchanged — they are defense in depth on top of the schema, not redundant with it. They cover (a) malformed-but-recoverable shapes the schema would reject and (b) the case where a provider's tool-call validator does not enforce body-level `oneOf` (e.g. some non-strict OpenAI Completions paths).

#### Scenario: Schema root remains type:object (OpenAI strict compat)
- **WHEN** the `ask_user` tool's `parameters` schema is JSON-serialized
- **THEN** the root object SHALL have `"type": "object"`
- **AND** the root SHALL NOT have an `anyOf` field (OpenAI strict mode rejects root-level `anyOf`)

#### Scenario: Body-level oneOf has 5 arms
- **WHEN** the schema is JSON-serialized
- **THEN** the root object SHALL have a `oneOf` array of length 5
- **AND** the arms SHALL be ordered: confirm, select, multiselect, input, batch

#### Scenario: Multiselect arm enforces options.minItems = 1
- **WHEN** an LLM emits `{method: "multiselect", title: "Pick", options: []}`
- **THEN** the schema validator SHALL reject the call (multiselect requires at least 1 option)
- **AND** the error message SHALL identify `options.minItems` as the failing constraint

#### Scenario: Multiselect arm requires options field
- **WHEN** an LLM emits `{method: "multiselect", title: "Pick"}` (no `options` field)
- **THEN** the schema validator SHALL reject the call (multiselect requires options)

#### Scenario: Select arm enforces options.minItems = 2
- **WHEN** an LLM emits `{method: "select", title: "Pick", options: ["only"]}`
- **THEN** the schema validator SHALL reject the call (select requires at least 2 options; use confirm for yes/no)

#### Scenario: Batch arm enforces questions.minItems = 1
- **WHEN** an LLM emits `{method: "batch", title: "X", questions: []}`
- **THEN** the schema validator SHALL reject the call

#### Scenario: Confirm arm accepts no options or questions
- **WHEN** an LLM emits `{method: "confirm", title: "Proceed?"}`
- **THEN** the schema validator SHALL accept the call (confirm does not require options or questions)

#### Scenario: SubQuestionSchema also has body-level oneOf
- **WHEN** a batch sub-question is `{method: "multiselect", title: "Pick", options: []}`
- **THEN** the `SubQuestionSchema`'s `oneOf` SHALL reject it on the same `options.minItems: 1` rule

#### Scenario: Anthropic regains discriminated-union behavior
- **WHEN** an Anthropic Claude model is presented with the `ask_user` tool schema
- **THEN** the model SHALL receive the per-method required and minItems constraints via the body-level `oneOf` (this is observed indirectly — by re-running an Anthropic regression suite that previously failed with the flat schema and confirming pass-rate restoration; the assertion in this requirement is that the schema *enables* the constraint propagation, not that any specific LLM behavior is guaranteed)
