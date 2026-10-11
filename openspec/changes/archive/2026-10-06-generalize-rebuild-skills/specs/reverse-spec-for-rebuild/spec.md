## ADDED Requirements

### Requirement: Application-neutral skill
The skill's scripts, prompts and references SHALL contain no knowledge of a particular analysed application or customer; application knowledge SHALL live in a project-owned adapter profile.

#### Scenario: Generality gate
- **WHEN** a skill file outside `adapters/` names a pilot application or customer, or uses an application convention such as a config global or toolbar object name
- **THEN** the package test suite fails naming the file and token

#### Scenario: Built-in adapters are stack-level
- **WHEN** a built-in adapter references an application file path
- **THEN** the generality gate fails

### Requirement: Adapter profiles
An adapter MAY declare `parent: "<built-in name>"`; the loader SHALL merge the profile over the built-in adapter, merging `dialect` key-wise, and SHALL pass `parseLiteralAt` with the other helpers to hooks.

#### Scenario: Profile overrides one dialect key
- **WHEN** a profile has `parent: "angularjs"` and sets only `dialect.exprText`
- **THEN** the merged adapter keeps the built-in AngularJS attributes and uses the profile's expression rendering

### Requirement: Template dialect
`screen-plan.mjs` SHALL take every template-language rule (interpolation, control/drop/select tags, event/model/change/bind attributes, conditions, repeats, switch values, expression text, conjunct decisions, CSS classes, language) from `adapter.dialect`; without a dialect it SHALL plan plain HTML.

#### Scenario: Plain HTML
- **WHEN** the adapter has no dialect
- **THEN** buttons, inputs, selects and textareas are numbered controls and no template-language attribute is interpreted

### Requirement: Legacy encoding parameter
Source decoding SHALL use UTF-16 by BOM, then UTF-8 when valid, then the adapter's `encoding` (default `windows-1252`).

#### Scenario: Profile code page
- **WHEN** a profile sets `encoding: "windows-1250"` and a source is neither UTF-16 nor valid UTF-8
- **THEN** it is decoded as windows-1250
