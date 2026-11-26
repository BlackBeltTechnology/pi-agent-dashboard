## Why

`add-agent-teams-core` (change 1 of 5 in the `agent-teams` group) delivers the headless mechanics: a server-owned team store, the CC-named agent tools, mailbox delivery, a shared task list, idle notification and the shutdown handshake. Until a UI exists the user cannot see any of it. Mail from peers appears as generic custom cards, team tool calls appear as raw JSON tool rows, there is no way to see who is working on what, and the only team control is whatever the lead agent decides to do.

This change (change 2 of 5) makes teams **visible and stoppable** without adding new team semantics: chat renderers for the mail kinds and the team tools, a **Team view** (members grid, task board with dependencies and owners, message log), a **session-card badge** (role), live updates, multi-user owner filtering of the read routes (through core's route-visibility hook), and two user-initiated controls — stop a member's current turn and shut the team down — implemented as thin wrappers over core's actor operations.

Two spike-era facts shape the UI. First, peers must be visually distinct from the human (Phase B: mail as a user message made them indistinguishable), so every mail card states loudly that it is an agent message. Second, mail rows reach the chat via `pi.sendMessage` and therefore carry **no entry id and no lazily fetched payload** (`event-reducer.ts:2299-2301`): the collapsed card is the only card, so it must be fully meaningful from `customType` plus the body text alone.

## What Changes

- **Chat custom-entry renderers** (`custom-entry-renderer` claims) for core's three mail `customType` values `agent-teams-mail`, `agent-teams-idle`, `agent-teams-notice`: sender role, kind, urgency and a bounded, plain-text body, all derived from `customType` plus the envelope line, parsed with core's own `parseEnvelope` (`shared/mail-format.ts`). Unknown kinds render as generic labelled messages; a header cut off by the host's 200-line display cap and notice items carrying multi-line peer text are handled explicitly.
- **Tool renderers** (`tool-renderer` claims, lazy module) for the eleven team tools: lifecycle (`TeamCreate`, `TeammateSpawn`, `TeamStatus`, `TeamDelete`), `SendMessage`, task tools (`TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`) and the shutdown tools, rendering validated structured `details` and degrading to the plain result text. The tool-name table is data-driven so later changes can add claims.
- **Team view**: a `shell-overlay-route` claim with `presentation: "content"` at `/session/:sessionId/team` (lead or any teammate session id resolves the team), lazy module. Members grid (status with glyph + text + severity, model, current task, open-session link, Stop), task board (pending / in progress / completed columns, owner chips, dependency chips with derived blocked state), message log (filter by member, urgent and queued markers), team header (status, orphaned, closing and degraded notices, Shut down team).
- **Session-card badge** (`session-card-badge`, `predicate`-gated, eager, no icon dependency): `Lead` or `<member>`, linking to the Team view. The server stamps the lead session on core's `team_created`/`lead_bound` store events under its own plugin-ref key `agent-teams-lead` (teammates already carry core's `agent-teams` ref); the predicate reads the top-level projection the host actually broadcasts.
- **Live state**: the server turns core's store `change` event into a content-free, session-scoped `plugin_event` invalidation (`agent-teams:changed {teamId, epoch, rev}`) coalesced per team to 1 s; the client refetches the REST snapshot (single-flight, debounced, conditional via ETag) on frames, reconnect, visibility and a 60 s safety timer. No manifest `eventTypes`/`sessionEventReducer`.
- **Access**: owner filtering through core's `setRouteVisibility` hook (policy lives here, `Team.owner` is core's), a server-computed `viewerCanControl`, a `?sessionId=` lookup filter, shared `canViewTeam`/`canControlTeam` helpers, and two new `control`-tier mutating routes — `POST …/teams/:id/members/:name/stop` and `POST …/teams/:id/shutdown` — that call core's `abortMember` / `teamDelete` with actor `user`.
- **Accessibility and theming**: keyboard-operable tabs/disclosures, ARIA roles, a throttled polite live region, WCAG 2.2 AA through `ui-contract.md` tokens and glyph+text states, both themes.
- **Mock loop first**: a live-component mock (`frontend-mockup-loop-dashboard`) of the Team view, mail cards, tool cards, badge and every state is produced and decided before any component is built (tasks §1).

## Capabilities

### New Capabilities

- `agent-teams-chat-rendering`: mail custom-entry cards over core's envelope, tool renderers.
- `agent-teams-team-view`: Team view route claim, sections, states, controls, responsive layout, accessibility.
- `agent-teams-session-badge`: role badge, lead stamping from core store events.
- `agent-teams-ui-live-state`: snapshot revision/epoch/ETag, invalidation broadcast, refetch protocol, announcements.
- `agent-teams-ui-access`: owner filtering of read routes, session lookup, viewer capability, user stop/shutdown routes, route tiers.

