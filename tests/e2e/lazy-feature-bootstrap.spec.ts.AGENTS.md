# lazy-feature-bootstrap.spec.ts — index

L3 gate for `add-lazy-terminal-diff-bootstrap`. Runtime half of the laziness
claim; the build-artifact half is L1 in
`packages/client/src/__tests__/lazy-feature-preload.test.ts`.

Short form: cold landing fetches no `xterm-*`/`diff-*` chunk; first terminal
activation fetches xterm exactly once and the latch survives a pane collapse;
root JS transfer ≥15 % below baseline; the App diff route fetches the diff chunk
lazily; mobile stays jsdiff-only; a failed chunk fetch is contained.

| Test | Pins |
|---|---|
| F1 | cold landing → zero `xterm-*`/`diff-*` requests |
| F4 | `+ Terminal` activation → exactly one `xterm-*.js`; pane mount alone does NOT latch |
| F8 | latch survives `layout-mode-closed` → `layout-mode-split`; no refetch, terminal live again |
| P1 | root JS transfer ≥15 % below the committed raw baseline |
| F13 | `/session/<id>/diff` route arm mounts `FileDiffView` + fetches the diff chunk lazily |
| F14 | mobile (`useMobile`: width<768 OR height<600) → homegrown diff, no `diff-*` fetch |
| F15 | transcript containing an inline terminal card DOES fetch xterm (pins design D3b) |
| X1 | aborted `xterm-*.js` fetch → contained by `ErrorBoundary`, shell stays interactive |
| F9 | terminal Suspense fallback fills the pane body (no collapse) |

`test.fixme` (authored, deliberately not run — tasks 5.8 / 7.2): F10 and X2, the
slow/stalled-chunk arms. Gating the `diff-*` chunk with `page.route` does not
deterministically hold `FileDiffView`'s mount in this harness, so those
suspension windows are flaky. Their properties are partly covered by F13 (chunk
fetch) and X1 (failed fetch). Needs a deterministic slow-chunk harness.

Locator notes for anyone extending this file:
- Do NOT assert the "Changed Files" TEXT to mean "the diff view mounted":
  `diff.changedFiles` is also rendered by `SessionHeader`. Assert
  `data-testid="file-diff-view"` instead.
- Do NOT build assertions on the `changed-files-chip` / `changes-rail-section`:
  they derive from the fixture's REAL working tree, so in-container agent
  activity (an untracked `.pi/inbox/`) makes them report `.pi`, not the
  faux-edited `src/example.ts`.
- `spawnFreshGitSession` returns a card locator; read
  `card.getAttribute("data-session-id")` for the id.
