## Why

Skills that fan work out across many headless pi subprocesses (e.g. `parallel-pi-model-workers` running `pi --model M -p "…"` ×N) flood the dashboard sidebar with one session card per worker. Each worker is a real pi process carrying the bridge extension, so it auto-registers and gets a card — even though it is throwaway plumbing the user does not want to monitor.

Root cause (confirmed against `source-detector.ts`):

- A print-mode worker has **no TUI attached** → `hasUI === false`.
- It is **not** spawned by the dashboard server → no `.meta.json` `source: "dashboard"`, no `PI_DASHBOARD_SPAWN_TOKEN`.
- `detectSessionSource(false, sessionFile)` exhausts every branch and hits the **fallback `return "tui"`**. So the worker is labelled `source: "tui"` — indistinguishable from a real interactive session. Nothing reaching the server/client separates "headless throwaway worker" from "my actual TUI session" (`hasUI` is cached in the bridge but never added to the `Session` shape).

Two facts make this cleanly solvable:

- Everything the dashboard *deliberately* tracks headless (server-spawned sessions, RPC keeper sessions) is already stamped `source: "dashboard"`. So `hasUI === false && source !== "dashboard"` isolates exactly the unwanted leak set with essentially zero collateral.
- The dashboard already ships a complete hide mechanism: `Session.hidden`, server-persisted, with `filterSessions(…, showHidden)` and a `Show hidden` toggle (capability `session-filtering`). Hidden sessions stay one click from visible.

Because hidden sessions remain revealable, over-hiding is trivially reversible (one toggle) while under-hiding leaks cards every run. The asymmetry favors an automatic heuristic over a per-skill opt-in.

## What Changes

- **Plumb `hasUI` to the server.** Add optional `hasUI` to `session_register` (bridge already caches `cachedHasUI`). The client need not see it; the server uses it to decide.
- **Auto-hide headless non-dashboard sessions at first register only.** On the **first** register for a session (`registerReason === "spawn"` / no existing record), the server sets `hidden = true` when `hasUI === false && source !== "dashboard"`. On every subsequent register (reattach/reconnect) the server **preserves the existing `hidden` value** — the auto-hide is one-shot and never re-evaluates, so a user who clicks `Show hidden` → unhide keeps the session visible across the worker's reconnects.
- **Optional explicit override via env.** The bridge reads `PI_DASHBOARD_HIDDEN` / `PI_DASHBOARD_VISIBLE` and forwards a `visibilityIntent` (`"hidden" | "visible"`) on `session_register`. An explicit intent wins over the heuristic at first register, letting a spawning skill force the call (or force-show a headless session it wants monitored).
- **Reuse existing UI.** No new client UI — auto-hidden workers fall under the existing `Show hidden` toggle and `[↩]` unhide affordance.

## Capabilities

### Modified Capabilities

- `session-filtering`: On first registration, the server SHALL auto-set `hidden = true` for sessions where `hasUI === false` and `source !== "dashboard"`, unless an explicit `visibilityIntent` overrides it. The auto-hide is evaluated once (first register); subsequent registers preserve the prior `hidden` value so manual unhide survives reconnects.
- `shared-protocol`: `session_register` gains optional `hasUI` (boolean) and `visibilityIntent` (`"hidden" | "visible"`). Both optional/back-compatible; absent fields reproduce today's behavior (no auto-hide).

## Impact

**Code touched:**
- `packages/shared/src/protocol.ts` — add optional `hasUI?: boolean` and `visibilityIntent?: "hidden" | "visible"` to `SessionRegisterMessage`.
- `packages/extension/src/bridge.ts` — include `cachedHasUI` and the env-derived `visibilityIntent` in the `session_register` payload (near `source: detectSessionSource(...)`, ~line 1795).
- `packages/server/src/memory-session-manager.ts` — replace the unconditional `hidden: false` (~line 105) with: first register → compute auto-hide / honor `visibilityIntent`; subsequent register → preserve `existing?.hidden`.
- `packages/server/src/event-wiring.ts` — pass `hasUI` / `visibilityIntent` from the `session_register` message (~line 444) into the registration params.

**Not touched:**
- `source-detector.ts` — `source` stays as today; no new source value.
- `filterSessions` / `Show hidden` toggle / `ProcessList` — unchanged; auto-hidden sessions reuse the existing pipeline.
- `hide_session` / `unhide_session` API — unchanged.
- Client `Session` shape — no `hasUI` exposure required.

**Risk:**
- A headless session the user *wants* visible but spawned outside the dashboard is auto-hidden. Mitigation: one `Show hidden` toggle, or set `PI_DASHBOARD_VISIBLE=1` when spawning. Low cost (reversible).
- The current `hidden: false` reset-on-every-register would otherwise also reset *manual* hides on reattach; this change fixes that by preserving `existing?.hidden` on non-first registers.

**Open decisions** (see design.md):
1. Env var names — `PI_DASHBOARD_HIDDEN` / `PI_DASHBOARD_VISIBLE` vs a single `PI_DASHBOARD_VISIBILITY=hidden|visible`.
2. Whether `parallel-pi-model-workers` SKILL.md should document setting `PI_DASHBOARD_HIDDEN=1` as best practice (skill doc, not code).
