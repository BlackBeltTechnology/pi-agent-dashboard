## Context

Dashboard renders `Agent` tool calls (`@tintinweb/pi-subagents` or `pi-dashboard-subagents`) as cards via `AgentToolRenderer`. Today the card is static — no way to see the subagent's actual reasoning, tool calls, or assistant text. This change adds inline expansion + a dedicated popout route so users can inspect a subagent's run in detail.

The producer of the rich timeline is the new `pi-dashboard-subagents` extension (separate repo, foreground-only, in-memory spawn). Its wire contract is locked in `scaffold-foreground-subagent-extension` at `/home/skrot1/BB/pi-packages/pi-dashboard-agents/openspec/changes/`. This change consumes that contract.

## Goals / Non-Goals

**Goals:**

- Inline-expandable agent card with full timeline (tool / text / thinking / error).
- Popout route `/session/:sid/subagent/:aid` so users can open the inspector in a new tab.
- Graceful fallback when the timeline producer (`pi-dashboard-subagents`) isn't installed — show summary + counters + upgrade footnote.
- `GetSubagentResultRenderer` gains a "Show details" affordance that opens the popout (relevant only for `@tintinweb/pi-subagents` coexistence).

**Non-Goals:**

- Background subagents. The producer extension is foreground-only by design; the dashboard's status-bar pill / panel that was originally planned has been dropped.
- New event protocol or bridge changes. The bridge already forwards `subagents:*` events from any extension that emits them via its emit-intercept.
- LLM-driven timeline summarization. Verbatim entries from the producer.

## Decisions

### Decision 1: One component, three modes

`SubagentDetailView` is the single renderer. Three modes:

- `inline` — `max-h-[60vh]` with internal scroll, used inside the expanded `AgentToolRenderer` card.
- `popout` — full viewport, used by `SubagentPopoutPage`.
- `row` — single-line summary, available for any future consumer.

This keeps the rendering logic in one place and lets future producers (or the same producer at a later version) light up the same UI.

### Decision 2: Popout is a browser tab at a stable URL

`/session/<sid>/subagent/<aid>` opens via `window.open(url, "_blank")`. Reasons:

- Multi-monitor friendly.
- Same routing mechanism as existing session URLs.
- Survives reloads (state re-derived from streamed events when the parent session is subscribed).
- Trivially shareable.

Rejected alternatives: floating draggable pane (worse multi-monitor, more React surface); native OS-level window (Electron-only).

### Decision 3: Graceful four-tier degradation in `SubagentDetailView`

- Tier 1 (entries present): full timeline.
- Tier 2 (running, no entries): activity + counters + upgrade footnote.
- Tier 3 (completed/failed, no entries): result/error block.
- Tier 4 (no useful data): "No detail available yet."

Lets the dashboard work both with `pi-dashboard-subagents` (Tier 1) and `@tintinweb/pi-subagents` (Tier 2/3) without code branching at the renderer level.

### Decision 4: Background-subagents UI dropped

Originally this change included a `BackgroundSubagentsPill` in the status bar listing in-flight background subagents. That has been **removed entirely** because the new producer (`pi-dashboard-subagents`) is foreground-only. The pill had no data source under the new architecture. If a future producer needs background visibility, it can be added back as a separate change.

### Decision 5: `ToolContext` carries `sessionId` + `session`

Renderers that need session-scoped URLs (popout) or per-session state (timeline) read these from context. The alternative (React context provider) was rejected as overkill — `ToolContext` already flows through the renderer interface.

### Decision 6: Popout subscribes to parent session in fresh tabs

When the popout URL opens in a brand-new tab, the parent session has not been subscribed. The page must trigger subscription itself. We add a `useEffect` in `App.tsx` that calls `send({ type: "subscribe", sessionId })` when a popout route is matched and the session isn't already subscribed. Without this, fresh-tab popouts forever show "Loading…".

### Decision 7: Reducer backfills `subagents` map from `tool_execution_end`

The `subagents: Map<string, SubagentState>` slot is canonical for the inspector — `SubagentDetailView` and `SubagentPopoutPage` both read `session.subagents.get(agentId)` exclusively. Today the only writers are the four live `subagent_*` event handlers (`event-reducer.ts:1287/1301/1316`). Replay (`state-replay.ts`) does NOT synthesize `subagent_*` events; it only synthesizes `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_end`, `stats_update`, and `model_select`.

Result: completed subagents survive in the parent's JSONL (their full `AgentDetails` rides inside `ToolResultMessage.details` per pi-coding-agent's session format), but after a `/resume` or page refresh the map is empty — the collapsed card reads `messages[i].toolDetails` directly and works, but expand+popout call into `SubagentDetailView`, see an empty `subagents.get(agentId)`, and render "Subagent not found."

