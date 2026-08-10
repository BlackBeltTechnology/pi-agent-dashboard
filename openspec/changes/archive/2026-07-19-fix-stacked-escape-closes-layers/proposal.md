## Why

Pressing **Escape** while a full-screen overlay is stacked on top of another dismissible surface closes **both** layers at once. Reported case: open the OpenSpec **Explore dialog**, click a pasted-image thumbnail to open the image lightbox, press Escape — the lightbox *and* the Explore dialog both close, dumping the user out of a dialog they never asked to leave.

Root cause is an event-propagation defect, not a dialog bug. Multiple components attach **global** `keydown` → close listeners on `document`/`window` with **no propagation guard and no "topmost layer only" arbitration**:

- `Dialog` (`packages/client-utils/src/Dialog.tsx`) — `window` keydown, `Escape → onClose()`.
- `ImageLightbox` (`packages/client/src/components/preview/ImageLightbox.tsx`) — `document` keydown, `Escape → onClose()`, **no `stopPropagation`**.
- `FilePreviewOverlay` (`packages/client/src/components/preview/FilePreviewOverlay.tsx`) — `document` keydown, same pattern; its own comment even notes "preview opened from a dialog".
- `MermaidBlock` focused mode (`packages/client/src/components/preview/MermaidBlock.tsx`) — `document` keydown, same pattern.

When two such surfaces are stacked, one Escape reaches **every** global listener, so both layers close. The main chat lightbox feels fine only because the chat page has no global Escape-close underneath it; the defect surfaces whenever a top overlay sits over a `Dialog` (or another overlay).

Affected stacking pairs (reproducible double-close):

| Base surface wrongly closed | Top overlay | Trigger |
|---|---|---|
| **ExploreDialog** *(reported)* | ImageLightbox | click pasted-image thumbnail, Escape |
| **PackageReadmeDialog** | ImageLightbox / MermaidBlock | click an image / focus a diagram in README markdown, Escape |
| **WhatsNewDialog** | ImageLightbox / MermaidBlock | same, in changelog markdown |
| **AgentToolRenderer** subagent-detail `Dialog` (flush) | ImageLightbox / FilePreviewOverlay / MermaidBlock | open image / file link / diagram in the subagent timeline, Escape |
| Any `Dialog` hosting a `FileLink` | FilePreviewOverlay | open the preview, Escape → preview **and** dialog close |
| **FilePreviewOverlay** (overlay-on-overlay) | ImageLightbox / MermaidBlock | open a `.md` preview → click an embedded image, Escape |

The last row matters for the fix: both listeners are on `document`, so a bare `stopPropagation()` in the top overlay cannot reliably block the one underneath (same-target listener order is registration-order, and the top overlay is not guaranteed to be registered later). A per-overlay `stopPropagation` patch fixes only the Dialog-underneath cases and leaves overlay-on-overlay broken — plus it re-derives the same guard in every future overlay. The repo already has **~15** ad-hoc global Escape listeners, so a shared primitive is the DRY fix.

**Load-bearing mechanism (why this works without event-phase tricks):** when the participating surfaces all route Escape through **one shared listener** with a LIFO stack, only the topmost registered layer is dismissed — by stack logic, not by out-competing other listeners in the DOM. So the double-close *among migrated surfaces* is eliminated regardless of phase or propagation. Propagation control (`preventDefault` + `stopImmediatePropagation` on consume) is a **secondary, best-effort** courtesy to reduce interference with the still-unmigrated listeners; it is not what makes the core fix correct.

## What Changes

