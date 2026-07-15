# Tasks

## 1. Collapse the Changes section by default

- [ ] 1.1 In `packages/client/src/components/editor-pane/ChangesRailSection.tsx`, change the initial `expanded` state from `useState(true)` to `useState(false)`. → verify: on mount only the `▸ Changes (N)` header renders; sub-header + `DiffFileTree` absent.
- [ ] 1.2 Confirm the `changesRevealSignal` effect still expands the section (skip-initial-mount guard must not swallow the first real bump). → verify: `openChanges()` from chat expands the section and opens the diff tab.

## 2. Tests

- [ ] 2.1 `__tests__/ChangesRailSection.test.tsx`: assert header-only on mount (query for absence of `data-testid` tree / roll-up). → verify: test fails before 1.1, passes after.
- [ ] 2.2 Assert clicking the header expands to the compact tree. → verify: `DiffFileTree` rows visible after click.
- [ ] 2.3 Assert a `changesRevealSignal` bump expands the collapsed section. → verify: section expanded without a header click.

## 3. Manual / QA

- [ ] 3.1 Load a session with many changes; confirm the rail shows only `▸ Changes (N)` and the workspace tree sits directly below (no 45% reserved gap). → verify: visually in the running dashboard.
- [ ] 3.2 Click a changed-file link in the chat transcript; confirm the section auto-expands and the diff opens. → verify: reveal path intact.
