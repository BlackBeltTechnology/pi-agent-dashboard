# UI plan — fix-chat-burst-tool-stop

Ground: `ToolBurstGroup.tsx` (`GroupFrame`, `headerSlots`), `ToolCallStep.tsx` (stop spans), `CommandInput.tsx` (morphing stop button), tokens `packages/client/src/index.css`, contract `ui-contract.md`.

## Surfaces

| Surface | Where | Today | After |
|---|---|---|---|
| Burst header stop | `GroupFrame` header row, sibling AFTER the toggle button (chevron stays inside toggle) | none | shared-state control, always visible while running |
| Running row stop | `ToolCallStep` header row inside burst body, sibling after toggle | never mounts | renders burst's shared controller |
| Standalone row stop | `ToolCallStep` outside a burst | `<span role=button>` inside `<button>` | same component as above, own controller |

## States → tokens

| State | Shape (1.4.1) | Label (variant B) | fg | bg (hover/rest) | border | Motion |
|---|---|---|---|---|---|---|
| idle — Stop | ■ `mdiStop` | `Stop` | `--severity-error-fg` | transparent / `--severity-error-bg` | `--severity-error-border` (variant B) | none |
| arming (≤600 ms after Stop) | ⌛ `mdiTimerSand` | `Stopping…` | `--text-tertiary` | `--bg-tertiary` | `--border-secondary` | none; `disabled` |
| aborting — Force stop | ▲ `mdiAlert` | `Force stop` | `--severity-warning-fg` | `--severity-warning-bg` | `--severity-warning-border` | `animate-pulse`, off under reduced motion |
| killing | ⟳ `mdiLoading` | `Killing…` | `--text-tertiary` | `--bg-tertiary` | `--border-secondary` | spin, static under reduced motion; `disabled` |
| done | control removed | — | — | — | — | header `tool-group-flash` (existing) |

Severity tokens replace today's raw `text-red-400` / `text-orange-400` literals → removes the `severity-exempt` carve-out instead of relocating it (ui-contract: "a new surface uses a *severity* token").

## Sizing

| Viewport | Hit box | Glyph | Rule |
|---|---|---|---|
| desktop | `min-h-6 min-w-6` (24 px) | `0.55` | WCAG 2.2 SC 2.5.8 target ≥ 24×24 |
| mobile (`useMobile`) | `min-h-[44px] min-w-[44px]` | `0.7` | ui-contract a11y #2 / Fitts's Law, primary action ≥ 44 |

Focus: `focus-ring` utility (`--focus-ring`), rounded-md.

## Decisions (cited)

1. **Stop outside the toggle, at the row's trailing edge** — one element = one action; nested interactive content is invalid (HTML spec, button content model) and caused mis-toggles. Consistency (Nielsen H4): same trailing position in header and rows, and the composer's stop is also trailing.
2. **Variant B (icon + short label) for the burst header; icon-only for rows.** Recognition over recall (H6) + NN/g "icon usability": a bare ■ is ambiguous (stop? checkbox?). Rows sit under a labelled header, so icon-only there avoids repetition (H8 minimalist). **Mobile: header is icon-only too** — at 375 px a 107 px labelled control truncated the live command to `$ …` (H1: the running command is the status); the per-state shape change + `aria-label` still carry the state.
3. **600 ms arming window before Force stop accepts clicks.** Error prevention (H5): Force stop appears exactly under the pointer, so the second click of an accidental double-click would SIGKILL the session. Arming shows `Stopping…` (H1 visibility of status) and makes the escalation deliberate. Cheaper than the `play-stop-controls` 3 s grace; still an intentional divergence.
4. **Shape per state** (■ / ⌛ / ▲ / ⟳; triangle = today's `ToolCallStep` force-stop glyph, octagon collapses to a dot at 13 px) plus label/aria-label — WCAG 1.4.1, state never carried by colour alone.
5. **Shared state visible in both places** — header and running row change together, so the session-wide effect of Stop is visible (H1, H2 match between system and real world: one turn, one stop).
