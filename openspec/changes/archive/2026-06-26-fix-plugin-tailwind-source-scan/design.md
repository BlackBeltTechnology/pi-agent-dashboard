## Context

Tailwind v4 via `@tailwindcss/vite` performs content detection from the Vite
root and any `@source` directives in the entry CSS. Utilities referenced only in
files outside that scan set are purged from the production stylesheet. The
dashboard client is `packages/client`; plugins live in sibling
`packages/<plugin>/src/client` directories and are bundled into the same client
build, but they are NOT automatically scanned.

Current `@source` list in `packages/client/src/index.css`:

```
@source "../../client-utils/src";
@source "../../dashboard-plugin-runtime/src";
@source "../../flows-plugin/src/client";
@source "../../subagents-plugin/src/client";
@source "../../jj-plugin/src/client";
@source "../../honcho-plugin/src/client";
```

Client-bearing plugin packages (have `src/client` with Tailwind `className`
usage): `flows-plugin`, `subagents-plugin`, `jj-plugin`, `honcho-plugin`,
`goal-plugin`, `automation-plugin`. The last two are missing → their
plugin-only utilities purge.

## Goals / Non-Goals

Goals:
- Goal-plugin and automation-plugin utilities survive purge.
- Future plugin client dirs covered without manual edits (no repeat of this
  trap).

Non-Goals:
- No component / `className` edits — source is already correct.
- No change to non-client plugin scanning or to `client-utils` /
  `dashboard-plugin-runtime` (not under `src/client`).
- No bundler / Vite-config change.

## Decisions

### Decision: Explicit `@source` line per client-bearing plugin (glob rejected)

Add one explicit directive per missing plugin, retaining the existing pattern:

```
@source "../../client-utils/src";
@source "../../dashboard-plugin-runtime/src";
@source "../../flows-plugin/src/client";
@source "../../subagents-plugin/src/client";
@source "../../jj-plugin/src/client";
@source "../../honcho-plugin/src/client";
@source "../../goal-plugin/src/client";       # added
@source "../../automation-plugin/src/client"; # added
```

The glob form `@source "../../*/src/client"` was implemented and built first,
but FAILED on two counts during verification:

1. **Did not expand** — goal-plugin-only utilities (`hover:text-indigo-400`,
   `border-indigo-500/40`, `bg-indigo-500/5`) stayed absent from the emitted
   CSS, proving the bare-`*` glob did not enumerate sibling `src/client` dirs
   in this `@tailwindcss/vite` setup.
2. **Broke CSS parsing when referenced in the comment** — the literal `*/`
   inside `../../*/src/client` terminates the surrounding `/* ... */` block
   early, yielding `Missing opening (` build errors.

Explicit enumeration is the proven pattern (the four pre-existing entries all
work). Trade-off accepted: the next plugin author must add a line; a code
comment in `index.css` states this requirement to mitigate the manual-sync
trap.

## Risks / Trade-offs

- **Manual-sync trap persists**: explicit enumeration means a new client-bearing
  plugin must add its own `@source` line or hit the same dead-style bug. Mitigated
  by a code comment in `index.css`; the grep verification step catches misses.
- **Glob rejected, not deferred**: the glob was built and verified to fail (see
  decision above), so it is not a viable future shortcut without Tailwind/
  bundler changes.

## Verification

1. `npm run build`.
2. Grep emitted `packages/client/dist/assets/index-*.css` for
   `hover\:text-indigo-400`, `hover\:text-indigo-300`,
   `hover\:border-indigo-500\/70` → all present.
3. Load the dashboard, hover the `Goals (N) →` folder row and the `+ Goal`
   chip → color/border transitions match the `Automations` / `OpenSpec` rows.