### Modified Capabilities

None. Core's requirement "Minimal read-only REST surface" now states that core registers no mutating route and that later changes MAY add routes under the same prefix with a route tier; core's actor operations `abortMember`/`teamDelete` already admit actor `user`; the envelope, reserved names, `Team.owner`, `rev` and store events are core's. This change only adds capabilities on top of those seams. Two small additions to core files remain and are additive: an `enqueueLeadNotice` export on `ops.ts` (only if core has no equivalent) and a snapshot field set (`epoch`, `viewerCanControl`) added by this change's route layer.

## Impact

- **Code**: `packages/agent-teams-plugin/src/client/` (manifest claims, badge, predicate, lazy Team view / tool / entry modules, client store, status map, i18n keys), `src/shared/ui-protocol.ts`, `src/server/access.ts`, `src/server/ui-bridge.ts` (store `change` → broadcast, lead stamp/clear), `src/server/user-actions.ts`, `src/server/routes.ts` (visibility registration, `sessionId` filter, `epoch`/`viewerCanControl`/ETag, two POST routes).
- **Registrations**: two `ROUTE_TIERS` rows (`POST`, tier `control`) in `packages/shared/src/route-tiers.ts`; the MCP denylist prefix `/api/plugins/agent-teams/` from core already covers them; manifest `claims` (and `emits` if required); regenerated `packages/client/src/generated/plugin-registry.tsx`.
- **Data / migration**: none; no new persisted field (`Team.owner` is core's, `schemaVersion` untouched). Teams persisted without an owner are fail-closed for enforced identity (local operator still sees them). **Rollback**: remove the claims and the two routes; core keeps working headless; the lead `agent-teams-lead` stamp is inert and cleared on close.
- **Compatibility**: additive. No wire-protocol change in `packages/shared` (`plugin_event` is already a declared server→browser frame, `intent-types.ts:72`). No host change. Needs a dashboard that understands the lazy `module` claim key (already present, `manifest-schema.md:53`).
- **Performance**: client entry stays inside the cold-chunk budget (`mdi-chunk-size.test.ts`): eager part = badge labels, predicate, badge; everything else (including every other i18n string) lazy. One open view causes at most one full snapshot request per second; unchanged state answers 304.
- **Security**: peer-authored text is rendered as inert plain text only; the sender shown on a card comes solely from the first envelope line anchored at the start of the body, and core's reserved names keep it unambiguous; new mutating routes are `control`-tier, owner-gated, with no approval semantics (plan approval is change 3).

## Discipline Skills

- `security-hardening` — peer/LLM text rendered in cards, board and log is untrusted (plain text, no links, no HTML, first-line-only envelope parse against header spoofing, fake notice items); new mutating routes need owner gating and tier rows; owner filtering of reads (tasks §4, §5, §8, §10).
- `observability-instrumentation` — two new mutating endpoints and a new broadcast frame need structured logs and counters (frames sent/coalesced, snapshot refetches, stop/shutdown outcomes) (tasks §10).
- `performance-optimization` — cold-chunk budget (eager vs lazy split, catalog delta), refetch storm protection (coalesce, single-flight, debounce, ETag), board rendering with up to 50 tasks / 10 members / capped mail (tasks §7, §9, §10).
- `doubt-driven-review` — the notice/idle body contract is shared with core's builder and the user-actor path touches core ops; review both before they stand (tasks §3 gate).
- `systematic-debugging` applies if the invalidate→refetch loop misbehaves mid-implementation; no other discipline is triggered. Accessibility and theming are covered by the `frontend-mockup-loop-dashboard` binding and `ui-contract.md` (the generic `theme-system` skill is superseded here, see design D12).

## Non-goals

- **No plan approval UI** and no approve/reject controls on the three mail cards → `add-agent-teams-templates-hooks` (change 3) registers the approval card under its own customType. Peer messages are never presented as something the user can "accept".
- **No team creation or teammate spawn from the UI** in this change, no template picker, no task editing/creation, no drag-and-drop; the board is read-only and the only mutations here are Stop member and Shut down team. The "Start team" entry point belongs to change 3 (owner decision, see design "Owner decisions").
- **No messaging from the Team view.** The user talks to a teammate by opening its session (normal chat), exactly as designed in core.
- **No OpenSpec-specific rendering** (task checkbox mirroring, per-change columns) → change 4. **No in-process teammate display** → change 5. Renderers for `PlanSubmit`, `PlanDecision`, `ResourceLock` are optional later claims on the same manifest.
- **No new team semantics, no host change, no shared-protocol change, no per-member cost/token metering** (would need host usage seams).
- **No `eventTypes` ownership / `sessionEventReducer` / `toolRowFinalizers`.**
