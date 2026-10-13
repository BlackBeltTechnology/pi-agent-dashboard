## Context

See `proposal.md` for the motivation and `exploration.md` for the decision log. UX is fixed by `mockups/ui-plan.md` and the interactive `mockups/index.html`.

Existing machinery this design builds on:

- **Resolved skills.** `scanPiResources` resolves skills through pi's own resolver (`packages/server/src/pi/pi-resource-scanner.ts`, see its `.AGENTS.md`). The result shape is `PiResourcesResult { local, global, packages[], degraded? }` (`packages/shared/src/rest-api.ts:559`), with skills under `local.skills`, `global.skills` and `packages[].resources.skills`. `PiPackageInfo.scope` is `"local" | "global"` (`rest-api.ts:556`). `PiResource` carries `name, description, filePath, enabled, packageSource` and no body (`rest-api.ts:501`).
- **Cache.**
  - `directoryService.getPiResources(cwd)` returns `{data, stale} | undefined`; `refreshPiResources(cwd)` rescans (`packages/server/src/directory-service.ts:217-219`, `:1702-1710`).
  - `GET /api/pi-resources` serves stale data at once and revalidates in the background (`packages/server/src/routes/openspec-routes.ts:489-526`). Without a `cwd` it scans `process.cwd()`, which is how the global settings pages call it (`:495`).
- **Invalidation.** `pi-resources-watcher` is non-recursive. It watches `.pi/`, its resource subdirectories and `settings.json` for the cwd and for `~/.pi/agent` (`packages/server/src/pi/pi-resources-watcher.ts:1-17`), and calls `onInvalidate(cwd | undefined)`, where `undefined` means global. `directory-service.ts:629` wires that call to `invalidatePiResources` (`:1462`). Editing an existing `skills/x/SKILL.md` does **not** fire, because the file sits one level too deep.
- **`commands_list`.** It arrives from the bridge on session register, reload and flow changes (`packages/extension/src/session-sync.ts:183,314`, `flow-event-wiring.ts:182`). It is handled only in core, at `packages/server/src/event-wiring.ts:2112` (`sessionCommandRegistry.retain` plus a fan-out to browsers).
- **Plugin server context.** `ServerPluginContext` is defined at `packages/dashboard-plugin-runtime/src/server/server-context.ts:936`. Optional capability precedent: `isPiExtensionInstalled?` (`:1042`, wired at `packages/server/src/server.ts:3177`). Two existing hooks do **not** see `commands_list`:
  - `registerPiHandler` receives only `plugin_pi_message` frames, keyed by `messageType` (`event-wiring.ts:1000-1005`, `server.ts:1486`).
  - `onEvent` receives only forwarded pi events (`event-wiring.ts:1048`, `server.ts:1504`).
- **Slots.**
  - The taxonomy lives in `packages/shared/src/dashboard-plugin/slot-types.ts`, and props in `slot-props.ts`.
  - The `settings-section` `tab` field is inert (`openspec/specs/dashboard-plugin-loader/spec.md:1092`), so a plugin cannot render inside the Skills page today.
  - `ResourceGridPanel` serves both the folder surface (`scopes` includes `"local"`) and the global surface (`["global"]`) (`packages/client/src/components/resource/ResourceGridPanel.tsx:1-5,43-45`).
- **Folder menu.** `useFolderMenuItem(scope, contribution)` with groups `workspace|directory|create|open|maintenance` (`packages/dashboard-plugin-runtime/src/folder-menu-contributions.tsx`; `docs/migration/slot-pill-actions-to-folder-menu.md`).
- **Routes.** `shell-overlay-route` supports `presentation: "content"` with `depth` and `parentPath`, plus a trailing `/*?` (`docs/plugin-apps.md:11-36`).
- **Settings promotion.**
  - The allowlist is `PROMOTION_GROUP_ALLOWLIST = new Set(["models"])` (`packages/client/src/lib/settings-promotions.ts:18`, applied at `:101`).
  - The spec says the allowlist contains exactly `models` (`openspec/specs/settings-panel/spec.md:1699`).
  - The `resources` nav group (Skills, Agents, Extensions, Prompts, Themes) is built in at `packages/client/src/components/settings/SettingsPanel.tsx:1203-1211`.

## Goals / Non-Goals

