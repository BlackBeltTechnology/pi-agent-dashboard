## Why

The composer's model dropdown renders **underneath** the composer context strip: opened upward, its top rows are occluded by the toolbar above it, making the first entries unclickable and unreadable. The panel is an inline `absolute … z-50` child of the composer, so it is trapped in an ancestor stacking context and no `z-index` value can lift it out.

This is the same defect already diagnosed and fixed once in this codebase — `FolderActionsMenu` underlapped because each `SessionCard` carries `isolate`. That fix established the pattern (`LayerPortal` + `fixed` panel positioned from `usePopoverFlip`'s `triggerRect`, carrying the `z-popover` token) and `usePopoverFlip` already returns `triggerRect` specifically so portaled consumers can use it. The composer selectors were simply never migrated.

## What Changes

- **`ModelSelector`** — the open panel moves from an inline `absolute z-50` div to a `LayerPortal`-portaled `fixed` panel carrying the `z-popover` layer token, positioned from `usePopoverFlip`'s `triggerRect` / `flipUp` / `anchorRight`. Existing `boundaryRef` pane-clamping, `width: min(320, maxWidth)`, `maxHeight` and `minHeight` behaviour is preserved exactly.
- **`ModelSelector` outside-click dismissal** — the `mousedown` handler currently closes when the event target is outside `containerRef`. Once the panel is portaled out of `containerRef`, every click *inside* the dropdown would count as outside and close it instantly. The handler must treat the trigger container **or** the portaled panel as "inside".
- **`ThinkingLevelSelector`** — same migration. It is the adjacent control in the same toolbar, shares the same `boundaryRef` wiring and the same inline-absolute construction, and therefore carries the identical latent bug.
- **Layer-scale conformance** — both panels stop using raw `z-*` values and reference the named `z-popover` utility, per the rule stated in `packages/client/src/index.css` and the `overlay-layering` spec.

## Capabilities

**None — `skip_specs: true`.** No spec-level behavior changes, so no delta is written.

The `overlay-layering` spec **already requires** exactly what this change does. Its requirement *"Box-escaping overlays SHALL portal to a top-level layer root"* covers any "menu, popover, dropdown" and states the mechanism verbatim: an inline absolutely-positioned overlay "is trapped inside whatever stacking context an ancestor establishes… Portaling to the layer root removes the overlay from those ancestor contexts, which is what actually prevents underlap."

These two popovers are not out of scope — they are **tolerated pre-existing violations** on the frozen migration backlog the same requirement defines:

> A finite, enumerated set of PRE-EXISTING inline-`absolute` popovers MAY remain inline until migrated — that set is the frozen lint allowlist and SHALL only shrink, never grow. The allowlist is the migration backlog, not a permanent carve-out.

That allowlist is `scripts/z-layer-baseline.json` (35 entries), enforced by `scripts/z-layer-lint.mjs`. Both files are on it:

```
packages/client/src/components/settings/ModelSelector.tsx|z-50           1
packages/client/src/components/settings/ThinkingLevelSelector.tsx|z-50   1
```

This change deletes those two entries. That is the already-specified scenario *"The pre-existing inline-popover allowlist is finite and only shrinks"* → *"removing an entry (by portaling that popover) is allowed"*. Likewise `popover-viewport-positioning` already specifies `triggerRect` for portaled consumers. Writing a delta here would mean inventing a requirement solely to satisfy validation.

## Impact

**Code**
- `packages/client/src/components/settings/ModelSelector.tsx`
- `packages/client/src/components/settings/ThinkingLevelSelector.tsx`

**Lint baseline** — `scripts/z-layer-baseline.json` loses its two `settings/` entries. The ratchet then becomes the regression test: re-introducing an inline `z-50` in either file fails CI.

**Dependencies** — no new ones. `LayerPortal` is already consumed from `@blackbelt-technology/pi-dashboard-client-utils/LayerPortal`; `usePopoverFlip` already returns `triggerRect`.

**Tests** — portaling moves the panel to a different DOM subtree. Existing unit tests that scope queries to the component container (rather than `screen`) will need re-scoping. Both components are re-mounted by `components/openspec/useOpenSpecRunConfigRow.tsx` (OpenSpec launch dialogs), which must be verified to still position correctly inside a dialog.

## Non-goals

- **`CommandInput`'s three popovers** (composer command/mention dropdown, attach `＋` menu, overflow menu — raw `z-10`/`z-20`). They share the raw-z smell but are wide `left-3 right-3` panels whose positioning change is materially larger, and none are reported broken. Deliberately deferred.
- **A mobile bottom-sheet form** for either selector (the `useMobile()` → `DialogPortal` branch `FolderActionsMenu` has). Out of scope; desktop popover form only.
- **Extracting a shared portaled-popover component.** Two call sites follow an existing third; premature to abstract.

## Discipline Skills

- `review-code` — non-trivial multi-component change; run the inline review→fix loop before commit.
- `systematic-debugging` — if the underlap does not resolve after portaling, root-cause the actual stacking/clipping ancestor with evidence rather than trying further `z` values.

Not applicable: `security-hardening` (no auth/untrusted input/secrets), `performance-optimization` (no latency budget; the positioning path is already reflow-free by contract), `observability-instrumentation` (no new endpoint, job, or external call).
