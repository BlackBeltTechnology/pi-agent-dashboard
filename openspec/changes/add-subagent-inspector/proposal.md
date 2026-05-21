## Why

The dashboard renders subagent (Agent tool) results via `AgentToolRenderer.tsx`. Today it shows:

- Summary fields (displayName, status, activity, toolUses, tokens) inline on a static card.
- No way to drill into the subagent's reasoning, tool calls, or assistant text.
- No popout / dedicated view for inspecting a subagent's full run.

We need a subagent inspector that lets users:

- **Expand** the agent card inline to see the full timeline (tool calls, reasoning, assistant text, errors).
- **Pop out** the inspector to a dedicated route (`/session/<sid>/subagent/<aid>`) for full-window viewing in a new tab.
- See the agent's source `.md` file path so they can open the definition (e.g. `~/.pi/agent/agents/Explore.md`).

This change establishes the dashboard-side consumer contract. The producer is the new `pi-dashboard-subagents` extension (separate repo at `/home/skrot1/BB/pi-packages/pi-dashboard-agents/`), which spawns subagents in-memory via `createAgentSession` and emits `subagents:*` events on pi's event bus carrying the full timeline.

The inspector code lives in its **own workspace plugin package** `packages/subagents-plugin/` — analogous to `packages/flows-plugin/` — so:

- Shell remains free of subagent-specific rendering code.
- Inspector ships as a discrete unit (versionable independently in principle).
- Future `extract-subagents-as-plugin` can move the renderer + reducer slice into the same plugin without disturbing the inspector.

## Status: WIP / unfinished

This change is **committed but unfinished**. Scope has expanded to absorb the
full "adopt `pi-dashboard-subagents` as the recommended producer" rewire,
including tintinweb removal and a settings surface. Specifically:

**Inspector core (Phase 1) — shipped**

- ✅ `packages/subagents-plugin/` workspace package with manifest, exports, types
- ✅ `SubagentDetailView` component (3 modes: inline, popout, row)
- ✅ `SubagentPopoutPage` route content
- ✅ `SubagentTimelineEntry` + `SubagentState` types (re-exported from shell)
- ✅ `AgentToolRenderer` expand toggle + popout button
- ✅ `GetSubagentResultRenderer` "Show details" link
- ✅ Shell reducer + `readSubagentDetails` helper
- ✅ `ToolContext.sessionId` + `session` fields

**Inspector pending**

- ⚠️ **`App.tsx` route registration + `toolContext.sessionId` wiring — NOT YET DONE** (§7)
  - The `/session/:sid/subagent/:aid` route is not registered. Popout buttons will fail to open.
  - The `toolContext` passed to ChatView does not include `sessionId`, so the popout URL cannot be built. Buttons render as disabled.
  - This wiring was done in an earlier draft but was lost in a working-copy reset.
- ⚠️ **Reducer backfill from `tool_execution_end` — NOT YET DONE** (§12)
  - `state.subagents.get(agentId)` is the canonical source for both inline-expand and popout. The only writers today are the live `subagent_*` event handlers. `state-replay.ts` does NOT synthesize those events, so after `/resume` or a page refresh, every completed subagent's map entry is missing — the popout renders "Subagent not found" even though the full `AgentDetails` is sitting in the parent's JSONL inside `ToolResultMessage.details`.
  - Fix: the reducer's `tool_execution_end` handler also writes to `next.subagents` when `toolName === "Agent"` and `data.details?.agentId` is present. See `design.md` Decision 7.
  - Mid-flight survival (refresh while a subagent is still running) is OUT OF SCOPE — see Open Questions in `design.md`.

**Producer adoption (Phase 2 — NEW scope folded into this change)**

