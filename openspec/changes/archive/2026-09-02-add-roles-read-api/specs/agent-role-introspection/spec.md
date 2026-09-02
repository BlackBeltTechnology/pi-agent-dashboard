## Purpose

Exposes the dashboard's role→model assignments to external frontends and agent tooling over a read-only HTTP endpoint, so a consumer can display the complete role schema — including roles that are deliberately unassigned — without holding a live pi session or embedding a copy of the built-in role names.

## ADDED Requirements

### Requirement: Ungated role catalogue endpoint

The dashboard SHALL expose `GET /api/roles` returning the effective role schema without requiring a `pi-proxy-...` Bearer key and without requiring a live pi session. The endpoint SHALL be subject only to the dashboard's own auth gate, an identical posture to `GET /api/models` and `GET /api/provider-auth/status`.

The response body SHALL use the envelope `{ "object": "list", "data": [ ... ] }`, matching the model catalogue endpoint. Cross-origin access SHALL be governed by the dashboard's existing configured-origin allowlist; this endpoint SHALL NOT introduce a separate CORS mechanism.

The endpoint SHALL be contributed by the roles plugin rather than by the core server route set, so the role surface remains owned by the roles package.

#### Scenario: Roles returned without a proxy key or a session

- **GIVEN** the dashboard server is running
- **AND** no pi session is connected
- **AND** no `Authorization: Bearer pi-proxy-...` header is supplied
- **WHEN** a client GETs `/api/roles`
- **THEN** the response status SHALL be `200`
- **AND** the body SHALL be an object with `object: "list"` and an array `data`

#### Scenario: Endpoint absent when the roles plugin server entry is not loaded

- **GIVEN** the roles plugin's server entry has not been loaded
- **WHEN** a client GETs `/api/roles`
- **THEN** the response status SHALL be `404`
- **AND** no role data SHALL be served from any other path

### Requirement: Every group reports the complete role axis with unassigned roles included

The endpoint SHALL compute one canonical role-name axis and project every returned group onto it. The axis SHALL be the union of the effective role-name schema and the role names appearing in any stored preset, with removed role names excluded.

The axis is therefore a **superset** of the effective role-name schema whenever a preset references a role the live configuration does not. This SHALL NOT be treated as a disagreement with the role event surface: the two surfaces are required to agree on the effective schema and on assigned values, not on preset-only names. A role name present only because a preset references it SHALL be reported as unassigned in the live group.

A consumer SHALL be able to tell the two apart from the response alone: a row belongs to the effective schema when it is `builtin`, or when it is assigned in the live group. A row that is neither `builtin` nor assigned in the live group is present only because a preset references it. No separate discriminator field is introduced.

A role name for which a removal marker is in effect SHALL be excluded from the axis even when a preset references it, and even when the live configuration also carries an assignment for it.

Every role on the axis SHALL be present in every group's row list. A role with no assigned model SHALL be reported with `ref: null` — it SHALL NOT be omitted, and it SHALL NOT be reported as an error condition. An unassigned role is expected state.

Each row SHALL carry `role`, `ref`, and `assigned`.

When a model is assigned, the row SHALL additionally carry `model` — the assignment with any thinking-level suffix removed — and SHALL carry `thinkingLevel` when the assignment specifies one. The row SHALL carry `provider` **only when the assignment identifies one**. Legacy assignments persisted before provider prefixes were canonical are stored as bare model ids carrying no provider segment; for those the endpoint SHALL omit `provider` rather than guess it. The endpoint SHALL NOT consult a model registry to infer a missing provider, and SHALL NOT rewrite the stored value.

All of `model`, `provider`, and `thinkingLevel` SHALL be omitted when the role is unassigned.

Row order SHALL be stable across requests and identical across every group in a single response. The axis SHALL be ordered as: the effective role-name schema in its canonical order (the canonical default names first, then user-added names, then any remaining assigned names), followed by preset-only names in the order their first referencing preset is encountered in the stored preset list.

Groups SHALL be ordered with the live group first, followed by preset groups in the order the presets appear in the stored configuration.

The endpoint SHALL derive `model` and `thinkingLevel` from the stored ref by splitting on the **last** colon. A resulting empty thinking level SHALL be treated as no thinking level. A resulting empty model SHALL cause `model` to be omitted. `provider` SHALL be the segment preceding the first `/`, and SHALL be omitted when that segment is empty or when the ref contains no `/`. Splitting SHALL NOT throw for any string value: `ref` is always emitted verbatim, and only the derived parts are omitted when they cannot be determined.

#### Scenario: Unassigned built-in role is returned as null

- **GIVEN** the stored configuration assigns a model to `coding` but not to `vision`
- **WHEN** a client GETs `/api/roles`
- **THEN** the live group SHALL contain a row for `vision`
- **AND** that row SHALL report `ref: null` and `assigned: false`
- **AND** that row SHALL NOT contain `model`, `provider`, or `thinkingLevel`

#### Scenario: Assigned role reports both the composite ref and its parts

