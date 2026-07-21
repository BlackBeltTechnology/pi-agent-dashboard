## ADDED Requirements

### Requirement: Optional grammar config block

`DashboardConfig` SHALL support an optional `grammar` block, parsed by
`parseGrammarConfig(raw)` and wired into `loadConfig()`. A config file that omits `grammar`
SHALL parse successfully and yield the disabled default. `parseGrammarConfig` SHALL coerce
and clamp values and ignore unknown fields, mirroring the existing `parseOpenSpecPollConfig`
pattern.

The block shape SHALL be:

```ts
grammar?: {
  enabled: boolean;                 // default false
  backend: "llm" | "languagetool";  // default "languagetool"
  autoCheck: boolean;               // default true
  debounceMs: number;               // default 1200, clamp 300–10000
  minChars: number;                 // default 12, clamp 1–500
  maxChars: number;                 // default 4000, clamp 100–20000
  language: string;                 // default "auto"
  languagetool?: { url: string };   // default "http://localhost:8081"
  llm?: { provider: string; model: string };
}
```

#### Scenario: Config without grammar block
- **WHEN** `~/.pi/dashboard/config.json` has no `grammar` key
- **THEN** `loadConfig()` SHALL succeed
- **AND** the resolved `grammar` SHALL be the disabled default (`enabled: false`,
  `backend: "languagetool"`, `autoCheck: true`, `debounceMs: 1200`, `minChars: 12`,
  `maxChars: 4000`, `language: "auto"`)

#### Scenario: Out-of-range numerics are clamped
- **WHEN** the config sets `grammar.debounceMs: 50`, `grammar.maxChars: 999999`
- **THEN** `parseGrammarConfig` SHALL clamp them to `300` and `20000` respectively

#### Scenario: Unknown fields ignored
- **WHEN** the config includes an unrecognised `grammar.foo` field
- **THEN** it SHALL be ignored and the remaining valid fields SHALL parse normally

#### Scenario: Invalid backend falls back to default
- **WHEN** `grammar.backend` is not `"llm"` or `"languagetool"`
- **THEN** `parseGrammarConfig` SHALL default it to `"languagetool"`
