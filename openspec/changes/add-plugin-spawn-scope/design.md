## Context

The dashboard spawn chain threads a small set of session options (`model`, `name`, `sessionFile`, `spawnToken`) from a plugin's `spawnSession` call down to the pi argv. Today the flow is:

```
PluginSpawnOptions ──(inline literal in server.ts spawnSession hook)──▶ spawnPiSession(cwd, SessionOptions)
  SessionOptions ──▶ buildHeadlessArgs / buildWtArgs / tmux ──▶ sessionFlagsToArgv() ──▶ argv
  SessionOptions ──▶ buildSpawnEnv() ──▶ process env
```

`sessionFlagsToArgv` (`packages/shared/src/platform/spawn-mechanism.ts`) is the single funnel every spawn mechanism already routes through, so new argv flags land in exactly one place. `buildSpawnEnv` (`packages/server/src/spawn-process/process-manager.ts`) is the single env builder. pi's CLI already supports the capability flags (`--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`, `--skill`, `--no-skills`, `-e`, `--no-extensions`) — verified against `pi --help`.

Two facts diverge from the originating issue text and shaped this design:
1. There is **no `pluginSpawnToSessionOptions` function today** — the mapping is an inline object literal inside the `spawnSession` hook (`server.ts` ~L2208). Part of this work is extracting it.
2. `PluginSpawnOptions` has **no `env` field today** — plugins cannot pass env at all. "Make raw env an internal transport detail" is pre-emptive, not a removal.

## Goals / Non-Goals

**Goals:**
- One optional `scope` block on `PluginSpawnOptions`, mapped 1:1 to pi capability flags.
- Absent-field ⇒ byte-identical argv + env (strict non-regression).
- Extract the inline mapping into a pure, unit-testable `pluginSpawnToSessionOptions`.
- Per-extension config projected to namespaced env (`PI_EXT_<NAME>_<KEY>`).

**Non-Goals:**
- Enforcing `mode`/`sandbox` (still documented host-hook limitations — untouched).
- Widening the trust gate: `spawnSession` stays gated to first-party plugins (`priority <= 100`).
- A plugin-facing `env` field — env stays an internal transport detail.
- Runtime validation of tool/skill/extension existence — pi owns that.

## Decisions

**D1 — `scope` is a nested block on `PluginSpawnOptions`, flat fields on `SessionFlags`.**
The plugin-facing type keeps the issue's `scope: {...}` nesting (1:1 story, discoverable). `SessionFlags`/`SessionOptions` (the argv builder layer) take the fields flat, matching the existing `model`/`name` convention — the argv builder wants primitives, not a sub-object. `pluginSpawnToSessionOptions` is where nested→flat happens.
_Alternative rejected:_ nested `scope` all the way down — inconsistent with the flat `model`/`name` precedent in `SessionFlags`.

**D2 — Do NOT include `noExtensions` (reversed after doubt-review).**
An earlier draft added `noExtensions?: boolean` for symmetry with `noSkills`/`noTools`. Cross-model review flagged this as a footgun: `--no-extensions` disables extension **discovery**, and the dashboard bridge extension is loaded via discovery (README: "combine `--no-extensions -e ./my-ext.ts`"). A spawned session with discovery off never loads the bridge, never registers, and the spawn watchdog reaps it — the session becomes uncontrollable. The `extensions` allowlist is *additive* (discovery still runs, bridge still loads), so it carries no such hazard. Controllability invariant > toggle symmetry.
_Alternative rejected:_ keep `noExtensions` and have the host auto-re-inject the bridge via explicit `-e <bridge-path>` — requires the host to resolve the bridge extension path and couples scope to bridge internals; disproportionate for a toggle no caller has asked for.

**D3 — Conflicting flags are both forwarded; pi arbitrates.**
If a plugin sets `noTools` + `tools`, the mapper emits both flags and lets pi decide precedence. Thinnest mapper, no hidden policy, and keeps the "absent ⇒ byte-identical" contract clean (the mapper never inspects cross-field state).
_Alternatives rejected:_ (a) validate & reject — adds an error surface and policy the mapper shouldn't own; (b) silently drop the loser — surprising, untestable intent.

**D4 — `extensionConfig` keys sanitized to valid env identifiers.**
`PI_EXT_<NAME>_<KEY>` with `<NAME>`/`<KEY>` uppercased and every char outside `[A-Z0-9_]` replaced by `_`. `my-ext`/`api.key` → `PI_EXT_MY_EXT_API_KEY`. Documented convention; avoids emitting invalid env-var names.
_Alternative rejected:_ pass verbatim — produces illegal env names (`-`, `.`) the OS/pi can't read.

