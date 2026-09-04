## Why

Every non-`flow-event` custom entry in the chat shares a single on/off switch, `customEntryFallback`. A scan of all
`~/.pi/agent/sessions/**/*.jsonl` found **12 distinct `customType` values across 3901 gated rows**, and the population is
wildly lopsided:

| customType | rows | what it is |
|---|---:|---|
| `om.observations.recorded` | 1417 | memory telemetry |
| `om.reflections.recorded` | 824 | memory telemetry |
| `pi-flows-help` | 818 | flows help card |
| `om.observations.dropped` | 660 | memory telemetry |
| `web-search-results` | 174 | **actual search content** |
| `subagents:record` | 64 | subagent bookkeeping |
| `subagent-notification` | 35 | subagent notice |
| `pi-goal-hermes:*` | 6 | goal plugin |

`om.*` alone is 2901 rows — **74% of everything the switch gates**. A user who wants that noise gone must also destroy
`web-search-results`, which carries real content they asked for. The single switch is therefore unusable in practice:
its two settings are "drowning in memory telemetry" and "losing search results".

The keyspace is also open — third-party extensions invent `customType` values at runtime — so a compile-time enum of
toggles (the shape every other display pref uses) is not available.

## What Changes

- **New user-editable config file** `~/.pi/dashboard/custom-event-groups.json`, alongside the existing
  `config.json` / `preferences.json` / `tool-overrides.json`. It maps `customType` regex patterns to named, toggleable
  groups. Shipped with defaults covering the emitters above; `om.*` defaults to hidden.
- **`DisplayPrefs` gains `customEventGroups: Record<groupId, boolean>`**, shallow-merged field-by-field exactly like
  `toolCalls`. This inherits the existing per-session override machinery, including the "overridden" dot, for free.
- **Both existing surfaces render one row per group** — the global Settings panel and the per-session ChatView menu.
  No new UI surface, no inline click-to-hide affordance.
- **The config file is the discovery source.** This is what makes the global Settings panel workable: it has no session
  and no message stream, so it cannot enumerate custom types by scanning chat. It can read a file.
- **BREAKING (internal pref schema):** `customEntryFallback` is removed and becomes the catch-all `other` group's
  toggle. A one-shot migration maps a persisted `customEntryFallback: false` to `customEventGroups.other = false`, both
  globally and in every per-session override. Without it, every user who had already hidden custom cards gets them back
  on upgrade.
- **Unmatched types fall into `other`,** preserving today's behavior for any emitter no rule covers.
- `customType: "flow-event"` keeps its existing hard-coded exemption and is never claimed by a group.

Non-goals: no per-`customType` toggles, no server-side registry of types-ever-seen, no UI for editing the groups file
(hand-edited, like its siblings), no change to how custom entries are transported, reduced, or persisted.

## Capabilities

### New Capabilities
- `custom-event-groups`: the groups config file — schema, shipped defaults, load/validate/fail-open behavior,
  first-match-wins resolution of `customType` → `groupId`, and merge-on-upgrade semantics for newly shipped groups.

### Modified Capabilities
- `chat-display-preferences`: `DisplayPrefs` gains `customEventGroups` with shallow-merge semantics; `customEntryFallback`
  is removed; a one-shot migration maps the old field onto the `other` group.
- `custom-entry-rendering`: the render gate changes from the single `customEntryFallback` boolean to a per-group lookup
  keyed on the row's `customType`.

## Impact

**Code**
- `packages/shared/src/display-prefs.ts` — schema, presets, `mergeDisplayPrefs`, defaults
- `packages/server/src/routes/preferences-display-routes.ts` — PATCH deep-merge arm for `customEventGroups`
- server config loading — new file read, validation, defaults seeding, merge-on-upgrade
- `packages/client/src/components/chat/ChatView.tsx` — the two gate sites (`isRowVisible`, render branch)
- `packages/client/src/components/chat/ChatViewMenu.tsx` — per-session rows
- `packages/client/src/components/settings/SettingsPanel.tsx` — global rows
- `packages/client/src/components/settings/FirstLaunchDisplayModal.tsx` — presets must carry the new field

**Risk surface**
- User-authored regexes execute in the render path (`isRowVisible` runs per row per re-render). Requires a memoized
  `customType → groupId` map and a ReDoS guard; the observed keyspace is 12 values, so memoization is fully effective.
- A malformed or unparseable config file must fail open (all groups visible) rather than blanking the chat.

**Docs**
- `docs/architecture.md` config reference gains the new file
- `~/.pi/dashboard/` file inventory wherever it is enumerated

## Discipline Skills

- `security-hardening` — the config file is untrusted input executed as regex in a hot render path (ReDoS,
  catastrophic backtracking, malformed-JSON handling).
- `performance-optimization` — `isRowVisible` is called per row per re-render; the memoization is load-bearing, not
  decorative, and needs measuring rather than assuming.
- `doubt-driven-review` — the `customEntryFallback` removal plus pref migration is effectively irreversible for users'
  persisted state; worth stress-testing before it lands.
- `review-code` — non-trivial change spanning shared/server/client, reviewed before commit.