- **GIVEN** `planning` is assigned `anthropic/claude-opus-4-8:high`
- **WHEN** a client GETs `/api/roles`
- **THEN** the `planning` row SHALL report `ref: "anthropic/claude-opus-4-8:high"`
- **AND** `model: "anthropic/claude-opus-4-8"`, `provider: "anthropic"`, `thinkingLevel: "high"`
- **AND** `assigned: true`

#### Scenario: A ref carrying multiple colons splits on the last one

- **GIVEN** a role is assigned a value containing more than one colon
- **WHEN** a client GETs `/api/roles`
- **THEN** `thinkingLevel` SHALL be the segment following the final colon
- **AND** `model` SHALL be everything preceding that final colon
- **AND** `ref` SHALL equal the stored value verbatim

#### Scenario: Degenerate refs omit derived parts instead of failing

- **GIVEN** a role is assigned a degenerate value — for example one ending in a colon, beginning with a colon, or consisting only of a provider prefix
- **WHEN** a client GETs `/api/roles`
- **THEN** the response status SHALL be `200`
- **AND** `ref` SHALL equal the stored value verbatim
- **AND** any part that cannot be determined SHALL be omitted rather than emitted empty
- **AND** no unhandled error SHALL surface

#### Scenario: A legacy bare-id assignment omits provider rather than guessing

- **GIVEN** a role is assigned a legacy bare model id carrying no provider segment
- **WHEN** a client GETs `/api/roles`
- **THEN** the row SHALL report `assigned: true` and `ref` equal to the stored value verbatim
- **AND** `model` SHALL equal the stored value with any thinking-level suffix removed
- **AND** the row SHALL NOT contain `provider`
- **AND** the stored value SHALL NOT be modified

#### Scenario: Removed role names are excluded from the axis

- **GIVEN** a removal marker is in effect for a role name
- **WHEN** a client GETs `/api/roles`
- **THEN** that role name SHALL NOT appear in any group's rows

#### Scenario: A removed role is excluded even when still assigned or referenced by a preset

- **GIVEN** a removal marker is in effect for a role name
- **AND** the live configuration carries an assignment for that name, or a stored preset references it
- **WHEN** a client GETs `/api/roles`
- **THEN** that role name SHALL NOT appear in any group's rows
- **AND** the stored configuration SHALL NOT be modified

#### Scenario: A role known only to a preset still appears on the axis

- **GIVEN** a stored preset assigns a role name that the live configuration does not contain
- **WHEN** a client GETs `/api/roles`
- **THEN** that role name SHALL appear in every group's rows
- **AND** the live group SHALL report it with `ref: null`

#### Scenario: All groups share one axis

- **GIVEN** at least one preset exists
- **WHEN** a client GETs `/api/roles`
- **THEN** every element of `data` SHALL contain the same role names in the same order
- **AND** the canonical default role names SHALL precede user-added names, which SHALL precede preset-only names
- **AND** the live group SHALL be the first element of `data`, followed by preset groups in stored order
- **AND** repeating the request against an unchanged configuration SHALL yield the same order

### Requirement: Presets are reported as named role groups in the same list

Each element of `data` SHALL be a role group carrying `preset`, `active`, and `roles`. The live configuration SHALL be reported as the group with `preset: null`. Each stored preset SHALL be reported as a group whose `preset` is the preset name.

Exactly one group SHALL be marked `active: true` in every response, under all configurations including invalid ones. The endpoint SHALL normalize as follows:

- When the stored active-preset name matches exactly one stored preset, that preset's group SHALL be the active one.
- When no active preset is stored, the live group SHALL be the active one.
- When an active-preset name is stored but matches no stored preset (a dangling reference), the live group SHALL be the active one, and no preset group SHALL be marked active.
- When two stored presets share a name, they SHALL be reported as a single group, so a preset name can never mark more than one group active.

When a preset group is active, its assignments and the live group's assignments describe the same state. The endpoint SHALL NOT assume this holds for a dangling active-preset reference, and SHALL NOT reconcile the two by writing.

The response SHALL NOT carry a top-level `activePreset` key; active-ness is reported per group so the envelope stays identical to the model catalogue endpoint.

#### Scenario: Live group is always present

- **GIVEN** no presets have been created
- **WHEN** a client GETs `/api/roles`
- **THEN** `data` SHALL contain exactly one group
- **AND** that group SHALL report `preset: null` and `active: true`

#### Scenario: Each preset appears as its own group

- **GIVEN** two presets named `cheap` and `max` exist
- **WHEN** a client GETs `/api/roles`
- **THEN** `data` SHALL contain a group for `cheap` and a group for `max` in addition to the live group

#### Scenario: The active preset is flagged

- **GIVEN** the preset `cheap` is the active preset
- **WHEN** a client GETs `/api/roles`
- **THEN** the group whose `preset` is `cheap` SHALL report `active: true`
- **AND** no other group SHALL report `active: true`

#### Scenario: A dangling active-preset reference falls back to the live group

- **GIVEN** the stored active-preset name matches no stored preset
- **WHEN** a client GETs `/api/roles`
- **THEN** the live group SHALL report `active: true`
- **AND** exactly one group in `data` SHALL report `active: true`
- **AND** the stored configuration SHALL NOT be modified

#### Scenario: Duplicate preset names collapse to one group

