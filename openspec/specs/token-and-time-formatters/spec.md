# token-and-time-formatters Specification

## Purpose

Pure display formatters for session card and chat rendering. Abbreviate raw token counts into compact human-readable strings, format absolute message timestamps relative to a reference "now" (today/yesterday/weekday/full-date), and render millisecond durations as compact relative-time strings. All formatters are pure functions with no side effects; timestamp weekday and relative-day labels are localized via the i18n `t` helper with English fallbacks.

## Requirements

### Requirement: Token count abbreviation

The system SHALL abbreviate a numeric token count into a compact string, using a `k` (thousands) suffix for values of 1000 or greater and returning the raw integer string for smaller values.

#### Scenario: Zero, falsy, or invalid input

- WHEN `formatTokens` receives `0`, a falsy value, or a `NaN` value
- THEN it SHALL return the string `"0"`

#### Scenario: Value below one thousand

- WHEN `formatTokens` receives a value greater than 0 and less than 1000 (e.g. `500`)
- THEN it SHALL return the value as a plain decimal string (e.g. `"500"`) with no suffix

#### Scenario: Exact thousands multiple

- WHEN `formatTokens` receives a value of 1000 or greater that divides evenly by 1000 (e.g. `12000`)
- THEN it SHALL return the thousands value with no fractional digits followed by `k` (e.g. `"12k"`)

#### Scenario: Non-exact thousands value

- WHEN `formatTokens` receives a value of 1000 or greater that does not divide evenly by 1000 (e.g. `12400`)
- THEN it SHALL divide the value by 1000, round to one decimal place, and append `k` (e.g. `"12.4k"`)

#### Scenario: Boundary at one thousand

- WHEN `formatTokens` receives exactly `1000`
- THEN it SHALL return `"1k"`

### Requirement: Message timestamp formatting

The system SHALL format an absolute message timestamp for chat display relative to a reference "now", selecting an increasingly qualified format as the timestamp recedes into the past. The reference time SHALL default to the current time when not supplied. The time-of-day portion SHALL always be rendered as zero-padded `HH:MM:SS` in local time.

#### Scenario: Timestamp on the same calendar day

- WHEN `formatMessageTime` receives a timestamp at or after the start of the reference day
- THEN it SHALL return only the time as `HH:MM:SS` (hours, minutes, and seconds each zero-padded to two digits)

#### Scenario: Timestamp on the previous calendar day

- WHEN `formatMessageTime` receives a timestamp before the start of the reference day but at or after the start of the day before (24 hours earlier)
- THEN it SHALL return the localized "Yesterday" prefix followed by the time, defaulting to `"Yesterday HH:MM:SS"`

#### Scenario: Timestamp within the prior six days

- WHEN `formatMessageTime` receives a timestamp older than the start of yesterday but at or after six days before the start of the reference day
- THEN it SHALL return the localized weekday name of the timestamp followed by the time, defaulting to the English weekday name (e.g. `"Monday HH:MM:SS"`)

#### Scenario: Timestamp older than six days

- WHEN `formatMessageTime` receives a timestamp earlier than six days before the start of the reference day
- THEN it SHALL return the full local date and time as `YYYY-MM-DD HH:MM:SS`, with month and day zero-padded to two digits and month rendered as a 1-based value

### Requirement: Relative duration formatting

The system SHALL render a millisecond duration as a compact relative-time string using the largest whole unit that applies, across seconds, minutes, hours, and days.

#### Scenario: Zero or negative duration

- WHEN `formatRelativeTime` receives a value less than or equal to `0`
- THEN it SHALL return `"0s"`

#### Scenario: Under one minute

- WHEN `formatRelativeTime` receives a duration whose whole-seconds value is less than 60
- THEN it SHALL return the floored seconds followed by `s` (e.g. `"45s"`)

#### Scenario: Under one hour

- WHEN `formatRelativeTime` receives a duration of at least 60 seconds but whose whole-minutes value is less than 60
- THEN it SHALL return the floored minutes followed by `m` (e.g. `"3m"`)

#### Scenario: Under one day

- WHEN `formatRelativeTime` receives a duration of at least 60 minutes but whose whole-hours value is less than 24
- THEN it SHALL return the floored hours followed by `h` (e.g. `"5h"`)

#### Scenario: One day or more

- WHEN `formatRelativeTime` receives a duration whose whole-hours value is 24 or greater
- THEN it SHALL return the floored days followed by `d` (e.g. `"2d"`)
