# Test Plan — fix-stacked-escape-closes-layers

Stage: proposal   Generated: 2026-07-20

All scenarios are deterministic client-side DOM behavior (no server, no
WebSocket, no layout) → routed to **L1** (vitest + jsdom, component-render where a
surface is involved). Existing exemplars: `packages/client-utils/src/__tests__/Dialog.test.tsx`,
`packages/client/src/components/__tests__/ImageLightbox.test.tsx`,
`packages/client/src/components/__tests__/Dialogs.test.tsx`.

No clarifications outstanding: every Triple slot is fillable from the corrected
proposal + spec deltas. The one product question (Escape while focus is in a
Dialog's plain textarea) is resolved as **parity with pre-fix behavior** — the
dialog still closes — and is asserted, not left open.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Topmost-only dismissal | state-transition | L1 | automated | layers A then B registered (B top) | one `Escape` keydown | `B.onEscape` called exactly once; `A.onEscape` not called |
| E2 | Successive peel | state-transition | L1 | automated | layers A, B, C registered (C top) | three `Escape` keydowns | dismiss order is C, B, A; each `onEscape` fires once |
| E3 | Lone layer still dismisses | EP | L1 | automated | single layer A registered | one `Escape` | `A.onEscape` called once |
| E4 | Order-independent unregister | state-transition | L1 | automated | A, B registered; A removed **by id** | one `Escape` | `B.onEscape` called; `A.onEscape` not; no stale A entry remains |
| E5 | Empty stack passes through | boundary | L1 | automated | no layers registered; spy `window` keydown listener attached | one `Escape` | spy fires; stack calls neither `preventDefault` nor any `onEscape` |
| E6 | Consume blocks window listener | decision-table | L1 | automated | layer A registered; spy `window` keydown listener attached | one `Escape` | `A.onEscape` called; window spy does **not** fire; `preventDefault`+`stopImmediatePropagation` invoked |
| E7 | Key-repeat guard | BVA | L1 | automated | layers A, B registered | `Escape` keydown with `repeat:true`, then one with `repeat:false` | repeat event dismisses nothing; the non-repeat event dismisses B only |
| E8 | defaultPrevented opt-out | decision-table | L1 | automated | layer A registered | `Escape` whose `defaultPrevented` is already true | `A.onEscape` **not** called; A stays registered |
| E9 | StrictMode id stability | state-transition | L1 | automated | `useEscapeDismiss` mounted under StrictMode (mount→unmount→mount) | one `Escape` | exactly one entry; `onEscape` fires once; no leak, no drop |
| E10 | Attach-once / never-detach / no leak | state-transition | L1 | automated | `addEventListener` spy; register→unregister all→register again | inspect listener count | document keydown listener attaches once, count stays 1 across empty→refill, never duplicated |
| E11 | Latest handler without re-registration | state-transition | L1 | automated | layer A registered with `cb1`, re-render same id with `cb2` | one `Escape` | `cb2` called, `cb1` not; still a single stack entry |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | image-lightbox: Escape doesn't close underlying dialog (reported) | state-transition | L1 | automated | a `Dialog` rendering `ImagePreviewStrip`; click a thumbnail to open `ImageLightbox` | one `Escape`, then a second | first Escape: lightbox unmounts, dialog still mounted; second Escape: dialog `onClose` fires |
| F2 | dialog-primitive: markdown-dialog + lightbox (PackageReadme/WhatsNew class) | state-transition | L1 | automated | a `Dialog` rendering `MarkdownContent` with an `<img>`; click image → lightbox | one `Escape` | lightbox unmounts; dialog stays open |
| F3 | Consume: overlay-on-overlay peels one | state-transition | L1 | automated | `FilePreviewOverlay` open (base) with `ImageLightbox` stacked above | one `Escape`, then a second | first: lightbox closes, preview stays; second: preview closes |
| F4 | defaultPrevented opt-out via React stopPropagation (combobox in dialog) | decision-table | L1 | automated | a `Dialog` containing an **open** combobox whose Escape handler calls React `stopPropagation` | one `Escape`, then a second | first Escape closes the combobox, dialog stays open; second Escape closes the dialog |
| F5 | Registration order == visual: preview-from-dialog renders above | state-transition | L1 | automated | `FilePreviewOverlay` rendered while a `Dialog` is open | inspect stacking | overlay's z-index token is ≥ the dialog layer's (`z-60`); overlay is not behind the dialog |
| F6 | Parity: Escape in a Dialog's plain textarea still closes it | state-transition | L1 | automated | `Dialog` (Explore-style) with focus in its `<textarea>` (no Escape opt-out) | one `Escape` | dialog `onClose` fires (behavior unchanged from pre-fix) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Migrated surface deletes its old listener (no double-fire) | fault-injection (regression) | L1 | automated | a lone migrated `Dialog` (post-swap) with no residual self-managed keydown effect | one `Escape` | `onClose` called **exactly once**, not twice |

---

## Coverage summary

- Requirements covered: 6/6 (topmost-only · order-independent lifecycle · consume · defaultPrevented+repeat guard · dialog-primitive topmost clause · image-lightbox topmost clause)
- Scenarios by class: edge 11 · perf 0 · frontend 6 · error 1
- Scenarios by level: L1 18 · L2 0 · L3 0
- Scenarios by disposition: automated 18 · manual-only 0

## New infra needed

- none — all scenarios use the existing vitest + jsdom component-render tier. A
  manual visual spot-check of F5 (preview visibly above dialog) is a
  belt-and-suspenders step already captured in `tasks.md` §6, not a manifest row.
