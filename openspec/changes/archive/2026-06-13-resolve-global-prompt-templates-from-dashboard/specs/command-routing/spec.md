## ADDED Requirements

### Requirement: Global prompt template resolution

`resolveTemplate` in `packages/extension/src/prompt-expander.ts` SHALL resolve registered prompt templates in addition to skills when falling back to `pi.getCommands()` (Step 3). For each candidate name variant (original-form-first), the resolver SHALL match an entry whose `name` equals the candidate AND whose `source` is EITHER `"skill"` OR `"prompt"`, using the entry's path field, and SHALL return the first match found.

The resolver SHALL NOT add directory scanning for prompt templates — `pi.getCommands()` already returns every prompt template (global, project, package) with its absolute path.

Skill resolution and original-form-first precedence SHALL remain unchanged.

#### Scenario: Global prompt template resolved via pi.getCommands()
- **WHEN** `pi.getCommands()` returns `{ name: "session-summary", source: "prompt", path: <abs path to on-disk template> }` AND the dashboard sends `/session-summary`
- **THEN** `resolveTemplate` SHALL return the template's path with `source: "prompt"`
- **AND** `expandPromptTemplateFromDisk` SHALL expand it and call `pi.sendUserMessage(<expanded>, { deliverAs })`
- **AND** SHALL NOT pass the raw `/session-summary` text to the LLM

#### Scenario: Skill resolution unaffected
- **WHEN** `pi.getCommands()` returns `{ name: "opsx:archive", source: "skill", path: <abs> }` AND the dashboard sends `/opsx:archive`
- **THEN** `resolveTemplate` SHALL return the skill's path with `source: "skill"` (unchanged behavior)

#### Scenario: Unrecognized slash still falls through
- **WHEN** `pi.getCommands()` contains no entry named `totally-unknown` of source `skill` or `prompt`
- **THEN** `resolveTemplate` SHALL return `null` and the handler SHALL fall through to `pi.sendUserMessage`

## MODIFIED Requirements

### Requirement: Bridge feature-detects pi.dispatchCommand
The bridge's `sessionPrompt` callback in `packages/extension/src/bridge.ts` SHALL feature-detect the presence of `pi.dispatchCommand` at call time via `hasDispatchCommand(pi)` in `packages/extension/src/bridge-context.ts`.

`hasDispatchCommand` SHALL:
- Return `false` when `pi` is `null` or `undefined`.
- Fast path: return `true` when `typeof (pi as any).dispatchCommand === "function"`.
- Fallback: when the fast path is false, check `"dispatchCommand" in (pi as object)` and return `true` only when a guarded `typeof` on the resolved value is `"function"` (handles getter-backed / Proxy-hidden properties).
- Return `false` for non-function values.

The bridge SHALL NOT cache the feature-detection result across `sessionPrompt` invocations.

The bridge SHALL NOT use pi version strings, semver checks, or any other version-sniffing mechanism for this gate.

#### Scenario: dispatchCommand is a plain function
- **WHEN** `hasDispatchCommand({ dispatchCommand: () => {} })` is called
- **THEN** SHALL return `true`

#### Scenario: dispatchCommand is getter-backed / Proxy-hidden
- **WHEN** `hasDispatchCommand` is called with a `pi` whose `dispatchCommand` resolves to a function only via a getter or Proxy `get` trap (not enumerable via plain `typeof` access)
- **THEN** the `in`-operator fallback SHALL detect it and SHALL return `true`

#### Scenario: dispatchCommand absent
- **WHEN** `hasDispatchCommand({})` is called
- **THEN** SHALL return `false`

#### Scenario: dispatchCommand is not a function
- **WHEN** `hasDispatchCommand({ dispatchCommand: "yes" })` is called
- **THEN** SHALL return `false`

#### Scenario: pi is null or undefined
- **WHEN** `hasDispatchCommand(null)` or `hasDispatchCommand(undefined)` is called
- **THEN** SHALL return `false`
