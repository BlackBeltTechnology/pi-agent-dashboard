# PackageRow.tsx — index

Generic installed-package row used across unified packages sections. Exports `PackageRow`, `PackageRowProps`. Local/git rows with `publishedVariantSource` render a 2nd source line (published link + `<v> available`) + inline `↺ Reset to npm` + `⋮` "Reset to published version", both confirm-gated (`onResetToNpm` fires after accept). See change: reset-override-to-npm. → see `PackageRow.tsx.AGENTS.md`

See change: fix-popover-container-clip — row menu reads `usePopoverBoundary()`, passes `boundaryRef` + `estimatedWidth:160`; `anchorRight ? right-0 : left-0` + inline maxWidth. Boundary flip proven at component level (F10).

## fix-popover-pane-bounded-height

- `usePopoverFlip` now returns `minHeight` (floor, capped by `maxHeight`) alongside `maxHeight` (bound, never floor-inflated). This file applies BOTH as inline styles — applying only `maxHeight` would silently lose the floor.

## unify-pi-core-into-package-queue (D9 — visible queue)

Three non-conflated state props. Rule: no enabled click is silently lost.

| Prop | Meaning | Effect |
|---|---|---|
| `busy` | own-source op RUNNING | spinner on Update; `busy && progress` → progress line |
| `queued` | own-source op QUEUED | `queued` Badge (`mdiClockOutline`, testId `<testId>-queued`) + Update label becomes "Queued" + own Update disabled + waiting tooltip |
| `locked` + `lockedReason` | ANY op running (`isAnyRunning`) | disables **only** ‹Move›, ‹Reset to published› (kebab), inline ‹Reset to npm›; `lockedReason` → `title` |

Update button `disabled={busy \|\| queued}` — NEVER disabled because another row is busy. A mid-flight click on any other row enqueues.

`locked` scope is deliberate: every other control enqueues onto source-keyed `packageQueue` so a mid-flight click is safe; Move/Reset bypass it via `moveTracker` (`moveId`-keyed + partial-success → doesn't fit `statusFor(source)`), take the busy lock directly with NO retry, so an enabled mid-flight click would 409 silently.

Icon import added: `mdiClockOutline`.

See change: unify-pi-core-into-package-queue.