- ⚠️ **Recommended-extensions swap + Electron bundling — NOT YET DONE** (§13)
  - Remove `tintinweb-pi-subagents` from `RECOMMENDED_EXTENSIONS`.
  - Add `pi-dashboard-subagents` (source `https://github.com/BlackBeltTechnology/pi-dashboard-subagents.git`, status `optional`, `dashboardPlugin: "subagents"`). The package is not yet published to npm — git URL is the only install path. Switching to `npm:pi-dashboard-subagents` becomes a one-line edit once the producer is published.
  - Add `"pi-dashboard-subagents"` to `BUNDLED_EXTENSION_IDS` so the Electron installer ships the producer pre-cached. Both technical gates pass: source is git, license is MIT.
- ⚠️ **Tintinweb coexistence code removal — NOT YET DONE** (§14)
  - Delete `GetSubagentResultRenderer.tsx` + `SteerSubagentRenderer.tsx`.
  - Drop tool-renderer registry entries for `get_subagent_result` and `steer_subagent`.
  - Remove `SubagentDetailView` Tier-2 fallback (the "Showing summary; install …" footnote path). Tier 1 / Tier 3 / Tier 4 remain.
  - Refresh `@tintinweb/pi-subagents` header comments in `AgentToolRenderer.tsx`.
  - Delete `docs/plans/tintinweb-subagents.md` (obsolete revert guide).
  - Update tests that assert tintinweb wiring.
