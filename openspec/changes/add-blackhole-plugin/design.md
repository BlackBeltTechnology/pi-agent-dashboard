## Context

`pi-blackhole` is a third-party pi extension providing algorithmic compaction plus observational memory. It owns three files under `~/.pi/agent/pi-blackhole/`:

| File | Scope | Written by |
|---|---|---|
| `pi-blackhole-config.json` | global | extension + `/blackhole configure` |
| `pi-blackhole-cooldown.json` | global | extension (on retryable model errors) |
| `<sessionId>-pending.json` | **per session** | extension (worker cursors + unflushed batches) |

Today all of it is reachable only from inside a pi TUI session. The dashboard has an established pattern for the global half — `packages/hermes-memory-plugin/` is a settings surface for an external extension's JSON config — and a reserved-but-unclaimed slot for the per-session half: `session-card-memory`, declared in `packages/shared/src/dashboard-plugin/slot-types.ts` with `multiplicity: "many"`, `payloadTier: "react-only"`, consumed by `MemorySubcard` in `packages/client/src/components/session/SessionCard.tsx`, and currently claimed by no plugin.

Design work was done against two mockups in `mockups/blackhole-settings/` (`index.html` = global config, `session-card.html` = per-session surface). Both score zero WCAG AA contrast failures across studio + light themes and every rendered state.

Constraints discovered by reading blackhole's source rather than its README:

- `src/om/pending.ts` names its per-session file from `ctx.sessionManager.getSessionId()` — the same call `packages/extension/src/bridge.ts` uses to populate `DashboardSession.id`.
- `src/om/status-overlay.ts` `StatusInfo` carries only enums, booleans and last-error strings. The token counters and observation counts the README advertises are computed at render time inside the session and never persisted.
- `src/om/ledger/` is a **projection over the pi session transcript**, not a store. Observations and reflections live in the transcript the dashboard already streams.
- The config loader preserves unknown keys, and the TUI overlay refuses to save when the file is unparseable.

## Goals / Non-Goals

**Goals:**

- Edit every blackhole setting from the dashboard, including the ordered per-worker model fallback chains, with changes reaching running sessions immediately.
- Show, per session, whether the memory pipeline is healthy, degraded, idle, or holding unflushed work — using only data that exists at rest.
- Never destroy a user's config: preserve unknown keys, fail closed on unparseable input.
- Add no coupling to the `pi-blackhole` package and no changes to existing dashboard packages.

**Non-Goals:**

- Blackhole's exact token counter, observation/reflection counts, `consolidationInFlight`/`compactInFlight`, and last-error strings. In-memory only; would require bridge forwarding. (A deliberately-approximate *proxy* for compaction proximity is in scope — see D12.)
- Rendering observations and reflections. They are transcript entries and belong to the chat view.
- Triggering compaction, flushing, or `/blackhole cleanup` from the dashboard. Read/write config; do not drive the runtime.
- Installing or updating `pi-blackhole` on the user's behalf.

## Decisions

**D1 — Re-declare the config type; take no dependency on `pi-blackhole`.**
The plugin owns a `BlackholeConfig` interface plus a `FIELD_DESCRIPTORS` map, carrying a `SOURCE-VERSION PIN: pi-blackhole@<version>` comment.
*Alternatives:* (a) `"pi-blackhole": "github:k0valik/pi-blackhole"` — no semver, git fetch on every clean install, CI depends on GitHub availability; (b) `npm:pi-blackhole@^x` — drags an entire extension runtime in to read one interface, and its config types are internal to `src/`, so the import may silently degrade to `any`.
*Rationale:* the filesystem is the whole integration surface — blackhole hot-reloads after every write, so there is no function to import. Matches `hermes-memory-plugin` (D3) and `goal-plugin`. A dependency would also only catch new/removed keys; labels, help text, grouping and control kinds are hand-written either way.

**D2 — Split surfaces by data scope: global file → settings page, `<sessionId>` file → session card.**
`settings-section` claim reads/writes the two global files. `session-card-memory` claim reads the per-session file. Neither surface reads the other's scope.
*Alternative:* a single settings page with a session picker — rejected, it puts per-session state on a global route and duplicates the session list the dashboard already renders.

**D3 — Reuse the existing `session-card-memory` slot; introduce no new slot.**
The slot, its payload (`{ session, pluginContext }`), and the auto-hiding `MemorySubcard` already exist. No change to `packages/shared/`, `packages/client/`, or `dashboard-shell-slots`.

