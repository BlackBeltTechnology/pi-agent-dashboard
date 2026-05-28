## Context

Chat view today renders every signal pi emits — reasoning, tool calls, tool results, token stats, context bar — with one existing escape hatch (`show-debug-tools` localStorage). That toggle proves the demand but doesn't scale: each new noisy surface needs its own ad-hoc flag.

Decisions converged in explore:

- **Granularity**: per-element toggles. No "Simple / Standard / Developer" preset in Settings (presets only appear in the one-shot first-launch modal).
- **Tool calls**: split by type (read / bash / edit / agent / generic). `askUser` is non-hideable.
- **Tool results**: single boolean. Errors hide too — user explicitly accepted the silent-failure risk.
- **Storage**: server-side. Global in `preferences.json`, per-session sparse override in `.meta.json`.
- **Surfaces**: Settings ▸ General ▸ Display (global). Discord-style inline "⚙ View ▾" popover (per-session). First-launch modal seeds global once.
- **Default**: first-launch modal forces a choice; no default-while-unanswered policy needed.

## Schema

```ts
// packages/shared/src/display-prefs.ts (new)
export interface DisplayPrefs {
  tokenStatsBar: boolean;
  contextUsageBar: boolean;
  reasoning: boolean;
  toolResults: boolean;
  turnMetadata: boolean;
  debugTools: boolean;
  toolCalls: {
    read: boolean;
    bash: boolean;
    edit: boolean;    // includes Write
    agent: boolean;
    generic: boolean; // catch-all renderer
  };
}

export const DISPLAY_PRESETS = {
  simple:    { tokenStatsBar:false, contextUsageBar:false, reasoning:false, toolResults:false,
               turnMetadata:false, debugTools:false,
               toolCalls:{ read:false, bash:false, edit:true, agent:true, generic:false } },
  standard:  { tokenStatsBar:true, contextUsageBar:true, reasoning:false, toolResults:true,
               turnMetadata:true, debugTools:false,
               toolCalls:{ read:true, bash:true, edit:true, agent:true, generic:true } },
  everything:{ tokenStatsBar:true, contextUsageBar:true, reasoning:true, toolResults:true,
               turnMetadata:true, debugTools:true,
               toolCalls:{ read:true, bash:true, edit:true, agent:true, generic:true } },
} as const satisfies Record<string, DisplayPrefs>;
```

Per-session override is `Partial<DisplayPrefs>` (sparse, deep-merged for `toolCalls`).

## Merge rule

```
effective(global, override) =
  for each top-level key K in DisplayPrefs:
    if K === "toolCalls":
      effective.toolCalls = { ...global.toolCalls, ...(override.toolCalls ?? {}) }
    else:
      effective[K] = override[K] ?? global[K]
```

Clearing a session override = setting `displayPrefsOverride = undefined` in `.meta.json`.

## Transport

- REST: `GET /api/preferences/display` → `DisplayPrefs`. `PATCH /api/preferences/display` body `Partial<DisplayPrefs>` (deep-merged for `toolCalls`).
- WS server→browser: `display_prefs_updated { prefs: DisplayPrefs }` broadcast to all sockets on global change.
- WS browser→server: `setSessionDisplayPrefs { sessionId, override: Partial<DisplayPrefs> | null }`. `null` clears.
- WS server→browser: existing session-update push already carries `SessionMeta`; the override rides on it (no new field needed at the wire level beyond extending `SessionMeta`).

## Client wiring

- New hook `useDisplayPrefs(sessionId?)` — subscribes to global prefs (Zustand store slice) + the session's `displayPrefsOverride`, returns memoized `EffectiveDisplayPrefs`. Single source of truth — every gated component reads from this hook, never from props or stores directly.
- `useDebugToolsVisible` deprecated → re-export that returns `prefs.debugTools` for one release, then removed.
- First-launch detection: `displayPrefs === undefined` in the server response = "never seeded." Client shows modal, on submit PATCHes with chosen preset. On dismissal (Esc / outside-click), default to `standard`.

## Migration

One-shot on first client load after upgrade:

```
if (localStorage["show-debug-tools"] is set) {
  PATCH /api/preferences/display { debugTools: <localStorage value> }
  localStorage.removeItem("show-debug-tools")
}
```

Idempotent — re-running is a no-op once the key is gone.

## Non-hidable elements

`askUser` tool calls are always rendered, ignoring `toolCalls.generic` and any other toggle. Implemented in `ToolCallStep` / `CollapsedToolGroup` by short-circuiting the gate when `tool.name === "ask_user"`. Same applies to inline ask_user dialogs spawned by the bridge default adapter.

User explicitly accepted that tool errors hide when `toolResults: false`. No error carve-out in v1. If we later see users confused by silent failures, add `toolErrors: boolean` (default true) — additive, non-breaking.

## Alternatives considered

- **Presets in Settings.** Rejected — 7 toggles do not produce decision fatigue; presets only complicate the mental model. First-launch modal still uses presets because it's a one-shot.
- **localStorage like `show-debug-tools`.** Rejected — user wants prefs to follow them across devices; per-session override has no localStorage equivalent.
- **Render-then-CSS-hide.** Rejected — reasoning/tool-result bodies can be megabytes of markdown. Hiding via `display:none` still costs parse + render. Conditional render is honest.
- **Per-tool granularity below "edit" (Write vs MultiEdit vs Edit).** Rejected — three flags for one mental category. Group under `edit`.

## Risks

- **Silent ask-user stall** — mitigated by hard-coded non-hidability.
- **Tool-result errors hide** — accepted; documented as v1 limitation.
- **Override-then-forget**: user sets per-session override, comes back days later confused why "Reasoning" is off here but on globally. Mitigation: when an override exists, the ChatView toolbar shows a subtle "view modified" pill that opens the popover.
- **WS broadcast storm**: prefs change → every browser re-renders. Cheap (one message, small payload, infrequent). No throttling needed.
