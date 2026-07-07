## Context

`group-tool-bursts.ts` forms a burst only at ≥3 tool-like members; `ToolBurstGroup.tsx` renders a plain text header and demotes absorbed reasoning to grey narration. Sub-threshold runs render as bare rows, so the timeline mixes framed groups and loose rows. The running header has no motion; the done header is a terse count.

## Goals

- Every consecutive tool run → one unified framed group (single or multi).
- Reasoning renders identically inside and outside the group.
- Running group is visibly alive (indeterminate motion, honest — no fake %).
- Done group tells the story: which tools, how long, what failed.
- Cheap animations, reduced-motion honoured, no scroll jump.

## Formation: threshold 1 + turn-scoped (leading + trailing) absorption

`groupToolBursts`: change the gate from `members >= 3` to `members >= 1`. The group window absorbs transparents on BOTH sides of the tool run: extend the START backward across leading transparents to the previous HARD row, and `end` forward across trailing transparents to the next HARD row. Because threshold is now 1, the "emit verbatim" else-branch effectively disappears for tool runs — every run wraps, and the whole turn (opening reasoning → tools → concluding reasoning) folds into one group.

```
before:  💭  [🔧 🔧 🔧]  💭 💭  user      leading + trailing reasoning leak out
after:   [💭  🔧 🔧 🔧  💭 💭]  user      whole turn folds — all reasoning inside
after:   [🔧]  user                          single call → framed one-liner
```

Implementation note: leading absorption walks backward from the first tool-like member; the previous HARD row (the `user` prompt or a prior turn's `assistant` reply) is the stop. `user`/non-empty-`assistant` always sit between turns, so a group can never swallow the previous turn's reply.

## Header content matrix

| State | Left | Title | Meta | Motion |
|---|---|---|---|---|
| running | pulsing spinner | `Working` | `N done` + live command | shimmer sweep + spinner pulse |
| done · 1 member | ✓ + tool icon | member summary | duration | completion flash once |
| done · N members | ✓ | `N tool calls` | icon breakdown `🔍3 · 📄5 · ⎇1` + duration + `N failed?` | completion flash once |

`tool-summary.ts` already yields the one-line summary (reused for single-member header + live command). Add a small `toolName → icon` map (mdi paths) for the breakdown chips; unknown kinds fall back to a generic tool glyph.

## `toolGroupDefaultCollapsed` preference

Add one boolean to `DisplayPrefs` (default `false`), wired through `DISPLAY_PRESETS`, `mergeDisplayPrefs`, and TWO UI surfaces — same plumbing every existing pref uses:
- **Global default** — a `ToggleField` in `SettingsPanel`'s chat-display section (beside `reasoning` / `keepReasoningOpenUntilTurnEnds`), saved to `preferences.json#displayPrefs` via the Unified-Save draft registry. Inherited by all sessions.
- **Per-session override** — a row in the `ChatViewMenu` View popover, saved to `<session>.meta.json#displayPrefsOverride`. Beats the global default; `modified` pill when set.

Effective value = `mergeDisplayPrefs(global, override)` (unchanged merge path). `ToolBurstGroup` changes one line:

```ts
const autoOpen = prefs.toolGroupDefaultCollapsed ? false : isRunning;
const expanded = override ?? autoOpen;   // manual override still wins
```

The running header + animation are UNAFFECTED (they key off `isRunning`, not `expanded`); only the body's default open state changes. This is why the pref reads as "start the body closed" rather than "hide liveness". Reasoning blocks and the `×N` `CollapsedToolGroup` are untouched — they own their own collapse rules.

## Animation plan (GPU-cheap, honest, reduced-motion-safe)

- **Shimmer**: a `background: linear-gradient(...)` sweep on the header via `@keyframes` translating a masked highlight — `transform`/`background-position` only. Indeterminate; no width bound to progress (honesty rule).
- **Spinner pulse**: existing `mdiLoading` spin + a subtle opacity pulse.
- **Completion flash**: on running→done flip, a one-shot `opacity`/`scale` cue on the check glyph (150–200ms), then settle.
- **Expand/collapse**: `opacity` + a brief transition; the group body grows in document flow (NO fixed `max-height`, NO inner `overflow-y`). The chat container already sets `overflow-anchor:auto` so a collapse shrink doesn't jump scroll. Removing the inner scrollbox means a long expanded group extends the page and scrolls with the timeline — no nested scroll trap on desktop or touch.
- **`@media (prefers-reduced-motion: reduce)`** disables shimmer, pulse, and flash; static text/icons remain.

## Frame unification

Collapse the four render paths (running/done × single/multi) into one `<GroupFrame>` with slots: `{ leftGlyph, title, meta, motionClass, chevron, body }`. Running sets `motionClass`; done clears it. Single vs multi differ only in title/meta content. This is the `code-simplification` win — one frame, data-driven, not four branches.

## Alternatives considered

- **Keep leading reasoning at top level (interior/trailing only)**: initial design; superseded by explicit user decision to fold the full turn. Trade-off accepted: the opening plan reasoning now lives one click inside the group header instead of visible above it.
- **Keep ≥3 threshold, only style single rows like a group**: rejected — two code paths for the same visual; drift risk.
- **Auto-collapse single-member done groups behind a header that says "1 tool call"**: rejected — hides the one call and reads worse than showing its summary inline in the header.
- **Determinate progress bar while running**: rejected — violates the existing honesty rule (no fabricated total; a turn's tool count is unknown mid-run).

## Risks

- Threshold 1 means a lone `ask_user` or single `Read` now wraps. Mitigate: single-member collapsed header shows the real summary, so it costs no information and one line of height.
- Streaming timeline + animations: keep to transform/opacity, avoid animating `height` of the whole list; only the group's own body transitions.
- Reduced-motion must be honoured or it's an a11y regression — covered by a dedicated scenario.

## Migration

None. Display-only; no persisted shape, protocol, or event-reducer change. Existing group tests that assert the ≥3 threshold and the plain done header MUST be updated to the new matrix.
