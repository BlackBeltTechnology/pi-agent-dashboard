## 1. Component prop surface

- [x] 1.1 Add `onResume?: (mode: "continue" | "fork") => void` to the `Props` interface in `packages/client/src/components/SessionHeader.tsx` (top-level prop, not nested under `mobileActions`).
- [x] 1.2 Destructure `onResume` in the `SessionHeader` function signature alongside the existing props.

## 2. Desktop render

- [x] 2.1 In the desktop branch of `SessionHeader.tsx`, compute `const isEnded = session.status === "ended" && Boolean(session.sessionFile) && Boolean(onResume);` after the existing `desktopAttachedChange` lookup.
- [x] 2.2 Replace the existing `<span className="text-[var(--text-muted)]">{formatDuration(duration)}</span>` element with a conditional: when `isEnded`, render the Resume + Fork pill pair; otherwise render the existing duration span unchanged.
- [x] 2.3 Resume button: `mdiPlayCircleOutline` icon (size 0.4, inline mr-0.5), text "Resume", classes `text-[10px] px-1.5 py-0.5 rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50 disabled:cursor-not-allowed`, `disabled={!!session.resuming}`, `onClick={() => onResume!("continue")}`, `title="Resume session (continue same session)"`.
- [x] 2.4 Fork button: `mdiSourceFork` icon (size 0.4, inline mr-0.5), text "Fork", classes `text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed`, `disabled={!!session.resuming}`, `onClick={() => onResume!("fork")}`, `title="Fork session (new session from this point)"`.
- [x] 2.5 Add `data-testid="header-resume-button"` and `data-testid="header-fork-button"` to the two new buttons for component-test selection.
- [x] 2.6 Verify `mdiPlayCircleOutline` and `mdiSourceFork` are imported at the top of the file (add to the existing `@mdi/js` import block if missing).

## 3. App.tsx wiring

- [x] 3.1 In `packages/client/src/App.tsx`, locate the desktop `<SessionHeader …>` JSX block at line ~830 and add `onResume={selectedId ? (mode) => handleResumeSession(selectedId, mode) : undefined}` as a prop. Mirror the same conditional pattern used for `onForkFromMessage` on `<ChatView>` so the prop is `undefined` when no session is selected.
- [x] 3.2 Confirm the existing `mobileActions.onResume` wiring inside the same JSX block is preserved unchanged.

## 4. Tests

- [x] 4.1 Add `packages/client/src/components/__tests__/SessionHeader.resume.test.tsx` covering: (a) ended + sessionFile + onResume → both buttons render, duration span absent; (b) active session → no buttons, duration shown; (c) ended + no sessionFile → no buttons; (d) ended + no onResume → no buttons; (e) Resume click → callback invoked once with `"continue"`; (f) Fork click → callback invoked once with `"fork"`; (g) `resuming: true` → buttons rendered with `disabled` attribute and clicks do NOT invoke callback.
- [x] 4.2 Use `@testing-library/react` `render` + `screen.getByTestId("header-resume-button")` (and equivalent for fork) for selection. Assert `disabled` via the `toBeDisabled()` matcher.
- [x] 4.3 Run `npm test -- SessionHeader.resume 2>&1 | tee /tmp/pi-test.log` and confirm the new file passes; grep `/tmp/pi-test.log` for any unrelated regressions.

## 5. Verification

- [x] 5.1 Run `npm run build` to confirm TypeScript compilation succeeds (the new prop addition is the only type surface change).
- [x] 5.2 Manual smoke test in dev mode: spawn a session, kill the pi process (or `pi-dashboard restart` while viewing), confirm the header shows Resume + Fork pills, click Resume, confirm the session re-attaches and the buttons disappear once `status` flips back to alive.
- [x] 5.3 Manual smoke test on mobile viewport (DevTools narrow): confirm the kebab menu still shows Resume and the new desktop pills do NOT render.

## 6. Documentation

- [x] 6.1 Update the `SessionHeader.tsx` row in `AGENTS.md` to mention the new `onResume` prop and the ended-state Resume / Fork pill behavior, citing change `resume-button-in-session-header`.
- [x] 6.2 Add a one-line entry under `## [Unreleased]` in `CHANGELOG.md` describing the user-visible affordance.
