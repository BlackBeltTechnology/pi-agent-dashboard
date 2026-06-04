## Context

Headless worker subprocesses (`pi --model M -p "…"`) auto-register with the dashboard and each gets a sidebar card. They carry `hasUI === false` and, because the dashboard did not spawn them, fall through `detectSessionSource` to the `"tui"` fallback — so they are indistinguishable from real interactive sessions at the protocol level.

Confirmed signal map (every way a session reaches `hasUI === false`):

```
                  hasUI = false  (no TUI attached)
                          │
            ┌─────────────┴──────────────┐
            ▼                             ▼
   source = "dashboard"           source = "tui"  (fallback)
   server-spawned / RPC keeper    parallel-pi workers, manual `pi -p`,
   → WANT SHOWN                   3rd-party skill spawns, CI → THE LEAK
```

Existing machinery reused:
- `Session.hidden?: boolean` (`shared/types.ts:162`), server-persisted.
- `filterSessions(…, showHidden)` (`session-grouping.ts:356`): `if (s.hidden && !showHidden) return false`.
- `Show hidden` toggle + `[↩]` unhide (capability `session-filtering`).
- `cachedHasUI` already tracked in the bridge (`bridge.ts`); just not forwarded.

## Goals / Non-Goals

**Goals:**
- Headless non-dashboard sessions are hidden by default the moment they register.
- Genuine TUI sessions and dashboard-managed headless sessions stay visible (unchanged).
- A user who unhides an auto-hidden worker keeps it visible across the worker's reconnects.
- A spawner can force visibility either way via env.

**Non-Goals:**
- No new `source` value; `detectSessionSource` is untouched.
- No new client UI; reuse the `Show hidden` pipeline.
- No change to `hide_session`/`unhide_session` semantics or the kill path.
- No attempt to suppress registration entirely (the card must remain revealable — chosen direction).

## Decisions

### Decision 1: Heuristic, not per-skill opt-in, as the default

`hidden = (hasUI === false) && (source !== "dashboard")`. The `source: "dashboard"` carve-out is free because the dashboard already stamps everything it deliberately tracks. Opt-in (env only) would miss manual `pi -p` runs, other skills, and CI; the heuristic covers the whole class. Because hiding is revealable, the only downside (a wanted headless session hidden) is one toggle away — an acceptable, asymmetric trade vs. recurring card leaks.

### Decision 2: One-shot evaluation at first register; preserve `hidden` thereafter

Auto-hide is computed **only** on the first register for a session (no existing record / `registerReason === "spawn"`). Every later register (reattach after a dashboard restart, in-process resume) **preserves `existing?.hidden`**. This is what makes manual unhide stick.

Side fix: today `memory-session-manager` writes `hidden: false` unconditionally on every register, which would also reset a *manual* hide on reconnect. Preserving `existing?.hidden` on non-first registers fixes both.

```
register(params):
  existing = sessions.get(params.id)
  if existing exists (reattach / re-register):
      hidden = existing.hidden            // never re-evaluate
  else (first register):
      hidden =
        params.visibilityIntent === "hidden"  ? true
      : params.visibilityIntent === "visible" ? false
      : (params.hasUI === false && params.source !== "dashboard")
```

### Decision 3: Server decides; bridge only forwards facts

The bridge forwards `hasUI` (a fact it already has) and `visibilityIntent` (env-derived). The decision lives server-side beside the existing `hidden` initialization — the server is the single writer of `hidden` and already owns the registry. Keeps the rule in one place and back-compatible (absent `hasUI` ⇒ no auto-hide).

### Decision 4 (OPEN): Env var shape

`PI_DASHBOARD_HIDDEN=1` / `PI_DASHBOARD_VISIBLE=1` (two booleans) vs `PI_DASHBOARD_VISIBILITY=hidden|visible` (one tristate). Recommendation: two booleans for grep-ability and parity with existing `PI_DASHBOARD_*` flags; `VISIBLE` wins if both set (explicit show beats hide). Decision needed before tasks 2.x.

### Decision 5 (OPEN): Document the env in the worker skill

`parallel-pi-model-workers` SKILL.md could recommend `PI_DASHBOARD_HIDDEN=1` on the worker launch line as belt-and-suspenders (so workers are hidden even if the heuristic is ever weakened). Doc-only; recommend yes. Decision needed before tasks 4.x.

## Risks / Trade-offs

- **Wanted headless session hidden** — reversible via `Show hidden` or `PI_DASHBOARD_VISIBLE=1`. Accepted.
- **Stale `existing` across a server restart** — after a restart the in-memory registry is rebuilt; a reattach register that finds no existing record would be treated as "first" and re-evaluate the heuristic. For an auto-hidden worker this re-hides (fine); for a *manually unhidden* worker, the manual choice could be lost if `hidden` was not reloaded from persistence first. Mitigate by sourcing `existing` from the persisted store on rebuild (the hide flag is already persisted). Flag in tasks.
- **Bridge predates change** — sends no `hasUI`; server skips auto-hide (today's behavior). Safe.

## Migration / Compatibility

Additive optional protocol fields. Older bridges omit `hasUI`/`visibilityIntent` → no auto-hide. Older servers ignore the fields. No persistence migration — `hidden` already exists and is stored.