**Goals:**
- Graph = pure function of resolved state, rebuilt only when the state's fingerprint moves.
- Body edits picked up on the next request without new recursive watchers.
- Live push to open atlas views on skill add/remove/edit-then-reload.
- Plugin packaging: disabling the plugin removes every surface; host additions are optional, additive seams.

**Non-Goals:**
- Incremental graph diffing (full rebuild is ms-range at ~100 skills).
- Prompts/agents/extensions as nodes (the types stay open-ended; v1 emits skills only).
- Fixing nord-light palette debt (`--link` 3.49:1, `--tint-green` pair 4.44:1) — separate change.
- `app-nav-item` global header slot — separate change.

## Decisions

### D1 · Plugin package `packages/skill-atlas-plugin`, id `skill-atlas`, npm `@blackbelt-technology/pi-dashboard-skill-atlas-plugin`
`src/shared/` (pure), `src/server/` (route + memo + push), `src/client/` (section, atlas page, views). The `@blackbelt-technology/` scope is needed for settings promotion trust (`settings-panel/spec.md:1699`).
*Alternative:* core feature (original proposal). Rejected per user: plugin keeps core lean and the atlas optional.

### D2 · `buildSkillGraph(inputs) → { skills, links }` is pure, in `src/shared/`
Input per skill: `{ id, description, filePath, origin: "project"|"global"|"package", pkg?: string, body: string }`.
- `id` is the frontmatter `name`, compared exactly (the same value `PiResource.name` carries, `rest-api.ts:502`).
- `pkg` is the package name for package skills and `undefined` for loose skills. Loose skills never bundle.

Output: `{ skills: SkillNode[], links: SkillLink[] }`.
- The builder dedupes duplicate ids. Origin priority is `project` > `package` > `global`; within one origin the lexicographically smallest `filePath` wins, so the result never depends on input order.
- Nodes are sorted by id. Links are sorted by `(source, target, type)`.
- Self-links and duplicate `(pair, type)` entries are dropped.
- No `node:` imports, no fs, no clock, no hashing. The fingerprint lives on the server (D3).

Rules:
- `references` (directed) is **ported** from `~/.pi/agent/skills/skill-atlas/scripts/lib/scan.mjs:357-371` (personal tool; the vendored snapshot was removed after porting).
  - Ids are regex-escaped before matching. An id containing characters outside `[A-Za-z0-9 _.-]` is matched as a literal and never throws.
  - A hyphenated id matches with the exact boundary class `(^|[^A-Za-z0-9_-])<id>([^A-Za-z0-9_-]|$)`, case-insensitively. This is a deliberate change: the reference was case-sensitive here.
  - A single-word id matches only as `/skill:<id>\b`, `\bskill:\s*<id>\b`, or `\b<id> skill\b`, case-insensitively.
  - Ids shorter than 4 characters are skipped.
- `bundle` (undirected) is ported (`scan.mjs:373-379`): same defined `pkg`, group size 2 to 14 inclusive.
- `shares-tool` (undirected) is a **new rule, not a port**. The reference used a hardcoded `TOOL_VOCAB` with bare `tool(` matching (`scan.mjs:163,199-203`).
  - A skill's tokens are backticked `snake_case` identifiers matching `` `[a-z][a-z0-9]*(_[a-z0-9]+)+(\(\))?` ``. A trailing `()` is stripped, so `` `ctx_execute()` `` and `` `ctx_execute` `` are one token.
  - Counts are taken over the skills in the requested scope, so the same pair can link in the project atlas and not in the global one. This is by design.
  - A token links its skills when 2 to 6 skills mention it (Q2). A pair sharing several tokens gets **one** `shares-tool` link, whose `why` lists all of them, sorted.
  - Undirected links (`bundle`, `shares-tool`) are canonicalized as `source = min(id)`, `target = max(id)` before dedupe and sort.
  - Single-word and uppercase tool names (e.g. `Bash`, `browser`) are intentionally out of scope, and the edge set differs from the reference.
  - Tests are written fresh from the spec. `selftest.mjs` has no cases for this rule.

`SkillLinkType` and the node `kind` are string unions designed to grow (Q6). Every link carries a human-readable `why`.
*Alternative:* keep `TOOL_VOCAB`. Rejected because it is machine-specific.