**D4 — Join dashboard sessions to blackhole state by `session.id`, unmodified.**
The server route reads `~/.pi/agent/pi-blackhole/${session.id}-pending.json`.
*Evidence:* measured across 3,260 dashboard sessions against 3,410 pi transcripts — 9/9 live sessions and 3229/3229 sessions that ever produced a transcript matched a pi session file. All 31 non-matches had zero tokens in and out (registered but never ran). UUIDv4 ids in the list are genuine old pi sessions, not bridge-generated; the `crypto.randomUUID()` seed at `bridge.ts:197` is overwritten at `session_start` before registration.
*Note:* the v4-`agentId`-vs-v7-session-id dual identity issue applies to subagent cards, a different surface; `DashboardSession.id` is unaffected.

**D5 — Writes are read-modify-write; unknown keys survive.**
`PUT` re-reads the file, applies only known keys, and serialises the merged object. `_comment`, `_notes`, and any key the form does not manage are preserved byte-for-byte in value.
*Alternative:* serialise the form model — rejected, silently destroys user annotations and any key added by a newer blackhole.

**D6 — Unparseable config fails closed, and the client renders no form.**
`GET` reports a parse error with position instead of falling back to defaults; `PUT` refuses. The client shows the error, the offending lines, and recovery actions — **not** a populated form.
*Rationale:* if the file cannot be parsed there are no values to display. Rendering defaults would assert something false about what the user's sessions are running. Mirrors blackhole's own overlay, which blocks save to avoid wiping model configs.

**D7 — Fallback chains are ordered lists with keyboard-accessible reordering.**
Each worker renders primary + fallbacks as a ranked vertical list with move-up/move-down/remove buttons; the implicit tail (base `model` → session model) is shown but not editable in place.
*Rationale:* `cooldown.json` keys cooldowns per model and resolution is strictly positional — the data model is a chain, not a set. Drag-only reordering would fail WCAG 2.1.1; buttons are keyboard- and screen-reader-operable and cheaper to build.

**D8 — Absent per-session file is a normal state, not an error.**
The file only exists once a worker has run. The subcard distinguishes *no pipeline activity yet* (file absent, blackhole installed) from *workers off* (`memory: false`) from *not installed* (plugin inactive entirely).

**D9 — Worker health is encoded by letter + colour + accessible name.**
Pips render `O`/`R`/`D` with a state colour and a descriptive `title`/`aria-label`. Colour is never the sole channel (WCAG 1.4.1).

**D12 — Compaction proximity is shown as an explicit approximation, using `contextTokens` as a proxy.**
The subcard renders progress toward `compactAfterTokens` using the dashboard's `contextTokens`, marked as approximate, and always accompanied by the exact cursor-lag figure from the per-session file.

*The two numbers are different quantities, not two estimates of one:*

