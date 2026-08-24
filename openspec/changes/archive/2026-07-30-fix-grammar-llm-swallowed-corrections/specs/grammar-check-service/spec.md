# grammar-check-service Specification

## ADDED Requirements

### Requirement: LLM corrections are never silently swallowed

When the `llm` backend returns a `correctedText` that differs from the submitted text but NO
itemized `suggestions` can be surfaced — either because the model returned an empty `suggestions`
array, or because every returned suggestion's `original` is not an exact substring of the input
and was therefore dropped as untrustworthy — the service SHALL synthesize a single whole-text
`GrammarSuggestion` spanning the entire input (`offset: 0`, `length: <input length>`, `original`
= the submitted text, `replacement` = the corrected text, `kind: "grammar"`). The result SHALL
therefore never report "No issues found" when the model actually changed the text.

The changed/unchanged comparison SHALL ignore leading and trailing whitespace, and the fallback
SHALL NOT fire on empty input. Before the comparison and before the result is returned, the
service SHALL strip a single echoed `<text>…</text>` wrapper from `correctedText` (the wrapper the
LLM prompt instructs the model to omit), so a wrapper-only difference is treated as no change and
an applied correction never leaks the tags into the draft.

Individual itemized suggestions SHALL still be preferred when at least one survives: the whole-text
fallback is used only when zero itemized suggestions remain.

#### Scenario: Model rewrites the text but returns no suggestions
- **WHEN** the `llm` backend returns a `correctedText` that differs (ignoring surrounding
  whitespace) from the input and an empty `suggestions` array
- **THEN** the result SHALL contain exactly one `GrammarSuggestion` spanning the whole input
  whose `replacement` is the corrected text
- **AND** the `summary` SHALL NOT be "No issues found"

#### Scenario: Every itemized suggestion is dropped as a non-substring
- **WHEN** the `llm` backend returns a changed `correctedText` together with one or more
  suggestions whose `original` is not an exact substring of the input
- **THEN** those suggestions SHALL be dropped as untrustworthy
- **AND** a single whole-text correction SHALL be surfaced in their place

#### Scenario: At least one valid suggestion suppresses the fallback
- **WHEN** the `llm` backend returns a changed `correctedText` and at least one suggestion whose
  `original` is an exact substring of the input
- **THEN** only the itemized suggestion(s) SHALL be returned
- **AND** the whole-text fallback SHALL NOT be added

#### Scenario: Genuinely clean text surfaces no correction
- **WHEN** the `llm` backend returns a `correctedText` equal to the input (ignoring surrounding
  whitespace) and an empty `suggestions` array
- **THEN** the result SHALL contain zero suggestions
- **AND** the `summary` SHALL be "No issues found"

#### Scenario: Echoed <text> wrapper is stripped
- **WHEN** the model returns `correctedText` wrapped in `<text>…</text>` tags
- **THEN** the wrapper SHALL be removed before the result is returned and before the
  changed/unchanged comparison
- **AND** a wrapper-only difference SHALL NOT trigger a whole-text correction
