## ADDED Requirements

### Requirement: `editor-pane-file-handler` slot
The slot taxonomy SHALL include the slot id `editor-pane-file-handler`, with multiplicity `many`, a React-only payload, and predicate input `never`.

**Claim fields.**

| Field | Required | Rule |
|---|---|---|
| body component | yes | — |
| `id` | yes | lower-case slug, unique within the plugin |
| `extensions` | yes | non-empty; lower-case extensions with a leading dot; no wildcards; no text-backed extension |
| `mode` | yes | `preview` or `edit` |
| `label` | yes | at most 40 characters |
| keep-alive limit | no | 1 to 3 |
| size limit | no | not above the core handler ceiling |
| first-overwrite notice | no | at most 300 characters |
| validator flag | no | declares that saves require the plugin's registered content validator |
| copy suffix | required for edit mode | lower-case slug |

A claimed extension SHALL be rejected when the shared file-kind classifier treats it as text-backed: editable, or a recognised kind rendered by the text, markdown, Mermaid, AsciiDoc or HTML viewer (for example `.md`, `.markdown`, `.csv`, `.adoc`, `.mmd`, `.puml`, `.txt`, `.json`, `.ts`, `.html`). Extensions the classifier does not recognise SHALL be claimable. Extensions SHALL be a single segment (`.tar.gz` is rejected). Ordering among claims SHALL use the plugin priority rule of this capability. A duplicate claim id within one plugin SHALL fail registry generation naming the plugin.

**Registry.** All claim fields SHALL survive manifest normalization and registry generation unchanged, and SHALL contribute to the registry hash.

**Versioning.** Adding the slot SHALL be a minor version of `pi-dashboard-shared`; plugins that do not reference it SHALL be unaffected.

#### Scenario: Validator accepts a well-formed claim
- **WHEN** a manifest declares an `editor-pane-file-handler` claim with a component, `id: "word"`, `extensions: [".docx"]`, `mode: "edit"` and a label
- **THEN** the validator SHALL accept it

#### Scenario: Validator rejects a text extension
- **WHEN** a claim lists `.md` in `extensions`
- **THEN** the validator SHALL throw a manifest validation error naming the plugin, the slot and the extension

#### Scenario: Validator rejects other text-backed extensions
- **WHEN** a claim lists `.markdown` or `.json`
- **THEN** the validator SHALL throw a manifest validation error naming the extension

#### Scenario: Unrecognised binary extension is claimable
- **WHEN** a claim lists `.drawio` or `.psd`
- **THEN** the validator SHALL accept it

#### Scenario: Edit claim without a copy suffix
- **WHEN** an `edit` claim omits the copy suffix
- **THEN** the validator SHALL throw a manifest validation error

#### Scenario: Validator rejects a malformed extension
- **WHEN** a claim lists `docx` or `.*`
- **THEN** the validator SHALL throw a manifest validation error

#### Scenario: Duplicate claim id
- **WHEN** one plugin declares two `editor-pane-file-handler` claims with `id: "word"`
- **THEN** registry generation SHALL fail naming the plugin and the id

#### Scenario: Claim field edits change the registry hash
- **WHEN** a plugin changes only a claim's `extensions` or size limit
- **THEN** the plugin registry hash SHALL change

#### Scenario: Predicate classification
- **WHEN** type-checking `SlotPredicateInput<"editor-pane-file-handler">`
- **THEN** the resolved type SHALL be `never`