- **GIVEN** two stored presets share the same name
- **WHEN** a client GETs `/api/roles`
- **THEN** `data` SHALL contain exactly one group for that name
- **AND** exactly one group in `data` SHALL report `active: true`

### Requirement: Rows classify built-in roles without client-side constants

Each row SHALL carry a boolean `builtin` identifying whether the role name belongs to the dashboard's canonical default role-name set. A consumer SHALL be able to distinguish built-in from user-added roles using only the response, without embedding a copy of the default role-name set.

#### Scenario: Built-in and custom roles are distinguishable from the response alone

- **GIVEN** the configuration contains a user-added role name alongside the built-in names
- **WHEN** a client GETs `/api/roles`
- **THEN** every row for a canonical default role name SHALL report `builtin: true`
- **AND** the row for the user-added role SHALL report `builtin: false`

#### Scenario: A newly added built-in role propagates without a consumer change

- **GIVEN** a new name is added to the canonical default role-name set
- **WHEN** a client GETs `/api/roles`
- **THEN** that role SHALL appear in every group with `builtin: true`
- **AND** unassigned, with `ref: null`
- **AND** no consumer-side constant SHALL require updating for it to be displayed

### Requirement: No credential material in responses

The stored configuration file that holds role assignments also holds provider credential material. The response SHALL contain role names, model references, and the derived fields defined above, and SHALL NOT contain API keys, tokens, or any other credential material from that file or its siblings.

The response SHALL be constructed field by field from the role and preset maps. It SHALL NOT be produced by serializing the parsed configuration object or any subtree of it, so that a credential-bearing key cannot reach the response by being adjacent to role data.

The guarantee covers configuration keys other than the role and preset maps. A value a user has stored **as a role assignment** is returned verbatim as that role's `ref`; the endpoint SHALL NOT silently rewrite or suppress it. This introduces no exposure the dashboard does not already have: the same value is already reported to any authenticated client by the existing role event surface and rendered by the Roles settings UI. The endpoint SHALL NOT be the component that decides a role value is secret.

#### Scenario: Credentials are absent from the payload

- **GIVEN** the stored configuration contains provider credential material alongside the roles
- **WHEN** a client GETs `/api/roles`
- **THEN** no credential value from that file SHALL appear anywhere in the response body

### Requirement: The endpoint is always answerable

The endpoint SHALL have no runtime dependency beyond reading the stored configuration. A missing, empty, or malformed configuration SHALL be treated as "no assignments" rather than as an error.

Any failure to read the configuration SHALL likewise degrade to "no assignments" rather than propagate. This includes a permission failure, the path resolving to a directory, and a file that is removed or replaced between an existence check and the read. No filesystem or parse error SHALL escape as an unhandled error.

The endpoint SHALL NOT return a service-unavailable status, SHALL NOT return a server-error status, and SHALL NOT return an empty `data` array.

#### Scenario: Fresh install returns the built-ins as unassigned

- **GIVEN** the stored configuration file does not exist
- **WHEN** a client GETs `/api/roles`
- **THEN** the response status SHALL be `200`
- **AND** `data` SHALL contain the live group
- **AND** that group SHALL contain one row per canonical default role name, each with `ref: null`
- **AND** the stored configuration file SHALL NOT be created or modified by the read

#### Scenario: Malformed configuration degrades to unassigned

- **GIVEN** the stored configuration file cannot be parsed
- **WHEN** a client GETs `/api/roles`
- **THEN** the response status SHALL be `200`
- **AND** the live group SHALL report every canonical default role name with `ref: null`

#### Scenario: An unreadable configuration degrades rather than erroring

- **GIVEN** the stored configuration path cannot be read — for example permission is denied, or the path resolves to a directory
- **WHEN** a client GETs `/api/roles`
- **THEN** the response status SHALL be `200`
- **AND** the live group SHALL report every canonical default role name with `ref: null`
- **AND** no unhandled error SHALL surface

#### Scenario: Structurally malformed sub-values do not fail the request

- **GIVEN** the stored configuration parses as JSON but contains structurally invalid role data — for example a preset list holding a non-object entry, a preset whose `roles` value is not an object, or a role whose assigned value is not a string
- **WHEN** a client GETs `/api/roles`
- **THEN** the response status SHALL be `200`
- **AND** the invalid entries SHALL be discarded rather than projected
- **AND** every remaining well-formed role and preset SHALL still be reported

### Requirement: The endpoint is read-only

`GET /api/roles` SHALL NOT modify any stored state. The capability SHALL NOT introduce HTTP methods that mutate role assignments, presets, or the active preset; mutation remains the responsibility of the existing role event protocol.

#### Scenario: Reading does not mutate

- **GIVEN** a stored configuration with assignments and presets
- **WHEN** a client GETs `/api/roles` repeatedly
- **THEN** the stored configuration SHALL be byte-identical before and after
- **AND** each response SHALL be identical

#### Scenario: Mutating methods are not offered

- **WHEN** a client issues `POST`, `PUT`, `PATCH`, or `DELETE` to `/api/roles`
- **THEN** the request SHALL NOT alter role assignments, presets, or the active preset