| | dashboard `contextTokens` | blackhole `rawTokensSinceLastCompaction` |
|---|---|---|
| source | provider `usage.totalTokens` | local estimate (`len/4`, pi's `estimateTokens`) |
| scope | what was actually sent, incl. system prompt, tool schemas, injected memory | transcript entries after the last compaction's `firstKeptEntryId` |
| effect of pi's history elision | reflected | not reflected |

*Measured*, on a live 255-entry session: `contextTokens` 283,622 vs a transcript-scope sum of 583,047 — a 2× divergence, with the proxy reading **lower**, opposite to the naive "the proxy includes more, so it reads higher" intuition. There is no constant offset or scale factor; the gap varies with loaded skills, tool count, injected memory, and how aggressively pi elides.

*Alternatives:* (a) reimplement blackhole's counter client-side — rejected, it requires replicating branch projection, `firstKeptEntryId` resolution and pi's estimator, and a crude attempt overshot by 2×; (b) omit the meter — rejected, compaction proximity is the signal users most want; (c) block on an upstream blackhole field — deferred, see Open Questions.

*Because the number is approximate, the presentation is constrained (see D13).* Accepting an approximate figure is a deliberate trade: a rough signal now, over an exact one that does not exist yet.

**D13 — Approximation is enforced by presentation rules, not a disclaimer alone.**
A caveat in help text is not sufficient mitigation; the rendering itself must not imply precision. Therefore: no precise percentage or exact token count is displayed for the proxy; the readout is coarse; the meter never triggers an automatic call-to-action or alarm at a fixed threshold; and an exact figure (cursor lag) is always rendered beside it so a precise signal is present. A disclaimer under a precise-looking number reads as rigour and is worse than no number.

**D10 — The degraded note is conditional.**
The second row exists only in the abnormal state, keeping the healthy card to a single 19px row. A session card is glanced at, not read.

**D11 — Drill-in is a `content-view` claim, and every value is source-tagged.**
The detail view labels each figure with the file it came from (`pending.json`, `cooldown.json`). Anything not readable at rest is absent, with a footer explaining why.

## Risks / Trade-offs

- **[Config drift — the re-declared type falls behind a blackhole release]** → `SOURCE-VERSION PIN` comment plus a test asserting our known-key set still covers blackhole's published `example-config.json`. Accepted, mirroring hermes D-R1.
- **[Destructive write drops user annotations]** → D5 read-modify-write, with a test that writes through a config containing `_comment`/`_notes`/unknown keys and asserts byte-level survival.
- **[Fabricated state on unparseable config]** → D6 fail-closed; test asserts no form controls render when `GET` reports a parse error.
- **[Session-id join breaks if pi changes id derivation]** → D4 is measured, not assumed; a missing file is already a valid state (D8), so the failure mode degrades to "no activity yet" rather than an error. A drift would be silent, which is the residual cost.
- **[Path traversal via the session route]** → `:id` is interpolated into a filename. Validate against a UUID shape and reject anything else before touching the filesystem; never `join` unsanitised input.
- **[QA gating]** → `requires.piExtensions` hides the plugin unless `pi-blackhole` is installed, so verification requires installing it locally.
- **[Reading a partially written per-session file]** → blackhole writes a `.stale.json` backup and replaces atomically, but a torn read is still possible. Treat a parse failure on the per-session file as "no activity yet" rather than surfacing an error on a session card.
- **[Approximate meter is read as exact and acted on]** → D13 presentation rules (coarse readout, no precise percentage, no threshold-triggered CTA, exact cursor lag alongside). Residual risk accepted deliberately: a user may still over-trust it. The clean fix is upstream, not a dashboard change.
- **[The proxy's error changes sign between sessions]** → the divergence depends on pi's elision behaviour and per-session loaded context, so the meter may read high in one session and low in another. This is why D13 bans a fixed-threshold CTA: a rule like "warn at 90%" would fire wrongly in both directions.
- **[Two pre-existing contrast defects surfaced during design]** → `--on-accent` on `--accent-primary` is 3.68:1 in studio theme, and `SessionSubcard`'s legend pill is 4.22:1 on `--bg-tertiary`. Both are shipped dashboard-wide defects, out of scope here; the mockups work around them locally and they should be filed separately.

## Migration Plan

New package; nothing to migrate. Rollout is additive and reversible:

1. Land `packages/blackhole-plugin/`; it stays inert until `pi-blackhole` is installed (`requires.piExtensions`).
2. With blackhole absent, the settings row renders the not-installed state and the MEMORY subcard does not appear (auto-hide on no claims).
3. Rollback = disable the plugin in config, or remove the package. No dashboard state, schema, or persisted data is touched; blackhole's files are left as they are.

## Open Questions

- **Upstream ask**: if `pi-blackhole` persisted `rawTokensSinceLastCompaction` (and the resolved `compactAfterTokens`) into the `<sessionId>-pending.json` it already writes, the proximity meter becomes exact, D12/D13's constraints can be lifted, and the "context slot" design below becomes buildable. This is a small upstream PR, not a dashboard change. Worth raising with the maintainer.
- **Deferred design — context-bar correction**: compaction proximity is arguably a *context* concern rather than a *memory* one, and the core `ContextUsageBar` measures against the model's window (1M for opus-5) while blackhole compacts at `compactAfterTokens` (81k default) — so the core bar reads ~8% green when blackhole is near its ceiling. Correcting it would need a new slot near the context bar (modifying `dashboard-shell-slots` and `SessionCard.tsx`) **and** an exact number, i.e. the upstream field above. Recorded as blocked, not rejected.
- Should the settings page surface a count of sessions currently using blackhole, as a bridge to the per-session surface? Deliberately omitted for now (D2), but it is the one cross-scope affordance with a plausible case.
- Is a `session-card-badge` claim warranted for the compaction-imminent state, so it is visible when the MEMORY subcard is collapsed or off-screen? Deferred until the subcard has been used.
- `skipForProviders` is an experimental key blackhole documents as deliberately unsurfaced. Preserve it silently as an unknown key (current plan) or expose it behind an advanced disclosure?
