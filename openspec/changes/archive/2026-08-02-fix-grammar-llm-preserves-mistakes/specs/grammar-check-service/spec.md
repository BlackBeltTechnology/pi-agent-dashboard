# grammar-check-service Specification

## ADDED Requirements

### Requirement: The LLM prompt never instructs the model to preserve mistakes

The `llm` backend's system prompt SHALL NOT contain any wording that a model can read as an
instruction to preserve spelling, grammar, or punctuation mistakes. When `capitalizeFirstWord` is
disabled, the sentence-start exception SHALL be expressed as a narrow exception limited to the
case of the first letter of a sentence, and SHALL restate that every other mistake MUST still be
corrected. Blanket preservation phrasing (for example "leave … exactly as written") SHALL NOT be
used for that clause.

#### Scenario: Sentence-start exception is scoped and restates the mandate
- **WHEN** `capitalizeFirstWord` is disabled and a check runs against the `llm` backend
- **THEN** the system prompt SHALL still instruct the model not to change sentence-start
  capitalization
- **AND** it SHALL state that the exception covers only that letter's case
- **AND** it SHALL state that every other spelling, grammar, and punctuation mistake MUST still be
  corrected
- **AND** it SHALL NOT contain the phrase "exactly as written"

#### Scenario: The exception is absent when capitalization is enabled
- **WHEN** `capitalizeFirstWord` is enabled
- **THEN** the system prompt SHALL NOT contain the sentence-start capitalization instruction

#### Scenario: A capable model corrects a misspelled draft with the exception active
- **WHEN** `capitalizeFirstWord` is disabled AND a draft containing misspellings is checked
- **THEN** the backend SHALL return a `correctedText` that differs from the input
- **AND** SHALL report at least one suggestion, rather than reporting no issues

#### Scenario: Jargon-looking prose words are not treated as code
- **WHEN** a check runs against the `llm` backend
- **THEN** the system prompt SHALL scope its verbatim-preservation rule to code, file paths, and
  URLs
- **AND** SHALL state that an unusual, hyphenated, or technical-looking word inside ordinary prose
  is NOT code and SHALL be corrected when misspelled
- **AND** SHALL state that a misspelling is never left in place for looking like jargon, a domain
  term, or a file name, and is never treated as intentional

#### Scenario: A misspelled hyphenated term in prose is corrected
- **WHEN** a draft contains a misspelled hyphenated or domain-jargon word (for example
  `functional-specificatio`, `functianal specifican`)
- **THEN** the backend SHALL report at least one suggestion for it
- **AND** SHALL NOT return the draft unchanged on the grounds of preserving its spelling

#### Scenario: A lowercase sentence start is still preserved
- **WHEN** `capitalizeFirstWord` is disabled AND a draft begins with a lowercase letter and
  contains a misspelling
- **THEN** the misspelling SHALL be corrected
- **AND** the first letter SHALL remain lowercase