### D3 · Fingerprint and memo (Q1 b), server-side
The plugin server builds the input list from `getPiResources`.
- It keeps only `enabled !== false` skills, since pi does not load disabled ones.
- It `stat`s each `filePath` and computes `fingerprint = sha256(scope, degraded, sorted "id\0origin\0pkg\0description\0filePath\0mtimeMs\0ctimeMs\0size" lines)` with `node:crypto`. Every builder input except the body is hashed directly; the body is covered by mtime, ctime and size. `ctimeMs` catches same-size edits that preserve mtime.
- `stat` ENOENT (the file vanished after the scan) excludes the skill. Any other `stat` or read error keeps the skill with an empty body. Both add a warning naming the skill and a `missing:`/`unreadable:` line to the fingerprint. The request never fails.

The memo key is `global` for the global scope and `project:<normalized cwd>` for a project. A project `cwd` must be absolute; a relative one is rejected with 400 before anything else. It is then normalized once, with `path.resolve` and any trailing separator stripped, and that one value is used for both the scan and the memo key. The memo holds `{fingerprint, graph, graphHash, lastBroadcastHash}` and is an LRU capped at 32 entries. `graphHash` is a sha256 of the serialized graph. Every build or rebuild sets `lastBroadcastHash = graphHash` when the entry is first created, so the first reload after a GET is silent.
- Every request re-stats; there is no identity short-circuit.
- An unchanged fingerprint returns the memo without reading any body.
- Otherwise the server reads the bodies (capped at 256 KiB each; a truncated or failed read adds a warning naming the skill and uses the partial or empty body) and rebuilds.
- GET keeps stale-while-revalidate for **membership**: a skill folder added or removed shows up on the first GET after the background rescan, or sooner through the push path (D5). **Body edits** show up on the very next GET, because the stat check runs on every request.

Cost on a hit is N `stat` calls. A benchmark task measures stat and rebuild time at 100 and 300 skills before the performance claim stands.
*Alternative:* a depth-2 watcher (Q1 c). Rejected because of EMFILE risk; npm-package skills sit outside watched roots anyway.

### D4 · Host seam `ServerPluginContext.getPiResources?(cwd?: string, opts?: { fresh?: boolean }): Promise<PiResourcesResult>`
- **Default.** Mirrors the route's read path (`openspec-routes.ts:505-510`): a cached entry is returned as is, a stale entry also triggers one background refresh, and a cold miss awaits a refresh.
- **`fresh: true`.** Resolves with a scan that **started after the call**. The host stamps every scan with a monotonically increasing start sequence and records the current sequence at call time. If the in-flight scan (`directory-service.ts:1546-1547`) started at or before that point, the host awaits it and then starts a new scan. It resolves with the first scan whose start sequence is greater than the recorded one. This matters because `refreshPiResourcesInternal` hands back any in-flight scan, which may predate the edit, and `invalidatePiResources` only marks the entry stale (`:1462-1471`). The push path (D5) uses `fresh`.
- **Return value.** The raw scan result, **not** the provenance-joined payload the route returns (`openspec-routes.ts:521`, `joinSkillProvenance`). The atlas needs membership, not per-session load status. `degraded` comes from the raw result.
- **Missing `cwd`.** Means `process.cwd()`, the same as the route.
- **Optionality.** Optional on the type, following the `isPiExtensionInstalled?` precedent. The plugin route returns 501 when the seam is absent.

*Alternative:* loopback HTTP to `/api/pi-resources`. Rejected: an extra hop plus `networkGuard`/auth coupling.

### D5 · Host seam `ServerPluginContext.onPiResourcesInvalidated?(handler: (cwd: string | undefined) => void): () => void`
The host fans out from two sources:
- (a) `invalidatePiResources(cwd)` (`directory-service.ts:1462`, called from the watcher at `:629`). `undefined` means global.
- (b) `commands_list` arrival (`event-wiring.ts:2112`). The `cwd` comes from `sessionManager.get(sessionId)?.cwd`; an unknown session emits nothing. `commands_list` also fires on flow rediscover/complete (`flow-event-wiring.ts:179-184`), which is why the plugin debounces and the check is stat-only.

Handlers are try/caught per subscriber.

Plugin reaction:
1. Collect the affected memo keys.
   - For a `cwd`: every project entry whose normalized cwd equals it, is an ancestor of it, or is beneath it, compared path segment by segment. So a session in `/repo/.worktrees/x` re-checks `project:/repo`, and `/repo` never matches `/repo-2`.
   - Every callback also adds the `global` entry. That check is stat-only, and it covers global and npm-package skill changes that no watcher sees.
   - For `undefined`: every entry.
