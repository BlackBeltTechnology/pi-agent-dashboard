## Context

`pi-blackhole` is a third-party pi extension providing algorithmic compaction plus observational memory. It owns three files under `~/.pi/agent/pi-blackhole/`:

| File | Scope | Written by |
|---|---|---|
| `pi-blackhole-config.json` | global | extension + `/blackhole configure` |
| `pi-blackhole-cooldown.json` | global | extension (on retryable model errors) |
| `<sessionId>-pending.json` | **per session** | extension (worker cursors + unflushed batches) |

Today all of it is reachable only from inside a pi TUI session. The dashboard has an established pattern for the global half: `packages/hermes-memory-plugin/` is a settings surface for an external extension's JSON config, and this change follows it closely.

Design work was done against two mockups in `mockups/blackhole-settings/` (`index.html` = global config, `session-card.html` = per-session surface). Both score zero WCAG AA contrast failures across studio + light themes and every rendered state.

Constraints discovered by reading blackhole's source rather than its README:

- `src/om/pending.ts` names its per-session file from `ctx.sessionManager.getSessionId()` — the same call `packages/extension/src/bridge.ts` uses to populate `DashboardSession.id`.
- `src/om/status-overlay.ts` `StatusInfo` carries only enums, booleans and last-error strings. The token counters and observation counts the README advertises are computed at render time inside the session and never persisted.
- `src/om/ledger/` is a **projection over the pi session transcript**, not a store. Observations and reflections live in the transcript the dashboard already streams.
- The config loader preserves unknown keys, and the TUI overlay refuses to save when the file is unparseable.
- Blackhole resolves its agent directory from `PI_CODING_AGENT_DIR` — `src/pi-base/paths.ts` `getPiAgentDir()` reads it — and `src/om/pending.ts` uses pi's own `getAgentDir()` from `@earendil-works/pi-coding-agent`. Path parity must mirror that resolution, exactly as `hermes-memory-plugin/src/server/config-path.ts` mirrors hermes' `resolveAgentRoot()`.
- An unsatisfied `requires.piExtensions` does **not** deactivate a plugin or drop its claims — see D3. This was assumed and is false.

> **Scope note.** Split after five doubt-review cycles: this design covers the global settings surface. The per-session pipeline surface, its `session-card-memory` gate, the `content-view` drill-in and the approximate proximity meter moved to `add-blackhole-session-pipeline`, which carries the platform-gap blocker.

## Goals / Non-Goals

**Goals:**

- Edit every blackhole setting from the dashboard, including the ordered per-worker model fallback chains, with changes reaching running sessions immediately.
- Add no coupling to the `pi-blackhole` package and no changes to existing dashboard packages.
- Never destroy a user's config: preserve unknown keys, fail closed on unparseable input.
- Add no coupling to the `pi-blackhole` package and no changes to existing dashboard packages.

**Non-Goals:**

- Any per-session surface — the `session-card-memory` claim, the `content-view` drill-in, the per-session route, and the compaction-proximity meter. All moved to `add-blackhole-session-pipeline`.
- Triggering compaction, flushing, or `/blackhole cleanup` from the dashboard. Read/write config; do not drive the runtime.
- Installing or updating `pi-blackhole` on the user's behalf.

## Decisions

**D1 — Re-declare the config type; take no dependency on `pi-blackhole`.**
The plugin owns a `BlackholeConfig` interface plus a `FIELD_DESCRIPTORS` map, carrying a `SOURCE-VERSION PIN: pi-blackhole@<version>` comment.
*Alternatives:* (a) `"pi-blackhole": "github:k0valik/pi-blackhole"` — no semver, git fetch on every clean install, CI depends on GitHub availability; (b) `npm:pi-blackhole@^x` — drags an entire extension runtime in to read one interface, and its config types are internal to `src/`, so the import may silently degrade to `any`.
*Rationale:* the filesystem is the whole integration surface — blackhole hot-reloads after every write, so there is no function to import. Matches `hermes-memory-plugin` (D3) and `goal-plugin`. A dependency would also only catch new/removed keys; labels, help text, grouping and control kinds are hand-written either way.

*Drift-test mechanism, stated honestly:* with no dependency, the test compares the descriptor key set against a **vendored snapshot** of blackhole's `example-config.json`, refreshed by hand when the `SOURCE-VERSION PIN` is bumped. A snapshot cannot detect upstream drift on its own — it detects *our* descriptors drifting from the pinned version, and turns a pin bump into a forced diff review. Fetching upstream at test time is rejected (network in CI). The test also catches only key-set drift, never type/enum/bound changes to an existing key; those are caught by review at pin-bump time or not at all. This mitigation is weaker than "guards the copy" implies.

**D2 — This change owns the global surface only; per-session state is out of scope.**
`settings-section` reads and writes the global config file and reads the global cooldown file. Per-session state (`<sessionId>-pending.json`) and any session-card surface belong to `add-blackhole-session-pipeline`. The global settings page renders no per-session state — that direction of the split is absolute and unaffected by the platform gap that blocked the other half.