- ⚠️ **Surface `agentMdPath` — NOT YET DONE** (§15)
  - The producer ships `details.agentMdPath` (absolute path to the agent's `.md` definition file). `readSubagentDetails` does not pull it today.
  - Add `agentMdPath?: string` to `SubagentState`; pull in `readSubagentDetails`; render as a small monospace path line under the displayName in `SubagentDetailView`'s header (read-only, no editor-open machinery).
- ⚠️ **Settings section claim + plugin server hook + form UI — NOT YET DONE** (§16)
  - Use the **canonical** plugin-settings flow (same shape as roles-plugin, flows-anthropic-bridge-plugin, demo-plugin): `configSchema.json` + `settings-section` claim + `usePluginConfig` + the shared `POST /api/config/plugins/:id` route. No custom REST endpoints.
  - New `src/configSchema.json` — JSON Schema 7 with one property: `inheritContext: boolean` (default `true`). `additionalProperties: false` for the schema (no other knobs surfaced in the UI).
  - New `src/client/SubagentsSettings.tsx` — single toggle "Fork parent context into every subagent". Reads via `usePluginConfig<{ inheritContext?: boolean }>()`, writes via `POST /api/config/plugins/subagents` with `{ inheritContext: <bool> }` body.
  - New `src/server/index.ts` — minimal plugin server entry. Two responsibilities only:
    1. **Startup reconcile.** On `registerPlugin(ctx)`, read the producer's `~/.pi/agent/extensions/pi-dashboard-subagents/config.json` (if it exists) and call `ctx.updatePluginConfig({ inheritContext: producerValue })` so the dashboard plugin config reflects producer truth at first load. This makes the toggle show the right state even if the user has been editing the producer file by hand.
    2. **Write-through mirror.** Register a Fastify `onResponse` hook that fires when `POST /api/config/plugins/subagents` returns 200, reads `ctx.getPluginConfig<{inheritContext}>()`, and writes the value into the producer file via an atomic write that *preserves* unexposed keys (`exposeInheritanceInTool`, `inheritance.recentTurns`, `inheritance.toolOutputWindow`, `inheritance.maxChars`, plus any `additionalProperties` a power user added by hand).
  - Manifest additions: `configSchema: "./src/configSchema.json"`, `server: "./src/server/index.ts"`, one `settings-section` claim (`tab: "general"`), `requires: { piExtensions: ["pi-dashboard-subagents"] }` so the plugin activation UI surfaces the missing-extension pairing.

- ❌ Background-subagents pill & panel — DROPPED (producer is foreground-only).

## What Changes (compared to before this change)

**NEW plugin files (already shipped — see Phase 1 above)**

- **NEW** `packages/subagents-plugin/` — workspace plugin package with `pi-dashboard-plugin` manifest (id: `subagents`).
- **NEW** `packages/subagents-plugin/src/client/{SubagentDetailView,SubagentPopoutPage,types,index}.tsx` — inspector components + canonical wire-contract types.
- **NEW** tests under `packages/subagents-plugin/src/client/__tests__/`.

**NEW plugin files (Phase 2 — settings surface)**

- **NEW** `packages/subagents-plugin/src/configSchema.json` — JSON Schema 7. One property: `inheritContext: boolean` (default `true`). Validated by the plugin runtime's standard `validatePluginConfig` (Ajv) on every write to `POST /api/config/plugins/subagents`.
- **NEW** `packages/subagents-plugin/src/server/index.ts` — minimal plugin server entry. Exports a `registerPlugin(ctx)` default function that (a) reconciles producer file → plugin config at startup, (b) installs a Fastify `onResponse` hook that mirrors dashboard plugin config → producer file on every successful `POST /api/config/plugins/subagents`. No custom REST routes.
- **NEW** `packages/subagents-plugin/src/server/producer-file.ts` — pure helpers: `readProducerFile(): Partial<ProducerSettings>`, `writeProducerFile(merged: ProducerSettings): void`. Atomic write via tmp + rename. Preserves unexposed keys (`exposeInheritanceInTool`, `inheritance.*`) and any `additionalProperties` the user added by hand. Path resolved via `os.homedir()` + `.pi/agent/extensions/pi-dashboard-subagents/config.json`.
- **NEW** `packages/subagents-plugin/src/client/SubagentsSettings.tsx` — settings-section component. Single toggle "Fork parent context into every subagent". Reads via `usePluginConfig<{ inheritContext?: boolean }>()`. Writes via `fetch("/api/config/plugins/subagents", { method: "POST", body: JSON.stringify({ inheritContext }) })`. No custom client API helper module needed.

**Modified plugin files**

- **MODIFY** `packages/subagents-plugin/package.json` — adds `configSchema: "./src/configSchema.json"`, `server: "./src/server/index.ts"`, one `settings-section` claim (`tab: "general"`), `requires: { piExtensions: ["pi-dashboard-subagents"] }`.
- **MODIFY** `packages/subagents-plugin/src/client/types.ts` — adds `agentMdPath?: string` to `SubagentState`.
- **MODIFY** `packages/subagents-plugin/src/client/SubagentDetailView.tsx` — renders `agentMdPath` as monospace line under displayName; removes the Tier-2 fallback branch (running-without-entries footnote) — Tier 1 / Tier 3 / Tier 4 remain.

**Modified shell-side files**

- **MODIFY** `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx` — already has expand + popout buttons; refresh header comments (`@tintinweb/pi-subagents` → `pi-dashboard-subagents`).
- **MODIFY** `packages/client/src/components/tool-renderers/types.ts` — `ToolContext` gains optional `sessionId?: string` + `session?: SessionState` (already shipped).
- **MODIFY** `packages/client/src/lib/event-reducer.ts` — `readSubagentDetails` pulls `agentMdPath`; `tool_execution_end` handler backfills `next.subagents` for completed Agent runs (closes `/resume` / refresh gap — see §12).
- **MODIFY** `packages/client/src/components/tool-renderers/registry.ts` — drops `get_subagent_result` and `steer_subagent` registrations.
- **MODIFY** `packages/client/package.json` — adds workspace dep on `@blackbelt-technology/pi-dashboard-subagents-plugin` (already shipped); no new deps for Phase 2.
- **MODIFY** `packages/shared/src/recommended-extensions.ts` — removes `tintinweb-pi-subagents` entry; adds `pi-dashboard-subagents` entry with `status: "optional"` and `dashboardPlugin: "subagents"`.
- **MODIFY** `packages/server/src/server.ts` (or wherever plugin server entries are mounted) — picks up the new plugin server entry automatically via the existing loader; no manual wiring expected.
- **PENDING** `packages/client/src/App.tsx` — register `/session/:sid/subagent/:aid` route, mount `<SubagentPopoutPage>`, pass `sessionId` + `session` through `toolContext`. Subscribe to parent session when popout loaded in a fresh tab. (See §7.)

**Deleted files**

- **DELETE** `packages/client/src/components/tool-renderers/GetSubagentResultRenderer.tsx`
- **DELETE** `packages/client/src/components/tool-renderers/SteerSubagentRenderer.tsx` (if present)
- **DELETE** their `*.test.tsx` counterparts
- **DELETE** `docs/plans/tintinweb-subagents.md`
- **DELETE** the `tintinweb-pi-subagents` entries in any test fixture that references it (`UnifiedPackagesSection.test.tsx`, `UnifiedPackagesSection.auto-check.test.tsx`).

## Capabilities

### Modified Capabilities

- `agent-tool-rendering` — extends with inline-expand, popout button, popout route, the `SubagentTimelineEntry` wire contract, an `agentMdPath` display, and a producer-facing settings surface (one toggle: fork parent context into every subagent). The renderer/route code lives in the `subagents-plugin` workspace package; the shell imports from it. Producer of the entries is `pi-dashboard-subagents` v0.1.x — the dashboard no longer recommends or specializes for `@tintinweb/pi-subagents`.

## Impact

- 5 plugin files shipped (~700 LOC) — Phase 1.
- 4 plugin files new for Phase 2 (configSchema.json, server/{index,producer-file}.ts, client/SubagentsSettings.tsx) (~250 LOC including tests). Uses the shared `POST /api/config/plugins/:id` route — no custom REST surface.
- 5 modified shell files for Phase 1 (~50 LOC churn).
- App.tsx wiring pending (~100 LOC, §7).
- Reducer backfill pending (~30 LOC, §12).
- Recommended-extensions swap pending (~40 LOC manifest churn, §13).
- Tintinweb removal pending (~150 LOC deleted, §14).
- agentMdPath surface pending (~20 LOC, §15).
- Settings section pending (~400 LOC including server + client + tests, §16).
- Server-side change: one new plugin server entry mounted via the existing plugin runtime (Fastify hook + startup reconcile). No shell-server code changes. No new REST routes.
- No bridge / pi-extension package changes (the producer extension already exists in `../pi-dashboard-agents/`).

## Out of scope

- **Background subagents**: the producer (`pi-dashboard-subagents`) is foreground-only by design. The original v1 of this change included a status-bar pill listing background subagents — dropped.
- **Producer-side settings cache invalidation**: the producer's `loadSettings()` keeps an in-memory cache and only re-reads on `invalidateSettingsCache()` or process restart. If a user flips the toggle while a pi process is running, the next subagent spawn in that process still sees the stale value. The clean fix lives in the producer (`invalidateSettingsCache()` at the top of `onSpawn`) and is tracked separately in the producer repo, not here. See `design.md` Open Questions.
(none yet — see Dependencies for what was previously listed here.)
- **Upstream prompt-cache fork**: orthogonal concern owned by `pi-dashboard-subagents`. Not visible at the dashboard layer.
- **Moving `AgentToolRenderer` into the plugin** (last shell-side subagent code): covered by the separate `extract-subagents-as-plugin` change. After this change closes, `extract-subagents-as-plugin` only has to move one file (`AgentToolRenderer.tsx`) plus its tests — the rest of the migration is already done.

## Dependencies

- `pi-dashboard-subagents` v0.1.1+ — the producer of `entries[]` and `agentMdPath`. Now the recommended subagent extension in `RECOMMENDED_EXTENSIONS`. Source: `https://github.com/BlackBeltTechnology/pi-dashboard-subagents.git` (not yet published to npm). Local checkout at `../pi-dashboard-agents/`. The Tier-2 fallback path is removed: when no entries are available (only possible during the loading window or producer bug), the inspector renders the existing Tier-3/Tier-4 states.
- `extract-subagents-as-plugin` — separate change that completes the plugin extraction (moves `AgentToolRenderer` into the plugin). After both changes land, the shell has no subagent-specific code at all.
