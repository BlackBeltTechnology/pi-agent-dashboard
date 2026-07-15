# Add a typed WebSocket bus-client + LLM scripting layer for the dashboard control plane

## Why

The dashboard is fully driveable over HTTP — ~153 REST paths — and the bundled
`pi-dashboard` skill teaches an LLM to control it by hand-writing `curl` against
those paths. Two structural facts make the WebSocket bus a better substrate:

1. **REST command endpoints are a facade; the client already drives the bus.**
   The web client sends the core session verbs over the **WebSocket**, not REST:
   `send({type:"spawn_session", …})`, `send({type:"send_prompt", …})`,
   `send({type:"abort", …})` (`client/src/hooks/useSessionActions.ts`,
   `components/SessionCard.tsx`). The REST session-command endpoints
   (`/api/session/spawn`, `/api/session/:id/prompt`, `…/abort` in
   `server/src/session-api.ts`) are consumed by the skill's curl layer and
   smoke-test scripts — not the UI. So the curl skill drives a secondary shell.

2. **The bus is the more complete command surface, and spawn already self-correlates.**
   `BrowserToServerMessage` carries **75 typed verbs**; REST covers a subset (no
   terminals, workspaces, roles, pinned dirs, followup edits over HTTP). Crucially,
   `spawn_session` carries a client-minted `requestId` echoed as `spawnRequestId`
   on `session_added`, and `resume_session` carries an optional `requestId` echoed
   on `resume_result` — so those completions can be **awaited** on the same wire
   instead of polled. (Note: `request_models`/`request_providers`/`request_roles`
   do **not** carry a correlation id today — see Non-Goals / design.)

3. **Orchestration is the hard part, and curl can't express it.** Sessions are
   async (`SessionStatus = active | idle | streaming | ended`). Real workflows need
   "spawn → wait until registered → prompt → wait until the turn finishes → branch."
   curl fires blind and polls; the bus delivers the completion signal on the
   connection you already hold, keyed by session id.

**Reality check on plugins (informs scope).** A single generic verb —
`{type:"plugin_action", pluginId, sessionId, action, payload}` — is the *intended*
seam for driving extensions. But as-built only **`goal-plugin`** registers a
working `plugin_action` handler. `flows-plugin`'s handler is a stub, and the
server dispatch registry is **last-writer-wins** (`customHandlers.set(type,…)` in
`browser-gateway.ts`), so a later-loading plugin silently overwrites an earlier
one; `kb-plugin` and `automation-plugin` register no handler. So "every extension
for free" is **not** true today. This change therefore supports `plugin_action`
for the one plugin that works (goal); making it a true universal fan-out is a
separate, dependency-tracked change (`fix-plugin-action-fanout-and-handlers`).

## What Changes

Introduce **one typed WebSocket bus client** and rebuild the LLM-facing skill
layer on top of it. Scope is deliberately narrow (Option 3): the client + skill
migration land here; the plugin_action universalization lands in a follow-up.

- **`@pi-dashboard/bus-client` (new package)** — a headless,
  ticket-authenticated WebSocket client that imports the `packages/shared`
  protocol types and exposes:
  - `connect()` — port discovery, mint a WS ticket via `POST /api/ws-ticket`
    (loopback / trusted-network only for MVP — see Non-Goals), open the WS within
    the 15 s ticket TTL, subscribe.
  - `send<T extends BrowserToServerMessage>(msg)` — one typed command; the
    compiler rejects malformed verbs.
  - `until(sessionId, status, {timeout})` / `await<Event>(pattern)` — block on a
    correlated event: **exact** for `spawn_session`/`resume_session` (they carry
    ids), **structural** (session-id + status transition on the subscription
    stream) for everything else.
  - `read.sessions()` / `read.session(id)` — session **registry metadata + status**
    from the subscription snapshot, live-consistent with the waits. (Chat/last-
    response is NOT in the snapshot — see Non-Goals.)
  - `plugin(pluginId, action, payload)` — emits `plugin_action`; usable against
    **goal-plugin** today (the only working handler). Other plugins land with the
    follow-up change.
  - **Verbs generated from `BrowserToServerMessage` minus a forwardable-command
    allowlist** — some union members (e.g. `plugin_config_write`) are intercepted
    client-side to REST and must NOT get a naive WS helper; codegen excludes them
    and a test asserts every generated verb reaches a server handler.