**D3 — `requires.piExtensions` does NOT hide the plugin; the settings component self-gates.**
An unsatisfied `requires` does **not** deactivate a plugin. `packages/dashboard-plugin-runtime/src/server/loader.ts` is explicit: *"a plugin whose requirements are unsatisfied is still 'loaded' from the loader's perspective — the UI surfaces the missing pieces and offers an inline install."* `missingRequirements` is consumed only by the Packages UI (`plugin-row-parts.tsx`, `PluginsSection.tsx`); neither `slot-registry.ts` nor the slot consumers filter on it. Only the **enabled-set** filter drops claims.

Therefore `requires.piExtensions` is an install-prompt affordance, not an activation gate. For a page-scoped `settings-section` this is harmless — the settings page is only reached deliberately, and rendering a not-installed state there is correct behaviour rather than a regression. (For session-card claims it is NOT harmless, which is what blocked the other half of the original change.)

The settings surface therefore renders its own not-installed state rather than relying on the host to withhold it. It is page-scoped, so no per-session availability signal is involved — the reason this half of the original change survived review unchanged while the session-card half did not.




**D5 — Writes are read-modify-write; unknown keys survive.**
`PUT` re-reads the file immediately before writing, applies only known keys, and serialises the merged object via write-temp-then-rename so a reader never observes a partial file.
*Alternative:* serialise the form model — rejected, silently destroys user annotations and any key added by a newer blackhole.
*Not solved:* the read and the write are two filesystem operations, and blackhole itself writes this file (`/blackhole configure`, migration-on-load). A concurrent external write between our read and our write is lost. See the cross-process race in Risks — accepted, not mitigated.

**D6 — Unparseable config fails closed, and the client renders no form.**
`GET` reports a parse error with position instead of falling back to defaults; `PUT` refuses. The client shows the error, the offending lines, and recovery actions — **not** a populated form.
*Rationale:* if the file cannot be parsed there are no values to display. Rendering defaults would assert something false about what the user's sessions are running. Mirrors blackhole's own overlay, which blocks save to avoid wiping model configs.

**D7 — Fallback chains are ordered lists with keyboard-accessible reordering.**
Each worker renders primary + fallbacks as a ranked vertical list with move-up/move-down/remove buttons; the implicit tail (base `model` → session model) is shown but not editable in place.
*Rationale:* `cooldown.json` keys cooldowns per model and resolution is strictly positional — the data model is a chain, not a set. Drag-only reordering would fail WCAG 2.1.1; buttons are keyboard- and screen-reader-operable and cheaper to build.





## Risks / Trade-offs

- **[Config drift — the re-declared type falls behind a blackhole release]** → `SOURCE-VERSION PIN` comment plus a test asserting our known-key set still covers blackhole's published `example-config.json`. Accepted, mirroring hermes D-R1.
- **[Destructive write drops user annotations]** → D5 read-modify-write, with a test that writes through a config containing `_comment`/`_notes`/unknown keys and asserts byte-level survival.
- **[Fabricated state on unparseable config]** → D6 fail-closed; test asserts no form controls render when `GET` reports a parse error.
- **[Cross-process write race on the config file]** → blackhole writes the same file (`/blackhole configure`, load-time migration of legacy keys). Our read-modify-write is non-atomic across the two operations, so an external write landing in between is silently lost. No file lock exists. Accepted: mitigated only by re-reading immediately before write and writing atomically, which narrows the window without closing it. A user editing config in the TUI and the dashboard simultaneously can lose one edit.
- **["Applies immediately" is a third-party runtime property, not a dashboard guarantee]** → the UI states it as observed current behaviour of the pinned blackhole version, and the spec requires only that the UI not claim a restart is needed. If blackhole stops hot-reloading, the statement becomes stale copy rather than a violated dashboard invariant.
- **[QA gating]** → verification of the populated states requires installing `pi-blackhole` locally; the not-installed states are verifiable without it. (`requires.piExtensions` does **not** hide the plugin — see D3.)
- **[Two pre-existing contrast defects surfaced during design]** → `--on-accent` on `--accent-primary` is 3.68:1 in studio theme, and `SessionSubcard`'s legend pill is 4.22:1 on `--bg-tertiary`. Both are shipped dashboard-wide defects, out of scope here; the mockups work around them locally and they should be filed separately.

## Migration Plan

New package; nothing to migrate. Rollout is additive and reversible:

1. Land `packages/blackhole-plugin/`; it stays inert until `pi-blackhole` is installed (`requires.piExtensions`).
2. With blackhole absent, the plugin still loads and its settings page renders the not-installed state with the install command. Nothing else in the dashboard changes.
3. Rollback = disable the plugin in config, or remove the package. No dashboard state, schema, or persisted data is touched; blackhole's files are left as they are.

## Open Questions

- Should the settings page surface a count of sessions currently using blackhole? Deferred — it needs the per-session data that `add-blackhole-session-pipeline` owns.
- `skipForProviders` is an experimental key blackhole documents as deliberately unsurfaced. Preserve it silently as an unknown key (current plan) or expose it behind an advanced disclosure?
