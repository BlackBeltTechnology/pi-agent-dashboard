# automation-cron-parsing Specification
## Purpose
Provide a pure, dependency-free 5-field cron evaluator shared by client and server. It parses standard cron expressions, validates them, and computes the next matching fire time in local time, giving the client editor and the server scheduler one identical parser.

## Requirements

### Requirement: Five-field cron grammar
The evaluator SHALL accept only expressions of exactly five whitespace-separated fields in the order `minute hour day-of-month month day-of-week`, each bounded to its valid numeric range.

#### Scenario: Well-formed five-field expression parses
- **WHEN** an expression such as `0 9 * * 1-5` (five fields) is parsed
- **THEN** it is accepted and each field is interpreted against its range: minute 0-59, hour 0-23, day-of-month 1-31, month 1-12, day-of-week 0-7

#### Scenario: Wrong field count is rejected
- **WHEN** an expression has fewer or more than five fields after trimming and splitting on whitespace (e.g. `* * * *` or `0 0 * * * *`)
- **THEN** parsing fails and the expression is invalid

#### Scenario: Out-of-range field value is rejected
- **WHEN** any field contains a value outside its allowed range (e.g. minute `60`, hour `24`, month `0`, or day-of-month `32`)
- **THEN** parsing fails and the expression is invalid

### Requirement: Field syntax — wildcard, lists, ranges, steps
Each field SHALL support `*` (whole range), lists (`a,b,c`), ranges (`a-b`), and steps applied to a wildcard or range (`*/n`, `a-b/n`), expanding to the set of matching values.

#### Scenario: Wildcard covers the whole range
- **WHEN** a field is `*`
- **THEN** it matches every value in that field's range

#### Scenario: List of values
- **WHEN** a field is a comma list such as `1,15,30`
- **THEN** it matches each listed value

#### Scenario: Inclusive range
- **WHEN** a field is a range such as `1-5` (as in day-of-week `1-5` for Mon-Fri)
- **THEN** it matches every value from the lower to the upper bound inclusive

#### Scenario: Step over wildcard
- **WHEN** a field is `*/n` such as minute `*/15`
- **THEN** it matches every nth value starting from the field minimum (0, 15, 30, 45)

#### Scenario: Step over a range
- **WHEN** a field is `a-b/n` such as `0-30/10`
- **THEN** it matches every nth value within the range starting at the lower bound (0, 10, 20, 30)

#### Scenario: Invalid step is rejected
- **WHEN** a step value is not a positive integer, or a field has more than one `/` (e.g. `*/0`, `*/-1`, `*/x`, `1-5/2/3`)
- **THEN** parsing fails and the expression is invalid

#### Scenario: Malformed or empty field is rejected
- **WHEN** a field's parsed bounds are non-integers or produce an inverted range (lower greater than upper), or a field expands to no values
- **THEN** parsing fails and the expression is invalid

### Requirement: Day-of-week Sunday normalization
The day-of-week field SHALL treat both 0 and 7 as Sunday, normalizing 7 to 0 so that either representation matches Sunday.

#### Scenario: 7 is accepted as Sunday
- **WHEN** the day-of-week field includes `7` (e.g. `0 0 * * 7`)
- **THEN** the expression is valid and matches Sunday, equivalent to using `0`

### Requirement: Day-of-month / day-of-week OR-semantics
When both day-of-month and day-of-week are restricted (neither is `*`), a date SHALL match if EITHER field matches; when either field is `*`, only the other restriction applies.

#### Scenario: Both restricted — either match qualifies
- **WHEN** an expression restricts both day fields, such as `0 0 1 * 1` (day-of-month 1 OR Monday)
- **THEN** a date matches if it is the 1st of the month OR a Monday

#### Scenario: One day field is wildcard — only the other applies
- **WHEN** one day field is `*`, such as `0 9 * * 1-5` (day-of-month `*`, weekdays Mon-Fri)
- **THEN** matching depends only on the restricted field (weekday), and the wildcard field always passes

### Requirement: Local-time next-fire computation
The evaluator SHALL compute `nextFire(expr, after)` as the first minute strictly after `after` (seconds and milliseconds ignored) whose local time matches all fields, or null when the expression is invalid or no match occurs within a four-year horizon.

#### Scenario: Returns the next matching minute strictly after the reference
- **WHEN** `nextFire` is called with a valid expression and a reference time
- **THEN** it returns the earliest local-time minute after that reference (the reference minute itself is excluded) whose minute, hour, month, and day fields all match

#### Scenario: Invalid expression yields null
- **WHEN** `nextFire` is called with an invalid expression
- **THEN** it returns null

#### Scenario: No match within horizon yields null
- **WHEN** no matching minute exists within roughly four years after the reference
- **THEN** it returns null

### Requirement: Expression validation
The evaluator SHALL expose `isValidCron(expr)` returning true only for expressions that parse successfully under all grammar and range rules, and false otherwise.

#### Scenario: Valid expression
- **WHEN** `isValidCron` receives a well-formed in-range five-field expression (e.g. `*/15 0-23 * * *`)
- **THEN** it returns true

#### Scenario: Invalid expression
- **WHEN** `isValidCron` receives an expression with the wrong field count, an out-of-range value, an inverted range, or a bad step
- **THEN** it returns false
