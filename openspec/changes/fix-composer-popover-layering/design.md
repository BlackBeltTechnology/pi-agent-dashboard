# Design

## Context

The composer's model dropdown paints *behind* the composer context strip above it. The panel is an inline `absolute … z-50` child of the composer, so raising the number cannot help: a `z-index` only orders siblings **within the nearest ancestor stacking context**, and the panel is trapped in one.

This defect class is solved in this repo. `FolderActionsMenu` underlapped `SessionCard` (which sets `isolate`) and was fixed by portaling. `LayerPortal`'s own doc comment names the rule — *"portal-or-perish"* — and `usePopoverFlip` already returns `triggerRect` explicitly so a portaled consumer can position a `fixed` panel. This change applies that shipped pattern to the two `settings/` selectors; it invents nothing.

## Goals / Non-Goals

**Goals**
- Model dropdown paints above all composer chrome, in both flip directions.
- `ThinkingLevelSelector` gets the same treatment (same toolbar, same construction, same latent bug).
- `scripts/z-layer-baseline.json` shrinks by exactly 2 entries.
- No change to pane-clamped sizing, flip behaviour, keyboard nav, or focus restore.

**Non-Goals**
- `CommandInput`'s three popovers — still on the allowlist, deliberately deferred.
- A mobile bottom-sheet form (`useMobile()` → `DialogPortal`) for either selector. Desktop popover form only; these live in a desktop composer toolbar.
- Extracting a shared portaled-popover component from three call sites.

## Decision 1 — Portal, don't renumber

| Option | Verdict |
|---|---|
| Raise `z-50` → `z-[9999]` | **Rejected.** Does nothing across a stacking-context boundary; this is the exact anti-pattern the spec's requirement text calls out. |
| Remove the ancestor's stacking context | **Rejected.** The context is load-bearing chrome; unclear blast radius, and the panel would still be clipped by any `overflow` ancestor. |
| **Portal to the layer root + `fixed`** | **Chosen.** Escapes *every* ancestor context and every `overflow` clip at once. Already shipped for `FolderActionsMenu`. |

Portaling also fixes clipping, which renumbering cannot — the screenshot's clean horizontal cut at the toolbar's border is consistent with an `overflow` clip, not only paint order. One mechanism covers both candidate causes.

## Decision 2 — Positioning

Copy `FolderActionsMenu`'s `desktopStyle` shape exactly (`FolderActionsMenu.tsx:126-143`), including its two non-obvious details:

- `GAP = 4` replaces the `mt-1` / `mb-1` the inline form used — a portaled `fixed` panel has no flow sibling to get margin from.
- `visibility: triggerRect ? "visible" : "hidden"` — `triggerRect` is `null` on first render, so without this the panel flashes at `(0,0)` before the first measure lands.

Flip/anchor semantics are unchanged; only how the decision is *applied* changes:

| | Inline (before) | Portaled (after) |
|---|---|---|
| `flipUp` | `bottom-full mb-1` | `bottom: innerHeight - triggerRect.top + GAP` |
| else | `top-full mt-1` | `top: triggerRect.bottom + GAP` |
| `anchorRight` | `right-0` | `right: innerWidth - triggerRect.right` |
| else | `left-0` | `left: triggerRect.left` |

`boundaryRef` (`usePopoverBoundary()`) stays wired as-is — the hook keeps clamping `maxHeight`/`maxWidth` to the chat pane, so pane-aware sizing survives portaling. `ModelSelector` keeps `width: Math.min(320, maxWidth)`; `ThinkingLevelSelector` keeps its fixed `w-32` and does not destructure `maxWidth`.

`z-50` → the `z-popover` token, per the layer scale.

## Decision 3 — The outside-click trap

`ModelSelector.tsx:452` and `ThinkingLevelSelector.tsx:48` both close on:

```js
if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
```

Once portaled, the panel is **no longer a DOM descendant of `containerRef`** — so every click inside the dropdown reads as "outside" and the panel closes before any selection registers. The fix is non-optional; without it the feature is unusable.

Adopt `FolderActionsMenu.tsx:155-166`: add a `panelRef`, and treat *either* node as inside.

```js
if (panelRef.current?.contains(target)) return;
if (triggerRef.current?.contains(target)) return;
onOpenChange(false);
```

Two notes: check `panelRef` **before** `triggerRef` (the trigger toggles, so letting a panel click fall through to it would close-then-reopen), and the reference adds `touchstart` alongside `mousedown`.

## Risks

| Risk | Mitigation |
|---|---|
| **Existing tests break.** `ThinkingLevelSelector.test.tsx` scopes every assertion to `container.querySelector('[data-testid="thinking-level-dropdown"]')`. A portal renders to `document.body`, *outside* `container` — these go null. | Expected and diagnostic, not incidental: a red test here proves the portal works. Re-scope to `screen` / `baseElement`. Confirmed at `ThinkingLevelSelector.test.tsx:16,27,35,45`. |
| **OpenSpec dialogs re-mount both selectors** (`components/openspec/useOpenSpecRunConfigRow.tsx`). A popover portaled to `body` must still sit above a dialog that is itself portaled. | `z-popover` (40) is *below* `z-dialog` (50) on the scale — verify the dropdown is not occluded by its own host dialog. Covered by `OpenSpecRunConfig.test.tsx` plus a manual check. |
| Panel detaches from trigger on scroll. | `usePopoverFlip` already re-measures on scroll/resize (capture-phase) — the behaviour the spec's trigger-rect scenario requires. No new work; verify. |

## Verification

1. `z-layer-lint.mjs` passes with the 2 baseline entries deleted (proves no raw `z-` remains in either file).
2. Unit tests green after re-scoping.
3. Manual, at the reported breakpoint: open the model dropdown upward in the composer — no occlusion, no clipping, first row clickable; repeat for the thinking-level selector and inside an OpenSpec run-config dialog.