- **Scripting layer** — an LLM authors an ordinary **type-checked `.ts` script**
  against the bus client (no bespoke DSL in this change — see Open Questions):

  ```ts
  const dash = await connect();
  const sid  = await dash.spawn({ cwd: "/proj" });     // exact-correlated (spawnRequestId)
  await dash.prompt(sid, "/opsx-explore add-auth");
  await dash.until(sid, "idle");                        // structural wait on status
  await dash.plugin("goal", "set-subgoal", { text });   // goal-plugin (works today)
  ```

- **Tier 1 — migrate the LLM-facing curl layer onto the bus client:**
  `packages/extension/.pi/skills/pi-dashboard/` — `scripts/dashboard-api.sh`, the
  `commands/*.md` slash commands, `SKILL.md`, `references/{recipes,api-reference}.md`
  — wrap the bus client instead of curling REST.
  `.pi/skills/debug-dashboard/scripts/{list-sessions,health-probe}.ts` read live
  session metadata from the subscription snapshot.

- **Tier 2 — consolidate only the REST twins that have a real WS verb (bounded):**
  the session/flow command wrappers whose verbs already exist in
  `BrowserToServerMessage` route through the WS the client already holds. Wrappers
  with **no** WS twin stay REST (the majority — see Non-Goals). This is a small,
  honest consolidation, not a sweep.

## Non-Goals (stay REST / out of scope)

- **Universal `plugin_action` fan-out** — the last-writer-wins registry fix +
  `plugin_action` handlers for flows/kb/automation ship in the follow-up change
  `fix-plugin-action-fanout-and-handlers`. This change targets goal-plugin only.
- **Client REST twins with no WS verb** — `plugin_config_write` (intercepted to
  REST by design; a test asserts it), `canvas-types` writes (server-push only),
  `openspec/tasks/toggle` (no toggle verb), and the read-only wrappers
  (`git-api`, `grep`, `browse`, `doctor`) **stay REST**. This change does not
  invent verbs to move them.
- **Chat / last-response reads** — the `sessions_snapshot` is registry metadata
  only; reading an agent's reply needs the `event`/`event_replay` stream. A
  chat-read primitive is a follow-up, not in the `read` API specified here.
- **Off-box / untrusted-network scripting** — ticket minting requires `networkGuard`
  (loopback/trusted) or a paired-device bearer; MVP is loopback-only. The
  pairing/auth surface stays REST and is not extended here.
- **model-proxy `/v1/*`, auth, pairing, tunnel, recovery-server, mDNS, electron
  probes** — legitimately HTTP; must work when the bus is down.
- **Server route handlers** (`server/src/routes/*`) stay — REST remains a
  supported compatibility shell, not removed.
- **No new DSL / interpreter** in this change (see Open Questions).

## Open Questions (resolve in design.md)

1. **Plain-TS scripts vs. a thin declarative DSL.** Ships typed TS only; a DSL is
   deferred unless a non-coder author surface is needed.
2. **Exact Tier-2 bound.** Enumerate the precise set of session/flow command
   wrappers that have a real WS verb and move only those.

## Discipline Skills

- `security-hardening` — the client authenticates via WS ticket and can spawn
  agents, kill processes, remove worktrees; verb tiers (read vs mutate), ticket
  handling, and loopback-only bound need a threat pass.
- `doubt-driven-review` — Tier 2 moves live client mutations off REST; an
  in-flight review before each twin flips prevents a cross-boundary regression.
- `observability-instrumentation` — a headless client that drives real sessions
  needs enough logging to reconstruct what a script did.