**D5 — Mapper lives in `dashboard-plugin-runtime`, next to `PluginSpawnOptions`.**
Keeps the `PluginSpawnOptions → SessionOptions` transform in the same package as the input type, so plugin authors can unit-test against it without depending on the server package. `SessionOptions`/`SessionFlags` are imported from shared. The `server.ts` hook calls the mapper.
_Alternative rejected:_ mapper in the server package — couples the transform to server internals and blocks plugin-side unit tests.

**D6 — Control-channel-survival invariant (added after doubt-review).**
No `scope` field may prevent the dashboard bridge from loading/registering. Enforced structurally: the block exposes no discovery-disable toggle (D2), and `noTools` disables only model-facing tools — the bridge's WebSocket control plane is not a tool, so a scoped-down session stays abortable/registrable. This is the spec's dedicated "preserve the control channel" requirement, not an implementation afterthought.

**D7 — The mapper is total; the hook maps before enqueue (added after doubt-review).**
Plugin code is JavaScript — TypeScript types do not constrain runtime input. `pluginSpawnToSessionOptions` never throws — even on malformed containers (`scope`/array/record fields supplied as `null`, an array, or a primitive are treated as absent, not iterated). Every string forwarded to argv (`tools`/`excludeTools`/`skills`/`extensions`) or env is dropped when it is not a non-empty string or contains a NUL byte (a NUL in any argv element crashes `spawn`); `extensionConfig` entries with a non-object container or non-string value are dropped. The `spawnSession` hook calls the mapper BEFORE `pendingAutomationRunRegistry.enqueue`, closing the reviewer-flagged window where a mapper throw would strand a stale `automationRun` stamp keyed by `cwd` for the next session registering there.
_Alternative rejected:_ validate-and-reject with an error — turns a best-effort scoping call into a failure surface and still needs the enqueue-ordering fix; dropping bad entries is the least-surprising total behavior.

## Risks / Trade-offs

- **Forgeable trust gate escalates with `-e` (reviewer-flagged)** → `spawnSession` is gated only by `priority <= 100`, which a plugin sets in its own manifest — the gate is convention, not verified identity. Scope's `extensions: [-e <path>]` lets whatever passes that gate load arbitrary code into the spawned session (arbitrary code execution). This change does **not widen** the gate (same `priority <= 100` already governs spawn/abort/emit today), but it does raise the blast radius of a forged-priority plugin. Accepted as a pre-existing limitation; a follow-up to harden plugin identity (real first-party attestation) is recommended and tracked separately — out of scope here.
- **Extension/skill-path injection surface** → `-e <path>` and `--skill <path>` are single argv elements (no shell interpretation, consistent with existing `--name`/`--model` handling). No new shell surface.
- **Env-name collision across extensions** → two extensions whose normalized names collide (`my.ext` and `my-ext` both → `MY_EXT`) clobber each other's config; last-write-wins. Low likelihood; documented as a caller constraint rather than enforced (enforcing a bijective mapping is disproportionate).
- **tmux env not uniformly forwarded (reviewer-flagged)** → an already-running `pi-dashboard` tmux server supplies pane environments, so `buildSpawnEnv` alone would not carry `PI_EXT_*` into a new window — the spawn-token already works around this with per-window `-e`. Not a live risk here: plugin spawns are **headless-only**, so the env reaches the process directly. The `extensionConfig` env requirement is scoped to the headless mechanism; a future tmux/wt route for scope must add per-window injection.
- **Byte-identical regression risk** → mitigated by a dedicated test asserting argv/env equality between "no scope" and the pre-change output for the headless mechanism (and the argv builder across headless/wt/tmux).
- **Mapper extraction changes a hot path** → the extraction is behavior-preserving; the "existing fields unchanged" scenario locks it.

## Discipline Skills

Per the checkpoint tables, tasks in this change trigger:
- **`security-hardening`** — the change forwards plugin-supplied strings into spawn argv (`-e`, `--skill`, `--tools`) and into process env (`PI_EXT_*`). Untrusted-input-into-spawn is the exact trigger; validate the env-name normalization, the total-mapper input sanitization (NUL/non-string dropping, D7), and the forgeable-gate escalation (Risks) — confirm no shell interpretation is introduced.
- **`review-code`** — non-trivial change touching the shared argv builder + server spawn hook; run the inline review before commit once tests pass.

No latency/throughput budget, new endpoint, migration, or opaque-runtime-state work is involved, so `performance-optimization`, `observability-instrumentation`, `doubt-driven-review` (beyond the planning-phase pass this skill already runs), and `node-inspect-debugger` do not apply.

## Open Questions

- None blocking. Resolved by the doubt-review cross-model pass (`@propose-review-1` gpt-5.6-luna + `@propose-review-2` gpt-5.6-terra, both ran automatically): dropped `noExtensions` (D2), added the control-channel invariant (D6) and total-mapper/enqueue-ordering (D7), scoped env projection to headless, and surfaced the forgeable-gate escalation as an accepted pre-existing trade-off with a recommended follow-up.
- Env-name collision (Risks) is accepted as a documented caller constraint.
