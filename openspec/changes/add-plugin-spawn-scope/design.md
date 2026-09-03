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

**D8 — `extensionConfig` values are `string | string[]`; arrays are JSON-encoded into env, scalars verbatim (added during consolidation).**
Real config fields the guard follow-up (#474) needs — `allowedRoots`, `deniedTools` — are ARRAYS, but the original type was `Record<string, Record<string, string>>` (scalars only). The API type widens to `Record<string, Record<string, string | string[]>>`. At the env boundary a scalar `string` projects **verbatim** (`PI_EXT_MYEXT_TOKEN=abc` — unchanged), and a `string[]` projects as **`JSON.stringify(value)`** (`PI_EXT_GUARD_ALLOWED_ROOTS=["/a","/b"]`); the consuming extension `JSON.parse`s array-typed keys (each extension knows its own key types, so there is no decode ambiguity). JSON — not a `splitList` delimiter-join — because the values are frequently filesystem paths, and every delimiter is unsafe for paths (`,` is legal in paths; `:`/`;` collide with Windows drive letters and Unix path segments); JSON is lossless, unambiguous, and type-preserving. A round-trip test (`["/a", "/b,c", " /d "]` → env → parse → deep-equals) locks it as a SHALL.
_Alternative rejected:_ `splitList` delimiter-join — never lossless for arbitrary paths; the delimiter choice is a permanent latent bug for the exact value type (paths) this carries. _Also rejected:_ JSON-encode everything including scalars — needlessly breaks the readable `PI_EXT_*=value` convention and the existing scalar scenario for no gain.

## Risks / Trade-offs

- **Forgeable trust gate escalates with `-e` (reviewer-flagged)** → `spawnSession` is gated only by `priority <= 100`, which a plugin sets in its own manifest — the gate is convention, not verified identity. Scope's `extensions: [-e <path>]` lets whatever passes that gate load arbitrary code into the spawned session (arbitrary code execution). This change does **not widen** the gate (same `priority <= 100` already governs spawn/abort/emit today), but it does raise the blast radius of a forged-priority plugin. Accepted as a pre-existing limitation; a follow-up to harden plugin identity (real first-party attestation) is recommended and tracked separately — out of scope here.
- **Extension/skill-path injection surface** → `-e <path>` and `--skill <path>` are single argv elements (no shell interpretation, consistent with existing `--name`/`--model` handling). No new shell surface.
- **Env-name collision across extensions** → two extensions whose normalized names collide (`my.ext` and `my-ext` both → `MY_EXT`) clobber each other's config; last-write-wins. Low likelihood; documented as a caller constraint rather than enforced (enforcing a bijective mapping is disproportionate).
- **tmux env not uniformly forwarded (reviewer-flagged)** → an already-running `pi-dashboard` tmux server supplies pane environments, so `buildSpawnEnv` alone would not carry `PI_EXT_*` into a new window — the spawn-token already works around this with per-window `-e`. Not a live risk here: plugin spawns are **headless-only**, so the env reaches the process directly. The `extensionConfig` env requirement is scoped to the headless mechanism; a future tmux/wt route for scope must add per-window injection.
- **Byte-identical regression risk** → mitigated by a dedicated test asserting argv/env equality between "no scope" and the pre-change output for the headless mechanism (and the argv builder across headless/wt/tmux).
- **Mapper extraction changes a hot path** → the extraction is behavior-preserving; the "existing fields unchanged" scenario locks it.

## Part B — `host-cwd-policy` (#475), folded

**Folding note:** #475 was planned as a separate change that *depends on* #473's flat fields + emission. Folded into this one change, that cross-change dependency dissolves — B builds directly on Part A's `SessionFlags`/`SessionOptions` fields and `sessionFlagsToArgv`/`buildSpawnEnv` in the same branch. The former "unbuildable until #473 merges" risk is removed; the only sequencing left is intra-change (implement Part A's fields before Part B's merge step). Part B's decisions (relabelled B1–B7 to avoid clashing with A's D1–D8) carry the two cross-model doubt-review cycles verbatim.

**Context.** The merge lands at `spawnPiSession(cwd, options)` (`process-manager.ts`, where `opts = { ...(options ?? {}), spawnToken }`). Both plugin spawns (`server.ts` `spawnSession` hook) and generic spawns (`session-api.ts` user/degrade/reload) cross this one function with `cwd` in hand, so inserting the policy merge here reaches every path with no per-mechanism wiring.

**B1 — Merge at `spawnPiSession`, the single funnel.** Every mechanism routes through here, so generic (non-plugin) spawns — the entire point of B — are covered without touching `session-api.ts`, tmux, or wt builders. _Rejected:_ merge in each caller — misses paths, duplicates policy, and the generic path is exactly the one a per-caller approach forgets.

**B2 — `mergeCwdPolicy(policy, options)` is pure, non-weakening, AND order-independent; tightening fields only (reshaped after cycle-2 review).** Composes ONLY: `tools`/`skills` → INTERSECTION (an ABSENT allowlist = the universe, so policy-present + caller-absent ⇒ the policy's list applies — the host restriction takes effect, NOT "caller unrestricted"); `excludeTools` → UNION; `noBuiltinTools`/`noTools`/`noSkills` → sticky-OR. Every operator is commutative + associative → composing 3+ ancestor policies is order-independent. `extensions`/`extensionConfig` are DELIBERATELY NOT composed: cycle-2 review proved `extensions = UNION` is a *widening* and `extensionConfig` policy-wins is *order-dependent* — both contradict the invariants. No shipping path produces extension-bearing policies (plugin path rejects them, B3; ops-config deferred), so the merge omits them. Empty/absent policy ⇒ `options` unchanged (byte-identical guarantee). _Rejected:_ keep extension UNION "for completeness" — makes the function violate its own advertised invariants.

**B3 — Plugin-facing policies are tighten-only; extension INJECTION is deferred to ops-config (reversed after cross-model review).** The plugin-facing `registerCwdPolicy` accepts ONLY tightening fields. If a plugin supplies `extensions`/`extensionConfig`, registration is **REJECTED with an observable error** — NOT silently dropped (cycle-2 finding 8: a silent drop makes a failed registration indistinguishable from success, fail-open). A plugin registering a policy for an arbitrary dir (even `$HOME`) that could load `-e <path>` into unrelated user sessions is a privilege EXPANSION the forgeable `priority<=100` gate cannot authorize. The ONLY producer of extension-injecting policies is the deferred ops-config source (an operator editing config, not a plugin). _Rejected:_ silently drop the fields — fail-open.

**B4 — Nesting: compose-all-ancestors, not longest-prefix.** When multiple registered dirs are ancestors of the spawn cwd, `resolveCwdPolicy` composes **every** matching ancestor's policy (via `mergeCwdPolicy`, associatively), so a broad ban at `~/work` cannot be escaped by a narrower, looser policy at `~/work/secrets`. Diverges from `resource-origin.ts`'s longest-prefix-wins (a *classification*, not a *security floor*). Match is by resolved absolute path prefix at a path-segment boundary (no `~/workshop` false-match on `~/work`). _Rejected:_ longest-prefix-wins — lets a narrow registration *loosen* a broad one, the exact escape the non-weakening rule prevents.

**B5 — Registry is per-plugin-owned; funnel reads a single wired instance; policies COMPOSE never OVERWRITE (reshaped after review).** Keys entries by **`(pluginId, resolvedCwd)`**, not `cwd` alone — so one plugin can neither overwrite nor unregister another's policy (finding 2). `unregisterCwdPolicy(cwd)` removes ONLY the caller's entry. `resolveCwdPolicy(cwd)` composes EVERY registered entry (across all plugins AND matching ancestors) via `mergeCwdPolicy` — a second registration at the SAME path composes with the first, never replaces it (finding 3). A single registry instance is injected into BOTH the spawn funnel and every `createServerPluginContext` (finding 8). _Rejected:_ `Map<cwd, policy>` keyed by cwd alone — lets plugin B clobber plugin A's ban and lets same-path re-registration weaken a floor.

**B6 — Keys canonicalize the longest EXISTING prefix; match is fail-toward-applying; register deep-freezes; lifecycle-scoped.** Register and resolve both canonicalize via `fs.realpathSync` on the **longest existing ancestor** + lexical trailing segments — so a policy for a not-yet-created dir under a SYMLINKED ancestor still keys to the same canonical prefix the spawn resolves to (cycle-1 finding 4 + cycle-2 finding 4). On Windows the key is case-folded (finding 5). To avoid a fail-OPEN symlink-swap (cycle-2 finding 5), `resolveCwdPolicy` matches when the spawn cwd is within the registered dir under **EITHER** its canonical OR lexical form (a tightening floor over-applying is safe; under-applying is the danger). `registerCwdPolicy` stores a deep-frozen copy (finding 9). On plugin unload/disable the host drops ALL that plugin's entries (finding 6). _Rejected:_ realpath-or-fail-to-lexical + match on canonical only — both the key-divergence (finding 4) and the symlink-swap fail-open (finding 5) slip through.

**B7 — Registration targets are bounded to workspace roots; overly-broad targets rejected (added after cycle-2 review).** To bound the denial-of-capability blast radius of a forged `priority<=100` plugin (cycle-2 finding 10 — registering `/` or `$HOME` with `{noTools:true}` strips tools from EVERY session), `registerCwdPolicy` REJECTS a target not within a workspace/project root the host recognizes, and unconditionally rejects filesystem root + user home. _Rejected:_ accept any absolute path — turns a forged low-priority plugin into a global capability-DoS vector.

**Part B risks (folded):** inherited forgeable trust gate (blast-radius sharpened — plugin policies are tighten-only, so the worst is over-constraining, a denial-of-capability, strictly less dangerous than A's `-e` escalation); compose-all-ancestors cost is O(registered entries) per spawn (negligible, spawn not hot); filesystem TOCTOU is an accepted inherent limitation (D6 canonical-OR-lexical match narrows the fail-open window but does not close it); allowlist intersection is literal-token (accepted — pi owns tool taxonomy). The former "interaction with #473 not-yet-merged" risk is REMOVED by folding.

## Discipline Skills

Per the checkpoint tables, tasks in this change trigger:
- **`security-hardening`** — the change forwards plugin-supplied strings into spawn argv (`-e`, `--skill`, `--tools`) and into process env (`PI_EXT_*`). Untrusted-input-into-spawn is the exact trigger; validate the env-name normalization, the total-mapper input sanitization (NUL/non-string dropping, D7), and the forgeable-gate escalation (Risks) — confirm no shell interpretation is introduced.
- **`review-code`** — non-trivial change touching the shared argv builder + server spawn hook; run the inline review before commit once tests pass.

No latency/throughput budget, new endpoint, migration, or opaque-runtime-state work is involved, so `performance-optimization`, `observability-instrumentation`, `doubt-driven-review` (beyond the planning-phase pass this skill already runs), and `node-inspect-debugger` do not apply.

## Open Questions

**Part A (plugin-spawn-scope):**
- None blocking. Resolved by the doubt-review cross-model pass (`@propose-review-1` gpt-5.6-luna + `@propose-review-2` gpt-5.6-terra): dropped `noExtensions` (D2), added the control-channel invariant (D6) and total-mapper/enqueue-ordering (D7), scoped env projection to headless, added the `string | string[]` JSON encoding (D8), and surfaced the forgeable-gate escalation as an accepted pre-existing trade-off with a recommended follow-up.
- Env-name collision (Risks) is accepted as a documented caller constraint.

**Part B (host-cwd-policy):**
1. **Policy source** — plugin-facing tighten-only ships now (B3/B5); the ops-config source that ALSO carries extension injection is deferred to a follow-up. Confirm plugin-tighten-only-first, or pull the ops-config injector into scope.
2. **Nesting semantics** — compose-all-ancestors (B4). Confirm.
3. **Extension injection & its composition** — RESOLVED by cross-model review: removed from the plugin-facing path AND from `mergeCwdPolicy`. The deferred ops-config change MUST define extension composition as an EXPLICIT trusted-operator widening under its own rule.
4. **Workspace-root recognition (B7)** — the exact source of the recognized-root set is an implementation detail to confirm at build time; the invariant (reject `/`, `$HOME`, non-workspace targets) is fixed.

**Deferred — `path-containment-guard` (#474):** confirmed a from-scratch build, NOT a refactor — no `SessionGuardPolicy` / `collectPathCandidates` / `pathWithinRoots` exists in the host to extract. Re-scope the issue and plan it as its own change (with its own doubt-review) consuming Part A's `string[]` `extensionConfig` (D8). Not designed here.
