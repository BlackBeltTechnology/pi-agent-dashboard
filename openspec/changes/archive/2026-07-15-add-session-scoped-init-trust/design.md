## Context

TOFU trust for worktree-init hooks lives in `packages/server/src/worktree-init-trust.ts`: `isTrusted(configRoot, hash)` / `recordTrust(configRoot, hash)` persist a `Record<key, true>` to `~/.pi/dashboard/worktree-init-trust.json`, keyed by `path.resolve(configRoot) \0 hookDefHash(hook)`. The only grant is permanent. `POST /api/git/worktree/init` (`packages/server/src/routes/git-routes.ts`) records trust when `confirmHash === hash`, then runs. The client confirm dialog (`WorktreeInitButton.tsx`) has a single "Run" button. External (non-git) directories already resolve a config root via `resolveConfigRoot(cwd)` and flow through the identical trust gate.

The exploration established (and this design commits to) **server-process ephemeral** as the meaning of "session" scope: the dashboard has no stable browser-client identity (raw `ws` sockets that churn on reconnect) and the init route carries no `sessionId`, so binding to a browser client or a pi session was rejected. The honest lifetime of an in-memory grant is "until the dashboard server restarts."

## Goals / Non-Goals

**Goals:**
- Offer the user a scope choice at confirm time: ephemeral (no disk) vs persistent (today's behavior).
- Keep the trust key, hash, and re-prompt-on-edit semantics identical across scopes.
- Cover external (non-git) directories with the ephemeral option — the original motivation.
- Zero new on-disk state; smallest surface that satisfies the above.
- Backward compatible: a caller that omits scope behaves exactly as today (persistent).

**Non-Goals:**
- Per-pi-session or per-browser-client trust binding (no stable identity; route has no sessionId).
- TTL / time-based expiry of session trust.
- Any change to the auto-init-on-spawn rule: it still runs only via the manual, user-confirmed path and cannot forge trust.
- A CLI flag; the surface is UI-only (plus the route field that backs it).

## Decisions

**D1 — Two stores, OR-combined read.** Add a module-level in-memory `Set<string>` of trust keys for session scope, alongside the existing persisted JSON store for project scope. `isTrusted(configRoot, hash)` returns `sessionSet.has(key) || persistedHas(key)`. Rationale: a session grant must satisfy the gate without touching disk; a later "Always trust" for the same key writes the persisted store and the read still passes. Alternative rejected: a single store with a per-entry `{scope}` tag — more serialization surface, and the ephemeral entries must never serialize, so a physical split is clearer and safer.

**D2 — `recordTrust(configRoot, hash, scope = "project")`.** Scope defaults to `"project"` so every existing caller (and any omitted-field request) preserves today's persistent behavior. `scope === "session"` adds to the in-memory set and never calls `save()`. Rationale: backward compatibility is a hard requirement; the default is the safe (existing) path.

**D3 — Route reads + strictly validates scope from the confirm body.** `POST /api/git/worktree/init` body gains optional `scope: "session" | "project"`. When `confirmHash === hash`: an **omitted** scope is treated as `project` (backward compatibility, D2 default); a scope present and exactly `session` or `project` is honored; any other present value (typo, wrong case, empty string, non-string) is **rejected `bad_request`** — the server records nothing and runs nothing. Rationale (revised after doubt-review, both reviewers flagged this as the top severity): the original "coerce unknown → project" rule silently converted an ephemeral-intent confirm into a *permanent on-disk* grant — an upward durability escalation against the user's choice. Coercion must never increase permanence; the safe failure is a hard reject. The `init_untrusted` response and hash echo are otherwise unchanged.

**D3a — Both stores share one key derivation.** The in-memory session `Set` MUST key entries via the identical `trustKey(configRoot, hash)` helper the persisted store uses (`path.resolve(configRoot)` + `\0` + hash) — not a raw `configRoot`. Storing a raw path would let `./repo` and `/abs/repo` diverge, producing false-negative re-prompt loops and a session grant that `isTrusted` can't find. This pins contract #2 (`isTrusted` never wrong in either direction) across the OR-combine.

**D4 — Two-button confirm dialog.** The dialog replaces the single "Run" with two confirm actions: **"Trust until dashboard restarts"** (scope `session`) and **"Always trust"** (scope `project`). Both call `doRun(hash, scope)`. Labels are literal about lifetime — "session" is intentionally avoided in copy because the grant outlives a browser tab. Rationale: honest labeling was the agreed mitigation for the server-lifetime-vs-"session" mismatch.

**D5 — Session set is per-server-process, not per-anything-finer.** One process-global `Set`. A grant made from any browser client is visible to all clients until restart. Rationale: matches the "until dashboard restarts" contract exactly; finer scoping was explicitly rejected in exploration (no stable client identity).

**D6 — Purpose-built two-action dialog, not a mutated `Confirm`.** The shared `Confirm` component (`packages/client-utils/src/Confirm.tsx`) exposes a single `onConfirm` + `confirmLabel`; it structurally cannot present two affirmative actions. Both reviewers flagged this. The dialog MUST NOT be widened to two-confirm in place, which would change the a11y/focus contract for every consumer (violates surgical-changes + the component's own dialog-unification convention). Instead the `WorktreeInitButton` renders a small purpose-built dialog with Cancel · "Trust until dashboard restarts" (scope `session`) · "Always trust" (scope `project`), each calling `doRun(hash, scope)`. Scope threads through `runWorktreeInit` (`git-api.ts`), the `doRun` closure, and the dialog handlers — all previously untyped for scope.

## Risks / Trade-offs

- [The word "session" implies per-agent-session or per-tab, but it's per-server-process] → Mitigation: never label the button "this session"; use "until dashboard restarts". Spec + proposal name the scope `session` as an internal token only.
- [A malformed/unknown `scope` value could be interpreted as "no trust" and silently block, or as "session" and skip persistence unexpectedly] → Mitigation: D3 coerces anything not exactly `"session"` to `"project"`; the grant always lands in a defined store.
- [OR-combined `isTrusted` could mask a revoked project grant if a session grant lingers] → Accept: there is no revoke path today; both stores are additive-only. Restart clears the session set; deleting the JSON clears project. No new revoke semantics are introduced.
- [Server restart silently drops session trust mid-workflow, so the next run re-prompts] → Accept: this is the defined, desired behavior and is surfaced by the honest label.
- [Multi-client / multi-operator visibility (D5): a session grant is process-global; with `autoInitWorktreeOnSpawn` ON, ANY operator's later worktree spawn may auto-run the hook until restart, not just the tab that confirmed] → Accept for the common single-operator localhost case; the honest label says "until dashboard restarts" (a durability claim), and this is strictly weaker than the persisted store, which is already process-global AND survives restart. Not narrowed further because no stable per-client identity exists.
- [Post-restart nuisance: after a restart, every worktree that held session trust shows "Review & trust changes"; if its gate is already satisfied, re-confirming grants trust but runs no code — pure friction] → Accept: this is the defined cost of choosing ephemeral scope, made visible by the honest label so the user opts in knowingly. Choosing `project` avoids it.
- [Forensic regression: a session grant leaves no disk trace, so a local process that can already POST to the dashboard could run a hook once and leave no `worktree-init-trust.json` mark] → Accept: the one-shot `confirmHash`+run path already exists; ephemerality (no disk) is the explicit goal. The threat (a local process reaching the dashboard API) is out of scope for this change.
- [No downgrade path: OR-combine means a prior `project` grant cannot be reduced to `session` by later confirming with `session`; the persisted grant still satisfies `isTrusted`] → Accept: no revoke/downgrade exists today for any scope; adding one is out of scope. `session` is strictly *more* clearable than `project` (restart clears it).

## Migration Plan

Pure addition; no migration. `worktree-init-trust.json` schema is unchanged and continues to load. Old clients that never send `scope` get `"project"` (identical to today). Rollback = revert the diff; any session grants evaporate on the next restart and any project grants written meanwhile remain valid (same schema).

## Open Questions

- **init-status does not surface the active scope.** `GET /init-status` returns a scalar `trusted`; the re-trust ("Review & trust changes") dialog therefore cannot show which scope currently holds. Deferred as a follow-up UX refinement, not a requirement of this change; the scope choice still governs the *new-hash* grant's durability.
- Should the default button focus be "until dashboard restarts" to nudge toward least-privilege? Deferred to implementation/UX; not a spec requirement.

### Pre-existing, explicitly out of scope

- TOCTOU window between `recordTrust` → gate eval → `runInitHook`: a concurrent `POST /init` without `confirmHash` could observe freshly-recorded trust. Pre-existing; this change neither introduces nor worsens it.
- `save()` is a direct `writeFileSync` (not temp+rename); a crash mid-write can void the project store (`load()` fails open to `{}`). Pre-existing; unrelated to the session store, which never writes.