- **Add a shared escape-dismiss stack** (`packages/client-utils/src/escape-stack.ts` + a React hook). A **single module-stable `keydown` listener** (one function reference) maintains a **LIFO stack** of registered dismissible layers and, on Escape, invokes the `onEscape` of **only the topmost** registered layer. Because every participating surface shares this one listener, topmost-only dismissal is enforced by the stack — no cross-listener arbitration is required for the core fix.
- **Attach once, never detach.** The listener is lazily attached on the first registration and then **stays attached for the session** (it early-returns when the stack is empty). Detaching on empty would let another `document` listener slip ahead in registration order during an idle window and permanently sit in front of the stack — so we do not detach.
- **Registration + lifecycle.** `useEscapeDismiss(active, onEscape)`: push on activate, remove on deactivate/unmount. The remove is **order-independent (remove-by-id)** — never `pop()` — so nested and interleaved (non-LIFO) lifecycles are safe. The id is derived from React `useId` (stable across a StrictMode mount→unmount→mount), so the remount's cleanup removes the right entry and the duplicate-guard doesn't drop the live one. `onEscape` is ref-backed (latest callback used without re-registering).
- **Listener phase — bubble on `document`.** Bubble (not capture) so a focused input/typeahead's own Escape handler runs **first** and can opt out (below). On consume the handler calls `preventDefault()` + `stopImmediatePropagation()`. **Honest scope of consume:** this reliably suppresses `window`-level listeners (bubble reaches `window` after `document`) and any `document`-bubble sibling registered *after* the stack; it does **not** suppress a `document` listener registered *before* the stack (DOM fires same-target listeners in registration order). That residual is acceptable because the core fix does not depend on it — it only bounds interference with unmigrated peers. (An earlier draft claimed `window`-bubble "composes with document listeners"; that rationale was inverted and is corrected.)
- **Input opt-out (`defaultPrevented` / `stopPropagation`).** The stack **skips dismissal when `e.defaultPrevented` is true**, so Escape-to-clear on a focused typeahead does not also dismiss the surrounding layer. **Known React interaction (documented constraint):** a child that calls React's synthetic `e.stopPropagation()` on Escape halts the native event at the React root before it reaches `document`, so the shared listener never runs and the layer will not dismiss on that keypress. This is the correct behavior for an **open** combobox/typeahead (Escape closes the child, not the layer). The migration checklist therefore requires: migrated surfaces MUST NOT contain a child that **unconditionally** `stopPropagation`s Escape; children that legitimately consume Escape (open dropdowns) may, and thereby opt out by design.
- **Key-repeat guard.** The handler returns early on `e.repeat`, so holding Escape does not auto-peel multiple layers in one press.
- **Adopt the hook in three portaled surfaces (v1)** that currently self-register a global Escape listener and can stack: `Dialog` (client-utils), `ImageLightbox`, and `FilePreviewOverlay`. Each **deletes** its own `document`/`window` `keydown` Escape effect (does not co-locate it — keeping both would double-dismiss) and calls `useEscapeDismiss`. Backdrop-click dismissal, focus-trap, and all non-Escape keys are unchanged.
- **Eligibility rule — portaled + focus-trapping only (v1).** A surface is stack-eligible only if it renders in a portal and either traps focus or fully covers the viewport, so "topmost registered" reliably equals "visually topmost". `MermaidBlock` focused mode is **inline** (no portal, no backdrop, sibling diagrams focus independently), so LIFO order would track *focus* order, not *z*-order. **MermaidBlock is deferred to a follow-up** and keeps its current behavior in v1; the follow-up handles its double-close with local, focus-scoped Escape handling rather than the modal stack.
- **Fix the FilePreviewOverlay z-index.** A preview opened from a `Dialog` must render **above** it. Current `FilePreviewOverlay` `z-50` is **below** `Dialog` `z-60`; raise the overlay above the dialog layer (verify computed z). This is a real render-order correction, not just Escape.
- **Topmost-only semantics.** With N stack-eligible layers stacked, one Escape dismisses exactly one layer (the top). A second Escape dismisses the next, and so on.
- **No behavior change for a single layer.** A lone Dialog / lightbox / preview still closes on Escape exactly as before.

## Non-goals

