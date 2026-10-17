## ADDED Requirements

### Requirement: Optional mermaidRepair config block

`DashboardConfig` SHALL support an optional `mermaidRepair` block, parsed by `parseMermaidRepairConfig(raw)` and wired into `loadConfig()`, so the resolved block is served by `GET /api/config`. A config file that omits `mermaidRepair` SHALL parse successfully and yield the disabled default. The parser SHALL coerce and clamp values, fall back to defaults for wrong-typed fields, and ignore unknown fields.

The resolved shape SHALL be:

```ts
mermaidRepair: {
  enabled: boolean;    // default false
  model?: string;      // "provider/id" (id passed verbatim)
  maxChars: number;    // default 20000, clamp 1000–50000
  timeoutMs: number;   // default 30000, clamp 5000–120000
  disabledReason?: "no_model" | "role_refs_unsupported";
}
```

`enabled: true` without a `model` SHALL resolve to `enabled: false` with `disabledReason: "no_model"`. A `model` starting with `@` SHALL resolve to `enabled: false` with `disabledReason: "role_refs_unsupported"`. The block SHALL contain no credentials.

#### Scenario: Config without mermaidRepair block
- **WHEN** `~/.pi/dashboard/config.json` has no `mermaidRepair` key
- **THEN** `loadConfig()` SHALL succeed and the resolved `mermaidRepair` SHALL be `{ enabled: false, maxChars: 20000, timeoutMs: 30000 }`

#### Scenario: Out-of-range numerics are clamped
- **WHEN** the config sets `mermaidRepair.maxChars: 999999` and `mermaidRepair.timeoutMs: 10`
- **THEN** the parser SHALL clamp them to `50000` and `5000`

#### Scenario: Wrong-typed fields fall back to defaults
- **WHEN** the config sets `mermaidRepair` to a non-object, or sets `enabled: "yes"`, `model: 42` or `maxChars: "big"`
- **THEN** the affected fields SHALL take their defaults and `loadConfig()` SHALL succeed

#### Scenario: Unknown fields ignored
- **WHEN** the config sets `mermaidRepair.foo: 1` alongside valid fields
- **THEN** the resolved block SHALL NOT contain `foo` and the valid fields SHALL be kept

#### Scenario: Enabled without model is disabled
- **WHEN** the config sets `mermaidRepair.enabled: true` and no `model`
- **THEN** the resolved `enabled` SHALL be `false` and `disabledReason` SHALL be `"no_model"`

#### Scenario: Role ref is disabled
- **WHEN** the config sets `mermaidRepair.enabled: true` and `model: "@fast"`
- **THEN** the resolved `enabled` SHALL be `false` and `disabledReason` SHALL be `"role_refs_unsupported"`

#### Scenario: Served by GET /api/config
- **WHEN** a guarded client calls `GET /api/config` with `mermaidRepair` enabled and a `provider/id` model configured
- **THEN** the response `data.mermaidRepair` SHALL carry the resolved `enabled`, `model`, `maxChars` and `timeoutMs` and no credential fields

#### Scenario: Disabled reason served by GET /api/config
- **WHEN** `mermaidRepair` resolves to disabled with a `disabledReason`
- **THEN** `GET /api/config` `data.mermaidRepair.disabledReason` SHALL carry that reason
