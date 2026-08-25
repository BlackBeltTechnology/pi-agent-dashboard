## Why

Issue #468 reports that the dashboard chat "does not transfer all the info the primary UI does". Two of the three concrete gaps are cheap, independent, and do not need the native-TUI work:

1. **Reasoning is trapped in a nested scrollbox.** `ThinkingBlock` hard-caps its body at `max-h-[400px] overflow-y-auto`, so a long reasoning block becomes its own scroll region instead of flowing down the chat. A reader who wants to follow along mid-turn (to steer) must scroll a box inside a scrolling transcript. There is no setting for this.
2. **Extension custom entries are silently dropped.** The only `customType` the bridge/replay path understands is our own `flow-event` (`packages/shared/src/state-replay.ts`). Anything an extension emits via `pi.sendMessage({ customType })` or `pi.appendEntry()` + `pi.registerEntryRenderer()` renders as nothing at all — the reporter is building an extension whose chat output vanishes in the dashboard.

Faithful rendering of a third-party entry renderer is impossible in the web UI (renderers are pi-TUI components emitting ANSI lines); that is what `add-native-pi-tui-view` addresses. This change closes the "renders as literally nothing" hole with a visible, honest fallback, and unblocks reading reasoning inline.

## What Changes

- **Inline reasoning flow.** New display preference `reasoningInlineFlow` (default `false` — today's behavior). When `true`, the reasoning body renders with no height cap and no inner scrollbar, flowing down the chat transcript like any other row. Interaction with the existing collapse controls (`reasoningAutoCollapseMs`, `keepReasoningOpenUntilTurnEnds`) is unchanged: the pref governs the body's HEIGHT, never its open/closed state.
- **Custom-entry passthrough.** Unknown `customType` entries reach the chat as a first-class row instead of being dropped. Rendering is a bounded, generic fallback: the `customType` as a label plus a text/JSON rendering of the payload, using the same truncation ceilings the event store already enforces. `display: false` messages stay invisible (they are LLM-context-only by contract). `flow-event` keeps its existing dedicated rendering.
- **Settings controls.** One control for `reasoningInlineFlow` and one for the custom-entry fallback (`customEntryFallback`, default `true`), both in the existing View settings section, both honoring the global + per-session override plumbing.
- **Discoverability follow-through.** The reporter could not find the reasoning controls because `reasoning` is off in the `simple`/`standard` presets. The View section SHALL group the reasoning controls together so the sub-controls are visible (disabled) rather than absent when `reasoning` is off.
- Not in scope: faithful re-rendering of a TUI entry renderer, ANSI interpretation, or any interactivity in a custom row.

## Capabilities

### New Capabilities
- `custom-entry-rendering`: how non-`flow-event` `customType` entries travel from the bridge to a bounded generic chat row, including the `display: false` exclusion, truncation ceilings, and replay behavior.

### Modified Capabilities
- `reasoning-display`: adds the inline-flow (uncapped height) rendering mode and states that it is orthogonal to the collapse-timer requirements.
- `chat-display-preferences`: adds `reasoningInlineFlow` and `customEntryFallback` to `DisplayPrefs`, the three presets, and `mergeDisplayPrefs`.
- `settings-panel`: adds the two controls and the "sub-controls visible-but-disabled" rule for the reasoning group.

## Impact

- `packages/shared/src/display-prefs.ts` — two new fields, preset defaults, merge arms.
- `packages/shared/src/state-replay.ts` — stop discarding non-`flow-event` custom entries.
- `packages/extension/src/` — forward custom entries the bridge currently does not emit.
- `packages/client/src/components/chat/ThinkingBlock.tsx` — conditional height cap.
- `packages/client/src/components/chat/` — new generic custom-entry row renderer.
- `packages/client/src/components/settings/SettingsPanel.tsx` — two controls + grouping.
- Persistence: `~/.pi/dashboard/preferences.json#displayPrefs` and `<session>.meta.json#displayPrefsOverride` gain two optional fields. Both are additive; older values load unchanged.
- No API break. No server-side read surface added: the custom payload is already inside the event stream.

## Discipline Skills

- `review-code` — non-trivial multi-package change; run before commit once tests are green.
- `security-hardening` — the custom-entry payload is **untrusted extension-authored input** now reaching the DOM. Escaping, truncation ceilings, and the `display: false` exclusion are the hardening surface.
- `performance-optimization` — removing the reasoning height cap changes the virtualized transcript's row-measurement profile; a very long reasoning block must not regress scroll cost. Measure before and after against `chat-transcript-virtualization` / `chat-idle-render-cost`.
