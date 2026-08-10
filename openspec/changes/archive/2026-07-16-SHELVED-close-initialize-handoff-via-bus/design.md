# Design — project-init provision-and-verify via bus-client

## Context

`project-init` (bundled in `packages/extension/.pi/skills/project-init/`) runs as
a **dashboard-spawned session** (the `ProjectInitButton` → spawn-session path from
`distinguish-initialize-actions`). It scaffolds config and today ends at Step 7
with "click Initialize again."

The shipped bus-client (`@blackbelt-technology/pi-dashboard-bus-client` v0.5.4)
exposes a headless, ticket-authenticated surface usable from a `.ts` script the
skill runs via `bash`:

```ts
const dash = await connect();                 // loopback port-discovery + WS ticket
const sid  = await dash.spawn({ cwd });        // typed Tier-1 verb, returns sessionId
await dash.until(sid, "idle", { timeout });    // correlated wait on the same wire
dash.close();
```

Errors are typed with stable `.code`: `off-box`, `connect-failed`, `timeout`,
`ticket-expired`, `no-plugin-handler`. That lets the skill branch on
"bus unavailable" (skip) vs "bus available" (provision).

## The seam this closes

```
   TODAY
   ProjectInitButton ─▶ project-init session ─▶ writes hook ─▶ "click Initialize again"
                                                                    │  (human, later)
                                                                    ▼
                                                        POST /api/git/worktree/init
                                                        → worktreeInit hook runs:
                                                          npm ci · kb reindex · openspec

   WITH THIS CHANGE (bus reachable + opt-in)
   ProjectInitButton ─▶ project-init session ─▶ writes hook ─▶ provision-and-verify.ts:
                                                                 connect()
                                                                 trigger hook run
                                                                 until(sid,"idle")
                                                                 report result
   (bus NOT reachable) ─▶ ................................ ─▶ Step 7 message (unchanged)
```

The hook is unchanged and still does the indexing/openspec/npm work. The script
only **triggers and awaits** it.

## Decision 1 — how provisioning is triggered (OPEN, bound here)

Two candidate mechanisms; pick during implementation, keep the other as fallback:

| # | Mechanism | Pros | Cons |
|---|---|---|---|
| A | `dash.spawn({ cwd, gitWorktreeBase? })` and let worktree/session init fire the `worktreeInit` hook, then `until(sid,"idle")` | pure bus; one wire for trigger+await; matches "orchestration" intent | must confirm a plain spawn actually runs `worktreeInit` for a non-worktree cwd |
| B | `POST /api/git/worktree/init` (the existing Initialize-hook endpoint, REST) to run the hook, then use the bus only to `await`/read readiness | reuses the exact endpoint the manual click uses → identical semantics | two transports (REST trigger + bus verify) |

**Recommendation: B for the trigger, bus for the wait.** The manual click already
calls `POST /api/git/worktree/init`; reusing it guarantees the scripted path and
the human path have *identical* provisioning semantics (no drift, no
"invent-a-mechanism"). The bus adds the value it is actually good at — the
**correlated wait** — so the script blocks until provisioning is idle instead of
polling. Resolve A-vs-B with a spike in task 2; do not ship both.

## Decision 2 — reachability probe & degradation

```
   try {
     const dash = await connect({ timeout: SHORT });
   } catch (e) {
     if (e.code === "off-box" || e.code === "connect-failed") → SKIP (Step 7 fallback)
     else rethrow (unexpected)
   }
```

- **Loopback only.** `connect()` mints via `/api/ws-ticket`; off-box callers get
  `OffBoxError`. That is the correct skip signal for a bare `pi` terminal or a
  remote/paired context — the standalone flow stays click-driven.
- **Never block the scaffold.** The scaffold writes (Steps 4–6) are already
  committed to disk before Step 8 runs. If Step 8 fails for any reason, the
  project is still correctly configured; only the auto-provision convenience is
  lost. Step 8 is best-effort by construction.

## Decision 3 — opt-in gate & idempotency

- A dedicated `ask_user` confirm (default **no**): *"Provision and verify now?
  Runs this project's init hook (npm ci / index / openspec) and reports the
  result, instead of leaving a manual Initialize click."* Disclose that it
  executes the repo's `worktreeInit` hook.
- **Idempotent:** before triggering, read init-status; if the directory already
  reports provisioned (`needsInit:false`), skip with a "already provisioned"
  message. Re-running project-init never double-provisions.

## Decision 4 — what "verify" asserts

Minimum viable verification: the provisioning session reaches `idle` within the
timeout without the hook reporting a non-zero exit. Report one of:

- `configured + provisioned` — hook ran, session idle, no error.
- `configured, provisioning failed` — surface the hook's stderr/exit; the project
  is still configured, user can retry via the button.
- `configured (not provisioned)` — bus unreachable / opted out → Step 7 message.

Deeper verification (smoke-prompt the new session, assert a specific artifact
exists) is a **non-goal** for this change; the idle+exit signal is enough to catch
the malformed-hook failure mode project-init already warns about.

## Files

| Path | Change |
|---|---|
| `packages/extension/.pi/skills/project-init/SKILL.md` | add Step 8 (provision + verify): opt-in gate, reachability probe, degradation, idempotency; update Step 7 wording to note the auto path |
| `packages/extension/.pi/skills/project-init/scripts/provision-and-verify.ts` | new — imports bus-client; connect → trigger hook (Decision 1) → `until(idle)` → structured stdout the skill relays |
| `packages/extension/package.json` | add `@blackbelt-technology/pi-dashboard-bus-client` dep (the skill script imports it) |
| `packages/extension/.pi/skills/project-init/profiles/coding/AGENTS.md.tmpl` | (optional) none — behavior is skill-side, not templated |

## Risks

- **Untrusted hook execution.** Step 8 triggers the repo's `worktreeInit` hook —
  the same untrusted code the manual Initialize runs. Mitigation: opt-in gate +
  loopback-only + identical endpoint to the manual path (no new execution
  surface). Covered by `security-hardening`.
- **Spawn semantics (Decision 1A).** If a plain spawn does not fire
  `worktreeInit`, A silently no-ops the provisioning. Mitigation: prefer B
  (explicit endpoint); spike A before relying on it.
- **Timeout tuning.** `npm ci` on a cold cache can exceed a short `until` timeout.
  Mitigation: generous provisioning timeout, and a timeout is reported as
  "provisioning still running," not a failure.