The `state-replay.ts:128` code path already threads `msg.details` into the synthesized `tool_execution_end.data.details`. Adding a write to `next.subagents` inside the existing `tool_execution_end` handler (gated on `toolName === "Agent"` and `data.details?.agentId`) closes the loop without touching replay, the bridge, the producer, or any new event channel.

Alternatives considered:

- **Synthesize `subagent_completed` inside `state-replay.ts`** when walking JSONL. Rejected because replay's job is to derive minimum events to rebuild the chat view; subagent state is a derived view of tool-result data and belongs in the reducer, not in replay. Also forces replay to grow producer-specific knowledge of the `Agent` tool name in a layer that is otherwise tool-agnostic.
- **Make `SubagentDetailView` accept entries via prop and fall back to `messages[i].toolDetails`** when the map is empty. Rejected because it fixes the inline-expand case but not the popout (the popout route has no message context to read; it only has `sessionId` + `agentId`).
- **Server-side ring buffer of `subagent_*` events** so reconnects can replay them. Rejected for this change — it adds infrastructure (a per-session bounded queue keyed by `agentId`) and only helps the live-mid-flight case (refresh while a subagent is still running). The vast majority of inspector traffic is post-hoc and is fully covered by backfill. Mid-flight survival can be added later if it proves needed; tracked under "Open Questions" below.

Merge semantics: when both a live `subagent_completed` and a backfill from `tool_execution_end` arrive for the same `agentId` (the order is not guaranteed, especially across replay+live transitions), the handler preserves prior non-undefined fields rather than blindly overwriting. This makes the two paths commutative and prevents either source from clobbering richer information from the other.

### Decision 8: Adopt `pi-dashboard-subagents` as the sole recommended producer; bundle in Electron; remove tintinweb specialization

The dashboard no longer ships specialized code for `@tintinweb/pi-subagents`. Concretely:

- `RECOMMENDED_EXTENSIONS` drops `tintinweb-pi-subagents` and adds `pi-dashboard-subagents` (status `optional`, `dashboardPlugin: "subagents"`, source `https://github.com/BlackBeltTechnology/pi-dashboard-subagents.git` — the producer is not yet on npm). When the producer is later published, the source string flips to `npm:pi-dashboard-subagents` in one edit; no other change needed.
- `BUNDLED_EXTENSION_IDS` gains `"pi-dashboard-subagents"`. The Electron installer's `bundle-recommended-extensions.sh` clones every id in the list with the SPDX allowlist + 15 MB budget enforced; `installBundledExtensions()` activates them on first run. The producer therefore ships pre-cached and registered with pi out of the box — no internet round-trip required for the inspector to light up in a fresh Electron install.
- `GetSubagentResultRenderer.tsx` and `SteerSubagentRenderer.tsx` (plus their tests and registry entries) are deleted. Those tools only existed in `@tintinweb/pi-subagents`; `pi-dashboard-subagents` is foreground-only and emits no `get_subagent_result` / `steer_subagent` calls.
- `SubagentDetailView`'s Tier-2 fallback (the "Showing summary; install …" footnote shown when a subagent is `running` with no `entries[]`) is removed. With `pi-dashboard-subagents` as the producer, every running subagent streams entries from the first `tool_execution_end`. The remaining tiers — Tier 1 (entries), Tier 3 (completed/failed with result/error), Tier 4 ("no detail available yet") — cover every observable state.
- Stale `@tintinweb/pi-subagents` comments / footnote copy in `AgentToolRenderer.tsx` and `SubagentDetailView.tsx` are refreshed to mention `pi-dashboard-subagents`.
- `docs/plans/tintinweb-subagents.md` (the obsolete revert/reimplementation guide) is deleted.

Rejected alternative: **deprecation-with-warning-badge** — leave the tintinweb renderers but mark them as deprecated in UI. Carries the maintenance cost of two coexisting subagent paths indefinitely and confuses users about which extension to install. The user has explicitly chosen the "completely remove tintinweb" path.

