# prompt-answer-response-encoding Specification

## Purpose

Convert an interactive renderer's `result` payload into the string `answer` field carried by a PromptBus `prompt_response` message. Encoding follows a fixed precedence so each renderer shape (batch, multiselect, select/input/editor, confirm) maps to a deterministic answer string, while cancellation is distinguished from an empty selection.

## Requirements

### Requirement: Cancellation produces no answer

The encoder SHALL treat a cancelled prompt as having no answer at all, independent of the `result` payload.

#### Scenario: Cancelled flag set

- WHEN the `cancelled` argument is truthy
- THEN the encoder returns `undefined`
- AND the `result` payload is not inspected

### Requirement: Structured result fields encode by precedence

When not cancelled and `result` is a non-null object, the encoder SHALL evaluate its fields in a fixed order and emit the answer from the first matching field.

#### Scenario: Batch answers array takes highest precedence

- WHEN `result.answers` is an array
- THEN the encoder returns `JSON.stringify(result.answers)`
- AND lower-precedence fields (`values`, `value`, `confirmed`) are ignored

#### Scenario: Multiselect values array

- WHEN `result.answers` is not an array
- AND `result.values` is an array
- THEN the encoder returns `JSON.stringify(result.values)`

#### Scenario: Empty multiselect selection is not cancellation

- WHEN `result.values` is an empty array
- AND `cancelled` is falsy
- THEN the encoder returns `"[]"`
- AND this differs from the cancelled case which returns `undefined`

#### Scenario: Single value for select, input, or editor

- WHEN neither `result.answers` nor `result.values` is an array
- AND `result.value` is defined (not `undefined`)
- THEN the encoder returns `result.value` as a string

#### Scenario: Confirm boolean

- WHEN no array field matches and `result.value` is `undefined`
- AND `result.confirmed` is defined
- THEN the encoder returns the string form of `result.confirmed` (`"true"` or `"false"`)

### Requirement: Fallback stringification

When not cancelled and no structured field matches, the encoder SHALL coerce the raw `result` to a string, treating nullish results as empty.

#### Scenario: Non-object result

- WHEN `result` is not a non-null object (for example a primitive)
- THEN the encoder returns `String(result ?? "")`

#### Scenario: Object result with no recognized fields

- WHEN `result` is an object with none of `answers` (array), `values` (array), `value` (defined), or `confirmed` (defined)
- THEN the encoder returns `String(result ?? "")`

#### Scenario: Null or undefined result

- WHEN `result` is `null` or `undefined`
- AND `cancelled` is falsy
- THEN the encoder returns the empty string `""`