2. Debounce 500 ms per key.
3. Call `getPiResources(cwd, { fresh: true })`.
4. Re-fingerprint.
5. If the fingerprint moved, rebuild.
6. Broadcast `{ type: "skill_atlas_changed", scope, cwd? }` via `broadcastToSubscribers` only when `graphHash !== lastBroadcastHash`, then store it. Comparing against the last broadcast, rather than the memo, means a GET that rebuilt first cannot swallow the push. A content-neutral chmod or touch rebuilds an identical graph and sends nothing.

An unopened scope (no memo entry) costs nothing.
*Alternatives:* `registerPiHandler("commands_list")` does not work, because it only sees `plugin_pi_message` frames (`event-wiring.ts:1000-1005`). Filtering `onEvent` is brittle. No push at all is not live.

### D6 · New slot `resource-page-section` (many, react-only)
Props: `{ resourceType: "skill"|"agent"|"extension"|"prompt"|"theme"; scope: "folder"|"global"; cwd?: string; pluginContext }`. `ResourceGridPanel` renders the claims above the grid:
- `scope` is `"folder"` when `scopes` includes `"local"` (`ResourceGridPanel.tsx:45`), otherwise `"global"`;
- `ResourceGridPanel` gains an optional `cwd` prop (its `Props` at `ResourceGridPanel.tsx:29-41` has none today), passed by the folder surface;
- `cwd` is the folder's cwd.

The claim manifest carries an optional `resourceType` filter, and the consumer renders only matching claims. The skill-atlas plugin claims `resourceType: "skill"`. It is a minor taxonomy bump (`dashboard-shell-slots` "Adding a new slot is a minor version bump").

### D7 · Routes and entry points
- **Project atlas.**
  - Route: `shell-overlay-route`, path `/folder/:encodedCwd/atlas/*?`, `presentation:"content"`, `depth:2`, `parentPath:"/folder/:encodedCwd"`.
  - Entry: a `useFolderMenuItem` item `{id:"skill-atlas", group:"open", label:"Skill Atlas", icon: mdiGraphOutline}` contributed from a mount point that has folder scope. A `sidebar-folder-section` component calls `useFolderMenuItem` and then renders `null`, so no pill appears. Precedent: `packages/automation-plugin/src/client/FolderAutomationSection.tsx:60` registers the item, and `:81` returns `null` when there is no data.
