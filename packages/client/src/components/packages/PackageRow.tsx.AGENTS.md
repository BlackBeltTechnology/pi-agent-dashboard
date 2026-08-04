# PackageRow.tsx — index

Generic installed-package row used across unified packages sections. Exports `PackageRow`, `PackageRowProps`. Local/git rows with `publishedVariantSource` render a 2nd source line (published link + `<v> available`) + inline `↺ Reset to npm` + `⋮` "Reset to published version", both confirm-gated (`onResetToNpm` fires after accept). See change: reset-override-to-npm. → see `PackageRow.tsx.AGENTS.md`

See change: fix-popover-container-clip — row menu reads `usePopoverBoundary()`, passes `boundaryRef` + `estimatedWidth:160`; `anchorRight ? right-0 : left-0` + inline maxWidth. Boundary flip proven at component level (F10).

## fix-popover-pane-bounded-height

- `usePopoverFlip` now returns `minHeight` (floor, capped by `maxHeight`) alongside `maxHeight` (bound, never floor-inflated). This file applies BOTH as inline styles — applying only `maxHeight` would silently lose the floor.
