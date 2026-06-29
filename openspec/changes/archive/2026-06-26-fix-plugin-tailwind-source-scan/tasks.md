## 1. Fix Tailwind source scan

- [x] 1.1 In `packages/client/src/index.css`, add explicit
  `@source "../../goal-plugin/src/client";` and
  `@source "../../automation-plugin/src/client";` lines (glob form rejected:
  did not expand + `*/` in path broke the CSS comment). Update the explanatory
  comment to require a line per new client-bearing plugin.
  → verify: file diff shows the two new explicit entries + comment note.

## 2. Verify emitted CSS

- [x] 2.1 `npm run build` → succeeds.
  → verify: exit 0, `dist/assets/index-rdDVlhz8.css` regenerated.
- [x] 2.2 Grep emitted CSS for the goal-plugin hover utilities.
  → verify: `hover\:text-indigo-400`, `hover\:text-indigo-300`,
  `hover\:border-indigo-500\/70`, `border-indigo-500\/40`, `bg-indigo-500\/5`
  all present (count 1 each) in `dist/assets/index-*.css`.
- [x] 2.3 Confirm no regression: `hover\:text-blue-400` still present.
  → verify: grep returns a match (count 1).

## 3. Visual confirmation

- [x] 3.1 Load the dashboard, hover the `Goals (N) →` folder row and the
  `+ Goal` chip.
  → verify: `GOALS (N) →` renders indigo on hover (browser screenshot after
  `/api/restart` deploy), matching the `Automations`/`OpenSpec` sibling rows.