- **Global atlas.**
  - Route: `shell-overlay-route` `/atlas/*?`, `presentation:"content"`, `depth:2`, `parentPath:"/settings/skills"`. This one URL claim gives the `/atlas` route the user asked for. A separate `command-route` claim would be redundant. *(Implementation deviation: planned as depth 1 with no parent, but `overlay-claim-underlay.test.ts` requires every overlay claim's cold-load underlay and Back target to be a real surface, never `/`. Back and underlay are now the Global Skills settings page.)*
- **Settings entry.**
  - A `settings-section` claim with `nav: { group: "resources", label: "Skill Atlas" }` renders a compact global summary plus "Open atlas" → `/atlas`.
  - Requires adding `resources` to `PROMOTION_GROUP_ALLOWLIST` (MODIFIED `settings-panel` requirement). Promoted entries render after the built-in Resources items. The Plugins subtree keeps a pointer row "Skill Atlas ↗ Resources", as `settings-panel/spec.md:838` requires for every enabled promoted plugin.
- **Skills pages.** `resource-page-section` on the Folder and Global Skills pages carries the compact summary, the most-connected chips and "Open atlas".

### D8 · REST + wire
- `GET /api/plugins/skill-atlas/graph?scope=project|global&cwd=<abs>` sits behind `networkGuard`.
  - `scope=project` requires `cwd`, else 400. `scope=global` ignores `cwd`.
  - Response: `{ success, data: { scope, cwd?, fingerprint, builtAt, degraded, skills, links, warnings[] } }`.
- Node payload: `{id, description, filePath, origin, pkg?, degree}`. No body is sent.
- "Open SKILL.md" reads through the existing `GET /api/pi-resource-file?path=` (`openspec-routes.ts:529-560`). That route allows paths under `~/.pi/agent`, under known folders' `.pi/`, under `.pi/git/`, and under `node_modules/`. The atlas only ever passes a scanner-resolved `filePath` whose basename is `SKILL.md`. A path outside those roots (e.g. a local-path package) is refused by that route; the detail panel then shows an inline error, never a blank viewer. The SKILL.md is rendered by the existing resource file viewer; the atlas itself renders only escaped text.
- Graph membership:
  - project = `local.skills` (origin `project`) ∪ `global.skills` (origin `global`) ∪ `packages[].resources.skills` (origin `package`). The project highlight (green ring) marks origin `project` only;
  - global = `global.skills` ∪ packages with `scope:"global"`.
  - Dedupe happens in the builder (D2).
  - Any absolute `cwd` is accepted (normalized per D3), the same as `GET /api/pi-resources?cwd=` behind the same `networkGuard`. The global atlas scans the same base the existing Global Skills page uses (`process.cwd()`, `openspec-routes.ts:495`), so both surfaces always agree.

### D9 · Client
- A `useSkillGraph(scope, cwd?)` hook fetches the graph and refetches on `skill_atlas_changed` matching `(scope, cwd)`. During a refetch it keeps the stale graph and sets `updating=true`.
- Views and behaviour are as in `mockups/ui-plan.md`:
  - SVG force layout, hand-rolled (Q8): seeded LCG, a fixed iteration count, computed once per `fingerprint`, no animation tick.
  - Labels are placed greedily by priority.
  - Focus mode re-fits the view to the k-hop set.
  - Cards and Links hide non-matching items; the graph dims shapes.
  - Mutual references show as one `↔` row.
  - Above 300 nodes the Graph tab is disabled.
- Layout positions are computed in a normalized model space (deterministic per graph), then scaled to the viewport at render time.
- Layout and label placement are pure functions in `src/client/graph-layout.ts`, so they can be unit tested.

## Risks / Trade-offs

- **[Stat cost on large setups]** 300 skills means 300 `stat` calls per GET. → Measured (task 4.5, Apple-silicon dev machine): 300 `stat` ≈ 3–4 ms; reading 300 × 256 KiB ≈ 30–55 ms; `buildSkillGraph` ≈ 75 ms after replacing per-id regex scans with a linear per-body mention index (≈ 500 ms before). P1 (memo hit, 100 skills) and P2 (rebuild, 300 × 256 KiB) are asserted by `atlas-perf.test.ts`. Rebuild timing is logged; the memo is an LRU of 32.
- **[`commands_list` churn]** Reloads, plus flow rediscover/complete events. → Only that cwd's memo entries are re-checked, with a per-key 500 ms debounce, and a broadcast is sent only when the fingerprint moved.
- **[Global atlas depends on the server's start directory]** Project-scope disables in the server's own cwd also shape the global list. → This is accepted, because it matches the existing Global Skills page exactly. A cwd-independent global scan is out of scope.
- **[Arbitrary `cwd`]** A caller can scan any directory. → This has parity with `/api/pi-resources` under the same `networkGuard`; the memo LRU bounds memory.
- **[False `shares-tool` edges]** The heuristic treats any shared backticked snake_case token as a tool. → The 2–6 band filters both ubiquitous and unique tokens, every edge carries its token in `why`, and the relation can be toggled off in the UI.
- **[`references` false positives on single-word ids]** → Strict mention forms are kept (ported rule). Unit tests cover the `doctor`/`browser` collisions from `selftest.mjs`.
- **[Untrusted SKILL.md text]** → Bodies are never sent to the client. Descriptions render as escaped text only. Paths come only from scanner-resolved resources.
- **[New public plugin API]** Two seams plus a slot are hard to remove. → All three are optional and additive. The doubt-review runs before they stand.
- **[Promotion allowlist widening]** Other first-party plugins could also promote into Resources. → The same trust and reserved-label rules apply unchanged.

## Migration Plan

Additive only: new package, optional seams, new slot, allowlist entry. No persisted data and no config migration. Plugin config defaults to enabled, the same as other first-party plugins.
Rollback: disable the plugin in Settings ▸ Plugins and restart (plugin toggles are restart-required, `docs/architecture.md:1284`), or revert the commit. The host seams are inert without a subscriber.

## Open Questions

None blocking. The debounce (500 ms) is a tunable constant. The node cap (300) is fixed by the spec.