- **Not** migrating every one of the ~15 global Escape listeners in the repo. Only the three portaled surfaces in the reported stacking classes are converted in v1. The others (popovers, menus, editor panels, flow dashboards) can adopt the primitive later; this change ships the primitive and proves it on the affected surfaces.
- **MermaidBlock deferred to a follow-up** (inline, not portaled — see Eligibility rule). Its focused-mode double-close is handled later with local focus-scoped Escape handling, not the modal stack.
- **Transitional boundary (explicit, best-effort).** The topmost-only guarantee is complete *among migrated (stack-eligible) surfaces*, enforced by the single shared listener. Interference with **unmigrated** listeners is best-effort only: the consume suppresses `window`-level and after-registered `document`-bubble listeners, but a `document` listener registered before the stack, or a not-yet-migrated overlay sitting **on top** of a migrated one, can still act on the same Escape. This shrinks to zero as remaining listeners adopt the hook; it is called out, not silently assumed.
- **Legitimate global Escape consumers may stop seeing Escape** while a migrated layer is open (analytics, telemetry, an unmigrated command palette at `window` level). Documented best-effort regression, acceptable for v1.
- **Cross-layer focus restoration is not coordinated in v1.** Each surface keeps its own focus handling (Dialog via `useFocusTrap`; the overlays as today). Dismissing the top layer does not guarantee focus returns into the layer beneath beyond each surface's existing behavior. Documented trade-off.
- No change to backdrop-click dismissal, focus-trap behavior, or any non-Escape keybinding.
- No new dependency; the stack is a small in-repo module.
- Out of scope (follow-up): `DialogPortal`'s body-scroll-lock save/restore under non-LIFO unmount of stacked portals — a pre-existing latent bug this change makes more reachable by increasing stacking frequency. Tracked separately.

## Capabilities

### New Capabilities

- `modal-escape-dismiss`: a shared escape-dismiss stack contract — a single global keydown listener dispatches Escape to only the topmost registered dismissible layer; layers register/unregister via a hook with order-independent removal.

### Modified Capabilities

- `dialog-primitive`: the Dismissal requirement gains a topmost-only clause — the dialog's `onClose` fires on Escape **only when it is the topmost registered dismissible layer**, so an overlay opened above it consumes the Escape first.
- `image-lightbox`: the "Close lightbox with Escape key" requirement gains a topmost-only clause — Escape closes the lightbox without also closing any dialog/overlay beneath it.

## Impact

- `packages/client-utils/src/escape-stack.ts` — **new**: module-stable LIFO registry + single lazily-attached `document`-bubble `keydown` listener (consume via `preventDefault` + `stopImmediatePropagation`; `e.repeat` + `e.defaultPrevented` guards); `useEscapeDismiss(active, onEscape)` hook with `useId`-stable id, ref-backed callback, remove-by-id; `__resetEscapeStack()` test-only reset.
- `packages/client-utils/src/Dialog.tsx` — replace the `window` keydown Escape effect with `useEscapeDismiss(open, onClose)`.
- `packages/client/src/components/preview/ImageLightbox.tsx` — replace the `document` keydown Escape branch with `useEscapeDismiss`; keep the backdrop-click listener.
- `packages/client/src/components/preview/FilePreviewOverlay.tsx` — same swap; keep backdrop-click + composer-inset logic. **Raise its z-index above `Dialog`'s `z-60`** (currently `z-50`, which renders a dialog-launched preview *behind* the dialog).
- **Not touched in v1:** `packages/client/src/components/preview/MermaidBlock.tsx` (deferred follow-up).
- Existing tests: `ImageLightbox.test.tsx` (Escape now consumed on `document` bubble — update dispatch/target expectation); add Escape coverage to `FilePreviewOverlay.test.tsx`.
- Directory `AGENTS.md` tree rows for the four source files above — update per the Documentation Update Protocol.

Rollback considerations:

- The hook is additive and backward-compatible: reverting a single call site restores that surface's old self-managed listener. The shared module is inert if unused.

## Discipline Skills

- `doubt-driven-review` — a shared cross-cutting UI primitive replacing self-managed listeners in four surfaces; verify the topmost-only + order-independent-pop invariants before it stands.
- `review-code` — non-trivial shared primitive + four call-site conversions; review the diff before commit.