Users who still have `@tintinweb/pi-subagents` installed in pi will see their `Agent` tool calls render via `GenericToolRenderer` (the dashboard's fallback for tools without a specialized renderer). No card UI, no inspector. This is the documented end-state — dashboard-level support for that extension is removed.

### Decision 9: Settings surface uses the canonical plugin-settings flow (NOT honcho-style custom routes)

The dashboard already ships a single canonical plugin-settings mechanism:

1. Plugin manifest declares `configSchema: "./src/configSchema.json"` and a `settings-section` claim.
2. Client component reads via `usePluginConfig<T>()` and writes via the shared `POST /api/config/plugins/:id` route.
3. The shared route validates against the plugin's schema (Ajv), writes to `~/.pi/dashboard/config.json` under `plugins.<id>`, broadcasts `plugin_config_update` to all subscribed browsers.

This is the pattern used by `roles-plugin`, `flows-anthropic-bridge-plugin`, and `demo-plugin`. `honcho-plugin` deviates because it round-trips with `~/.honcho/config.json` and runs docker; that deviation is honcho-specific and not the model to follow for a single-toggle surface.

Subagents-plugin uses the canonical path:

- `src/configSchema.json` with one property: `inheritContext: boolean` (default `true`). The other producer settings (`exposeInheritanceInTool`, `inheritance.recentTurns`, `inheritance.toolOutputWindow`, `inheritance.maxChars`) are intentionally NOT surfaced in the UI — they remain editable by hand in the producer's config file for power users.
- `src/client/SubagentsSettings.tsx` claims the `settings-section` slot in the `general` tab with one toggle: "Fork parent context into every subagent".
- No custom REST routes. Writes go through `POST /api/config/plugins/subagents` (the existing shared route).

Rejected alternatives:

- **Custom routes `/api/plugins/subagents/config`** (honcho-style). Would duplicate the shared route's validation, persistence, and broadcast logic for no gain on a single-toggle surface.
- **Producer-extension-owned UI** via the dashboard's extension-ui descriptor system (`management-modal` + a `/subagents:settings` slash command). Rejected because it splits settings management between producer and dashboard, requires producer-side TUI/dashboard-extension work, and contradicts the user's directive that "there is only one way to register settings in the dashboard".

### Decision 10: Plugin server mirrors dashboard config → producer file via a Fastify hook

The producer extension reads its inheritance setting from `~/.pi/agent/extensions/pi-dashboard-subagents/config.json` — a file the dashboard does not normally touch. To wire the canonical settings flow through to producer behaviour, the subagents-plugin server entry adds two responsibilities:

1. **Startup reconcile** (producer file is source of truth at startup). On `registerPlugin(ctx)`, read the producer file (if present) and call `ctx.updatePluginConfig({ inheritContext: producerValue })`. This ensures the dashboard plugin config (and therefore the settings toggle) reflects what the producer is actually doing on first load — even if the user has been editing the producer file by hand.

2. **Write-through mirror** (dashboard config is source of truth at runtime). Register a Fastify `onResponse` hook that fires when `POST /api/config/plugins/subagents` returns 200, reads the just-persisted plugin config via `ctx.getPluginConfig`, and writes the value into the producer file via an atomic write that **preserves** unexposed keys (`exposeInheritanceInTool`, `inheritance.*`) and any `additionalProperties` the user added by hand.

```
   First-load reconcile (one-time, on plugin server boot)
   ───────────────────────────────────────────────────────
   producer file ───┐
                    ▼
            ctx.updatePluginConfig({inheritContext})
                    ▼
            dashboard plugin config
                    ▼
            plugin_config_update broadcast
                    ▼
            usePluginConfig refreshes
            toggle now shows producer truth

   Live writes (every settings toggle click)
   ───────────────────────────────────────────────────────
   client toggles  ─► POST /api/config/plugins/subagents
                                ▼
                  shared route validates schema, writes
                  ~/.pi/dashboard/config.json plugins.subagents
                                ▼
                  broadcast plugin_config_update
                                ▼
   onResponse hook ─► read merged config, write producer file
                       (preserving unexposed keys)
```

Rejected alternatives:

- **Change the producer to read `~/.pi/dashboard/config.json`** directly. Couples the producer extension to the dashboard's config file format; producer should remain runnable standalone.
- **Polling / fs.watch on the producer file**. Resource leak surface area, race conditions on dashboard restart. The hook + startup-reconcile pair handles every observable case without watchers.
- **Server-side runtime extension `onConfigChange(cb)` hook**. Would be a clean addition to `ServerPluginContext` but is a runtime API change that no other plugin currently needs. Defer until a second plugin has the same need.

### Decision 11: `agentMdPath` is rendered as a read-only monospace path under the displayName

The producer ships `details.agentMdPath` (absolute path to the agent's `.md` definition file) on every `subagents:*` event when the agent was sourced from a file. `readSubagentDetails` pulls it through; `SubagentState` gains an optional `agentMdPath?: string`. `SubagentDetailView`'s header renders it on a small line under the displayName, in monospace, read-only — no click handler, no editor-open integration, no copy-to-clipboard.

Rejected alternative: **open the file via the dashboard's `/api/editors` endpoint** (which would shell out to the user's configured editor). Rejected by user directive. The path is informative; the user can copy it manually if they want to open the file in an editor.

This closes the `proposal.md` §1 promise — "See the agent's source `.md` file path so they can open the definition (e.g. `~/.pi/agent/agents/Explore.md`)." — in its minimal, no-coupling form.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| User opens popout but doesn't have `pi-dashboard-subagents` installed → empty timeline | Tier-4 "No detail available yet" + the recommended-extensions UI surfaces the missing plugin pairing. |
| Parent session deleted/archived while popout is open | "Parent session not found" empty state with explicit "close this tab" CTA. |
| Popout URL gets stale when sessionId is reassigned | Acceptable — same behavior as any session URL today. |
| App.tsx wiring is not yet shipped (see proposal.md "Status") | Commit is flagged WIP. Components are inert without wiring; no regression vs. before this change. |
| Producer wire-format changes break this consumer | The contract is locked in `pi-dashboard-subagents`'s openspec; both repos must move together for breaking changes. |
| Backfill writes to subagents map could race with live `subagent_*` events for the same id | Merge semantics in Decision 7 preserve non-undefined prior fields, making live + replay paths commutative. |
| Mid-flight subagent state is still lost on refresh (only completed runs survive via backfill) | Acceptable for v0.1.x — producer is foreground-only and runs are short. Tracked as Open Question; future change can add a server-side replay buffer if needed. |
| Producer's `loadSettings()` in-memory cache means the toggle change isn't picked up until the next pi process restart | Mitigation lives in the producer (call `invalidateSettingsCache()` at the top of `onSpawn`). Tracked in producer repo, not blocking this change. |
| User installed `@tintinweb/pi-subagents` and now its `Agent` tool calls render via `GenericToolRenderer` (no card UI) | Expected end-state. Recommended-extensions UI surfaces `pi-dashboard-subagents` as the dashboard-supported option. No regression for users who switch. |
| Producer file format drift (a future producer version adds keys we don't know about) | The plugin server's write-through mirror merges with the existing file contents; unknown keys are preserved by the read-modify-write loop. |

## Migration Plan

For users who currently have `@tintinweb/pi-subagents` installed:

- Their `Agent` tool calls continue to flow into pi and execute. The dashboard renders them via `GenericToolRenderer` after this change — no specialized card, no inspector.
- `get_subagent_result` and `steer_subagent` tool calls (if their subagent spawns are backgrounded) also render via `GenericToolRenderer`.
- Recommended-extensions panel surfaces `pi-dashboard-subagents` as the dashboard-supported subagent extension. Switching is the user's call.

For users on `pi-dashboard-subagents`:

- Inspector "just works" once the App.tsx wiring (§7) lands. Replay/refresh works once the reducer backfill (§12) lands. Settings UI surfaces a single toggle whose initial value reflects the producer's actual config file (§16 startup reconcile). No data migration is necessary.

## Open Questions

**Resolved**

- ~~Should the pill show completed background subagents?~~ — N/A, pill dropped.
- ~~Should the popout show on session end?~~ — Yes, the popout subscribes independently; the dashboard's session-ended status doesn't unmount it.
- ~~Should the Tier-2 upgrade footnote eventually be removed?~~ — Yes, the entire Tier-2 fallback is being removed in §14 (no longer a stable state given `pi-dashboard-subagents` is the recommended producer).
- ~~Where does the settings UI live?~~ — In subagents-plugin, claiming the standard `settings-section` slot, using `configSchema.json` + `usePluginConfig` + the shared `POST /api/config/plugins/:id` route (Decision 9).
- ~~How does the dashboard plugin's setting reach the producer?~~ — Plugin server's Fastify `onResponse` hook mirrors dashboard config → producer file at `~/.pi/agent/extensions/pi-dashboard-subagents/config.json`; startup reconcile copies producer file → dashboard config on first load (Decision 10).
- ~~How is `agentMdPath` displayed?~~ — Read-only monospace line under the displayName in `SubagentDetailView`'s header. No editor-open integration (Decision 11).

**Open / out of scope here**

- Should mid-flight subagents survive a dashboard refresh (i.e. a refresh while the subagent is still running, before the parent has written the tool result to JSONL)? — Out of scope; would require a server-side per-session ring buffer of recent `subagent_*` events keyed by `agentId`, drained on `subagent_completed/failed`. Tracked as a candidate follow-up change.
- Should the producer's `loadSettings()` cache be invalidated on every `onSpawn`? — Yes, but the fix lives in the producer repo (`pi-dashboard-subagents/extensions/agent.ts` calls `invalidateSettingsCache()` at the top of `onSpawn`). Not in this change's scope.
- ~~Should `pi-dashboard-subagents` be bundled in the Electron installer?~~ — Yes (resolved during scoping). Both technical gates pass (git source, MIT license). Bundled-extensions activation in `packages/electron/src/lib/dependency-installer.ts` already handles the registration; only the `BUNDLED_EXTENSION_IDS` entry is needed. Captured in tasks §13.6–§13.9.
- Should the four un-surfaced producer settings (`exposeInheritanceInTool`, `inheritance.*`) eventually have UI? — Maybe, once user feedback says so. Producer file editing remains the supported power-user path until then. No code changes needed if they graduate; just add fields to `configSchema.json` and the form.
