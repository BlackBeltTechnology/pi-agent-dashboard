## ADDED Requirements

### Requirement: Custom answers encode like option answers
A custom ("Other") answer SHALL travel as a plain string with no marker field. The encoder SHALL encode `{ value: <custom text> }` exactly like a listed option (the text itself) and SHALL encode `{ values: [...] }` containing custom text exactly like any multiselect selection (`JSON.stringify(values)`). A batch `answers` array containing custom entries SHALL encode as `JSON.stringify(answers)` unchanged. Whether a value is custom SHALL be derivable only by comparing it with the prompt's options. The text-only REST encoding SHALL treat custom answers identically.

#### Scenario: Custom select value
- **WHEN** the result is `{ value: "something else" }` and `cancelled` is falsy
- **THEN** the encoder returns `"something else"`

#### Scenario: Custom value inside a multiselect selection
- **WHEN** the result is `{ values: ["A", "D"] }` where `"D"` is not one of the options
- **THEN** the encoder returns `'["A","D"]'`

#### Scenario: Custom value inside a batch
- **WHEN** the result is `{ answers: [{ value: "C" }, { values: ["A", "D"] }] }`
- **THEN** the encoder returns `JSON.stringify` of that array, unchanged
