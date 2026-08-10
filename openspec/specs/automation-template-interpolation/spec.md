# automation-template-interpolation Specification

## Purpose

Resolve the `${{trigger}}` template token inside an automation action's payload against the single per-fire value produced by its trigger. Interpolation runs centrally over the whole payload before the action executes, so individual actions carry no substitution logic. A payload string that is exactly the token preserves the resolved value's type, while a token embedded in surrounding text is stringified in place.

## Requirements

### Requirement: Whole-token type-preserving resolution

The interpolator SHALL, when a payload string equals exactly `${{trigger}}`, replace it with the trigger value unchanged, preserving that value's runtime type. When the trigger value is absent (`undefined`) or `null`, the interpolator SHALL resolve the whole token to an empty string.

#### Scenario: Whole token preserves the trigger value's type

- **WHEN** a payload string is exactly `${{trigger}}` and the trigger value is a string, number, boolean, object, or array
- **THEN** the interpolator returns that value unchanged with its original type
- **AND** `${{trigger}}` with value `5` returns the number `5`, with value `true` returns the boolean `true`, and with an object returns the same object reference

#### Scenario: Whole token with an absent trigger value

- **WHEN** a payload string is exactly `${{trigger}}` and the trigger value is `undefined` or `null`
- **THEN** the interpolator returns the empty string `""`

### Requirement: Embedded-token stringification

The interpolator SHALL, when `${{trigger}}` appears inside a larger string, replace every occurrence of the token with a stringified form of the trigger value and splice the result into the surrounding text. Stringification SHALL emit the string unchanged for a string value, `String(value)` for a number or boolean, `JSON.stringify(value)` for an object or array, and the empty string for `undefined`, `null`, or a value that fails to serialize.

#### Scenario: Token embedded in surrounding text is stringified

- **WHEN** a payload string is `"Process ${{trigger}} now"` and the trigger value is `"/spool/inv.pdf"`
- **THEN** the interpolator returns `"Process /spool/inv.pdf now"`
- **AND** `"n=${{trigger}}"` with value `5` returns `"n=5"`

#### Scenario: Embedded token with an absent trigger value

- **WHEN** a payload string is `"x=${{trigger}}"` and the trigger value is `undefined`
- **THEN** the interpolator returns `"x="`

### Requirement: Recursive payload traversal

The interpolator SHALL walk a payload value recursively: arrays SHALL be traversed element by element, and objects SHALL be traversed over their entries with keys preserved and values interpolated. Values that are not strings, arrays, or objects SHALL pass through unchanged.

#### Scenario: Nested objects and arrays are interpolated

- **WHEN** the payload is `{ file: "${{trigger}}", label: "static", nested: { p: "at ${{trigger}}" }, arr: ["${{trigger}}"] }` and the trigger value is `"/spool/a.pdf"`
- **THEN** the interpolator returns `{ file: "/spool/a.pdf", label: "static", nested: { p: "at /spool/a.pdf" }, arr: ["/spool/a.pdf"] }`
- **AND** the non-template string `"static"` is left intact

#### Scenario: Non-string primitives pass through untouched

- **WHEN** the payload value is a number, boolean, or `null`
- **THEN** the interpolator returns it unchanged, so `42` returns `42`, `false` returns `false`, and `null` returns `null`
