## 1. SlotPill surface variant

- [x] 1.1 Add `surface?: "raised" | "flat"` to `SlotPillProps` (default `"raised"`) in
      `packages/dashboard-plugin-runtime/src/SlotPill.tsx`.
- [x] 1.2 Swap the body background/shadow by variant: keep
      `bg-[var(--bg-secondary)] shadow-[0_1px_2px_var(--shadow-card)]` for `raised`; use
      `bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)]` and NO shadow for `flat`. Leave
      border, radius, hover-border, glyph chip, and capsule legend identical. Both class strings
      must be literals so Tailwind JIT-compiles them.

## 2. Placement plumbing

- [x] 2.1 Add optional `placement?: "sidebar" | "card"` to the folder-section slot props in
      `packages/shared/src/dashboard-plugin/slot-props.ts`.
- [x] 2.2 In `WorktreeCardSectionSlot` (`packages/dashboard-plugin-runtime/src/slot-consumers.tsx`)
      pass `placement: "card"` into the props of each rendered `worktree-card-section` claim; leave
      the `sidebar-folder-section` consumer unchanged (defaults to sidebar).
- [x] 2.3 In `FolderKbSection` (`packages/kb-plugin/src/client/FolderKbSection.tsx`) read
      `placement` (default `"sidebar"`) and pass `surface={placement === "card" ? "flat" : "raised"}`
      to `SlotPill`.

## 3. Tests

- [x] 3.1 `SlotPill` unit: default render carries `bg-[var(--bg-secondary)]` + the shadow token
      (raised).
- [x] 3.2 `SlotPill` unit: `surface="flat"` render carries the `color-mix` translucent bg and
      carries NO `shadow-*` token; border + capsule legend unchanged.
- [x] 3.3 `FolderKbSection` unit: `placement="card"` forwards `surface="flat"`; default/`"sidebar"`
      forwards `surface="raised"`.
- [x] 3.4 `WorktreeCardSectionSlot` unit: rendered claims receive `placement: "card"`.

## 4. Verify

- [x] 4.1 Affected suites green (`SlotPill.test.tsx`, `slot-consumers.test.tsx`,
      `FolderKbSection.test.tsx`) + `npm run lint` (tsc) clean for the four touched files (the lone
      tsc error is pre-existing in `packages/video-transcription`, unrelated).
- [x] 4.2 Built client + restarted (production bundle live, uptime reset). Live browser confirmed
      sidebar folder KB pills RAISED (default intact → deployed bundle verified). Flat KB subcard
      accepted via proxy (unit tests + token-accurate mockup): no active worktree session existed
      live to render the subcard, and ended worktree cards render compact. User accepted this
      evidence in lieu of the live worktree-card shot.
- [x] 4.3 `openspec validate align-session-card-kb-slot-surface --strict` → valid.
