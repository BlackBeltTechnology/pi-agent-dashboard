## Context

`add-plugin-spawn-scope` (#473) adds a `scope` block to `PluginSpawnOptions` and threads flat capability fields (`tools`, `excludeTools`, `noBuiltinTools`, `noTools`, `skills`, `noSkills`, `extensions`, `extensionConfig`) through `SessionFlags`/`SessionOptions` → `sessionFlagsToArgv` (argv) + `buildSpawnEnv` (`PI_EXT_*` env). That vocabulary is caller-supplied and travels with a plugin spawn.

This change adds the missing dimension: policy the **host** applies by **cwd**, to spawns it did not originate. The spawn funnel:

```
spawnPiSession(cwd, options)                 ← packages/server/src/spawn-process/process-manager.ts L433
  opts = { ...(options ?? {}), spawnToken }  ← L446  (THE merge insertion point)
  → chooseMechanism → buildHeadlessArgs / buildWtArgs / tmux → sessionFlagsToArgv → argv
  → buildSpawnEnv → env
```

Both plugin spawns (`server.ts` `spawnSession` hook → `spawnPiSession`) and generic spawns (`session-api.ts` user/degrade/reload → `spawnPiSession`) cross this one function. Inserting the policy merge at L446 reaches every path with no per-mechanism wiring.

## Goals / Non-Goals

**Goals:**
- Host-registered, cwd-keyed policy applied to ANY spawn (plugin-originated or generic) landing in a registered dir.
- Non-weakening composition with a spawn's own `scope`: host policy can only tighten the caller's tool/skill surface.
- Idempotent `unregisterCwdPolicy`.
- No matching policy ⇒ argv + env byte-identical to today.

**Non-Goals:**
- New argv/env *emission* — this change only populates the #473 fields from policy; #473 owns emission. (Hard dependency.)
- An ops-config policy source (`settings.json` / config file) — deferred (Open Question 1).
- Enforcing `mode`/`sandbox` — unchanged host-hook limitations, out of scope.
- Runtime validation of tool/skill/extension existence — pi owns that.
- Hardening the forgeable `priority <= 100` trust gate — pre-existing, tracked separately (inherited from #473 Risks).

## Decisions

**D1 — Merge at `spawnPiSession`, the single funnel.**
The policy merge lands at `process-manager.ts` L446 where `options` is already spread. Every mechanism routes through here, so generic (non-plugin) spawns — the entire point of this change — are covered without touching `session-api.ts`, tmux, or wt builders.
_Alternative rejected:_ merge in each caller (`session-api`, `server.ts` hook) — misses paths, duplicates policy, and the generic path is exactly the one a per-caller approach forgets.

**D2 — `mergeCwdPolicy(policy, options)` is pure, non-weakening, AND order-independent; it handles ONLY tightening fields (reshaped after cycle-2 review).**
The merge never loosens the caller's surface. It composes ONLY these fields — every operator here is commutative + associative, so composing 3+ ancestor policies is order-independent (contract invariant e):

| field | compose rule (policy ∘ caller) | omitted-side semantics | rationale |
|---|---|---|---|
| `tools` (allowlist) | **INTERSECTION** | an ABSENT allowlist = "no constraint from that side" = the universe; so policy-present + caller-absent ⇒ **policy's list applies** (the host restriction takes effect — NOT treated as "caller unrestricted"); caller-present + policy-absent ⇒ caller's list unchanged | both must permit → strictly ≤ either |
| `skills` (allowlist) | **INTERSECTION** | same omitted-side rule as `tools` | tightening only |
| `excludeTools` (denylist) | **UNION** | absent = empty set | either may ban |
| `noBuiltinTools` / `noTools` / `noSkills` | **OR** (sticky-true) | absent = false | either true ⇒ true |

`extensions` and `extensionConfig` are DELIBERATELY NOT composed by `mergeCwdPolicy` in this change. Cycle-2 review proved `extensions = UNION` is a *widening* (adding executable capability) and `extensionConfig` policy-wins is *order-dependent* — both contradict the non-weakening + order-independence invariants. Since no shipping path produces extension-bearing policies (plugin path rejects them, D3; ops-config deferred), the merge simply omits them. The deferred ops-config change will define extension composition as an EXPLICIT trusted-operator widening, governed by its own rule — NOT smuggled under the caller-non-weakening contract (review finding 9).
Purity keeps it unit-testable; empty/absent policy ⇒ `options` returned unchanged (byte-identical guarantee).
_Alternative rejected:_ keep extension UNION now “for completeness” — it makes the function violate its own advertised invariants and forces order-dependent output; building merge logic for a deferred, differently-governed feature is premature.

**D3 — Plugin-facing policies are tighten-only; extension INJECTION is deferred to ops-config (reversed after cross-model review).**
An earlier draft let a policy add `extensions`/`extensionConfig` (host injects an audit logger into every session in a dir). Cross-model review flagged this as a privilege EXPANSION: a plugin registering a policy for an arbitrary directory (even `$HOME`) could load executable code (`-e <path>`) into unrelated user sessions it never spawned — reach far beyond constraining its own spawns. Resolution: the **plugin-facing** `registerCwdPolicy` accepts ONLY tightening fields (`tools`, `excludeTools`, `noBuiltinTools`, `noTools`, `skills`, `noSkills`). If a plugin supplies `extensions`/`extensionConfig`, registration is **REJECTED with an observable error** — NOT silently dropped (cycle-2 review finding 8: a silent drop makes a failed registration indistinguishable from success, a fail-open config error for code relying on registration as enforcement). The ONLY producer of extension-injecting policies is the deferred ops-config source (Open Question 1) — an operator editing a config file, not a plugin. In THIS change no shipping entry point injects extensions, and `mergeCwdPolicy` does not compose them (D2).
_Alternative rejected:_ silently drop the fields — fail-open; the plugin proceeds believing its policy applied. Rejecting is fail-closed + observable.

**D4 — Nesting: compose-all-ancestors, not longest-prefix.**
When multiple registered dirs are ancestors of the spawn cwd, `resolveCwdPolicy` composes **every** matching ancestor's policy (via `mergeCwdPolicy`, associatively), so a broad ban at `~/work` cannot be escaped by registering a narrower, looser policy at `~/work/secrets`. This intentionally diverges from `resource-origin.ts`'s longest-prefix-wins (which is a *classification*, not a *security floor*). Match is by resolved absolute path prefix at a path-segment boundary (no `~/workshop` false-match on `~/work`).
_Alternative rejected:_ longest-prefix-wins (mirror `resource-origin.ts`) — lets a narrow registration *loosen* a broad one, the exact escape the non-weakening rule exists to prevent.

**D5 — Registry is per-plugin-owned; funnel reads a single wired instance; policies COMPOSE never OVERWRITE (reshaped after review).**
`registerCwdPolicy`/`unregisterCwdPolicy` are exposed on `ServerPluginContext`, gated to first-party/trusted plugins by the same gate as `spawnSession` (`priority <= 100`); untrusted plugins get a no-op hook. The registry keys entries by **`(pluginId, resolvedCwd)`**, not `cwd` alone — so one plugin can neither overwrite nor unregister another plugin's policy (review finding 2). `unregisterCwdPolicy(cwd)` removes ONLY the calling plugin's entry for that cwd. `resolveCwdPolicy(cwd)` composes EVERY registered entry (across all plugins AND all matching ancestor dirs) via `mergeCwdPolicy` — a second registration at the SAME path composes with the first, it never replaces it (review finding 3; replacement could weaken). A single registry instance is constructed once and injected into BOTH the spawn funnel and every `createServerPluginContext` (server.ts wiring), so no spawn path or context sees a different registry (review finding 8). Ops-config source deferred (Open Question 1).
_Alternative rejected:_ a `Map<resolvedCwd, policy>` keyed by cwd alone — lets plugin B clobber plugin A's ban and lets same-path re-registration weaken a floor; both violate the non-weakening contract.

**D6 — Keys canonicalize the longest EXISTING prefix; match is fail-toward-applying; register deep-freezes; lifecycle-scoped.**
Register and resolve both canonicalize a path by `fs.realpathSync` on its **longest existing ancestor** and appending any not-yet-existing trailing segments lexically — so a policy registered for a not-yet-created dir under a SYMLINKED ancestor still keys to the same canonical prefix the spawn will resolve to (cycle-1 finding 4 + cycle-2 finding 4: a plain `realpathSync`-fails→`path.resolve` fallback would store the lexical symlink spelling and then miss the canonicalized spawn key). On Windows the key is case-folded (finding 5). To avoid a fail-OPEN symlink-swap (cycle-2 finding 5 — a registered path later becomes a symlink pointing elsewhere), `resolveCwdPolicy` matches an entry when the spawn cwd is within the registered dir under **EITHER** its canonical OR its lexical form (a tightening floor over-applying is safe; under-applying is the danger). `registerCwdPolicy` stores a deep-frozen copy (finding 9 — no post-register mutation). Unregistering an unregistered `(pluginId, cwd)` is a no-op. On plugin unload/disable the host drops ALL that plugin's entries (finding 6).
_Alternative rejected:_ realpath-or-fail-to-lexical + match on canonical only — both the register/spawn key-divergence (finding 4) and the symlink-swap fail-open (finding 5) slip through.

**D7 — Registration targets are bounded to workspace roots; overly-broad targets rejected (added after cycle-2 review).**
To bound the denial-of-capability blast radius of a forged/compromised `priority<=100` plugin (cycle-2 finding 10 — registering `/` or `$HOME` with `{noTools:true}` would strip tools from EVERY session), `registerCwdPolicy` REJECTS a target that is not within a workspace/project root the host recognizes, and unconditionally rejects the filesystem root and the user home directory itself. A plugin can constrain sessions inside a known workspace, not the whole machine.
_Alternative rejected:_ accept any absolute path — turns a forged low-priority plugin into a global capability-DoS vector.

## Risks / Trade-offs

- **Inherited forgeable trust gate (blast-radius sharpened)** → `registerCwdPolicy` rides the same `priority <= 100` convention as `spawnSession`; a forged-priority plugin gains the NEW register surface. Because plugin policies are now tighten-only (D3), the worst a forged plugin can do is *over-constrain* other sessions in a dir (a denial-of-capability, not code injection) — strictly less dangerous than #473's `-e` spawn escalation. Extension injection (the code-loading vector) is unreachable via the plugin path. Accepted; real first-party attestation tracked separately.
- **Compose-all-ancestors cost** → `resolveCwdPolicy` walks ancestor prefixes per spawn. Registry is small (a handful of sensitive dirs) and spawn is not hot; O(registered entries) per spawn is negligible. No index needed.
- **Filesystem TOCTOU (accepted limitation)** → resolving/matching the cwd before spawn does not guarantee the child lands in the same physical dir if a symlink/dir component is swapped between resolution and spawn. Inherent to every cwd-keyed check in the codebase (`resource-origin`, trust store); the D6 canonical-OR-lexical match reduces the fail-OPEN window (a swapped symlink still matches the lexical form), but does not fully close TOCTOU. Documented, not fixed.
- **Allowlist intersection is literal-token (accepted limitation)** → `tools`/`skills` intersection is set-intersection over the literal tokens pi consumes (cycle-2 finding 7). If pi later supports group/pattern/alias tokens, a group in one side and a literal in the other will not intersect semantically; a policy author must express the allowlist at the same granularity pi enforces. Normalizing tool taxonomies is a pi-side concern, out of scope here.
- **Byte-identical regression risk** → mitigated by a dedicated test asserting argv/env equality between "no registered policy" and pre-change `spawnPiSession` output.
- **Interaction with #473 not-yet-merged** → this change is unbuildable until #473 lands (it consumes #473's flat fields + emission). Sequenced after #473; `ship-it` must not start this worktree before #473 is merged.

## Discipline Skills

Per the checkpoint tables, tasks in this change trigger:
- **`security-hardening`** — host policy injects capability constraints (and, per D3, extensions/env) into sessions the user did not opt into; the non-weakening invariant, the compose-all-ancestors anti-escape (D4), and the D3 widening reach are the exact untrusted-boundary surfaces to audit. Also re-verify no path lets a caller `scope` loosen a host policy.
- **`review-code`** — non-trivial change to the shared spawn funnel + a new registry with a security-load-bearing merge; run inline review before commit once tests pass.

No latency/throughput budget (spawn is not hot), new external endpoint, migration, or opaque-runtime-state work applies, so `performance-optimization`, `observability-instrumentation`, and `node-inspect-debugger` do not.

## Open Questions

Carried from proposal (recommended defaults recorded; re-decidable before the boundary):
1. **Policy source** — plugin-facing tighten-only ships now (D3/D5); the ops-config source that ALSO carries extension injection is deferred to a follow-up. Confirm plugin-tighten-only-first, or pull the ops-config injector into this change's scope.
2. **Nesting semantics** — compose-all-ancestors (D4). Confirm.
3. **Extension injection & its composition** — RESOLVED by cross-model review: removed from the plugin-facing path (privilege-expansion hole) AND from `mergeCwdPolicy` (its UNION/policy-wins semantics violated non-weakening + order-independence, cycle-2 findings 1–3,9). The deferred ops-config change MUST define extension composition as an EXPLICIT trusted-operator widening under its own rule — not under the caller-non-weakening contract. Flagged for that follow-up's design.
4. **Workspace-root recognition (D7)** — registration targets are bounded to "a workspace/project root the host recognizes." The exact source of that root set (dashboard workspace config vs. session cwd registry) is an implementation detail to confirm at build time; the invariant (reject `/`, `$HOME`, and non-workspace targets) is fixed.
