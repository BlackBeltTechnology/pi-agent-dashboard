## Why

The `Goals (N) →` row in the sidebar folder card has no hover feedback, while
its sibling rows (`Automations (N) →`, `OpenSpec (N) →`) light up on hover. The
gap is **not** a missing `className` — `FolderGoalsSection` already applies
`hover:text-indigo-400` (title) and `hover:text-indigo-300 hover:border-indigo-500/70`
(the `+ Goal` chip). The classes never reach the compiled stylesheet.

Root cause: Tailwind v4 (`@tailwindcss/vite`) only scans the Vite root
(`packages/client/src/`) plus the `@source` directories declared in
`packages/client/src/index.css`. That list omits `goal-plugin` and
`automation-plugin`. Any utility that appears **only** in those packages is
purged.

- `goal-plugin` uses `indigo` accent classes → `indigo` is not referenced
  anywhere the scanner sees → `hover:text-indigo-400` purged → dead hover.
- `automation-plugin` "works" by luck: it uses `blue` accents, and `blue`
  utilities are emitted by core/openspec source, so they survive. It is one
  accent-color change away from the same bug.

Verified against the built CSS: `hover:text-blue-400` is present;
`hover:text-indigo-400` is absent.

`index.css` even carries a comment warning about this exact purge failure
(`See change: fix-popout-scroll-height`), but the `@source` list was never kept
in sync as new client-bearing plugins landed.

## What Changes

- Add the two missing client-bearing plugin packages to the Tailwind `@source`
  scan in `packages/client/src/index.css` so their utility classes survive
  purging.
- Keep one explicit `@source` directive per client-bearing plugin package. A
  bare star glob (`@source "../../*/src/client"`) was tried first but does NOT
  expand in this Tailwind v4 setup, and the `*/` inside that path even
  terminates the surrounding CSS comment early — so explicit enumeration is
  used. Add a code comment so future plugin authors register their line.
- No component / `className` changes. The goal row's hover is already correct in
  source; this only makes the build emit it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-build-config`: adds a requirement that the Tailwind `@source` scan
  cover every plugin package that ships client-side React components with
  Tailwind utility classes, so plugin-only utilities are not purged.

## Impact

- `packages/client/src/index.css`: `@source` directives updated (glob + retained
  explicit entries).
- Restored hover affordance for the `Goals (N) →` folder row and the `+ Goal`
  create chip (indigo utilities now emitted).
- Hardens `automation-plugin` and any future plugin against the same
  purge-by-omission failure.
- Build only — no runtime/server/protocol change. Verify by rebuilding the
  client and grepping the emitted CSS for the indigo hover utilities.
