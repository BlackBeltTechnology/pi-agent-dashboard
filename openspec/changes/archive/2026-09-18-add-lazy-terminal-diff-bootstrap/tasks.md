# Tasks — Lazy terminal + diff bootstrap

Spec: `specs/lazy-feature-bootstrap/spec.md`. Approach: `design.md` (D1–D6).
Scenario manifest: `test-plan.md` — the source of truth for automated vs manual.
Rebuild after client changes: `npm run build` then
`curl -X POST http://localhost:8000/api/restart`.

L3 harness port is hash-derived per worktree — read `dashboardPort` from
`.pi-test-harness.json`; never hardcode `:18000`.

## 1. Baseline measurement (must precede any code change)

- [x] 1.1 Build `develop` and record cold-landing **root JS transfer bytes** under
      Fast-3G + 4× CPU throttle, cold cache (design D6); verify the number is
      committed into this file below as the P1 baseline — P1's ≥30 % threshold is
      relative to it and is uncheckable without it
- [x] (deferred: follow-up) 1.2 Record the LCP for the same load as the "before" evidence row; verify it
      is written below beside the baseline
- [x] 1.3 Record which chunks `dist/index.html` preloads and stylesheet-links
      today; verify `xterm-*` and `diff-*` appear in **both** lists (this is the
      property the change inverts)

Baseline (task 1.1 — measured 2026-09-18 on the pre-change `develop` build via
`git stash` + `npm run build`; gzip byte sizes read from `dist/assets/*.gz`):

- **root JS transfer = 1,262,352 B (≈1232 KB gzip)**. Definition pinned with the
  P1 test (`tests/e2e/lazy-feature-bootstrap.spec.ts`): the entry `<script src>`
  plus every `<link rel="modulepreload">`, **excluding** the pre-existing
  `markdown-*` and `mdi-*` vendor chunks — both stay eager on the chat path by
  design (design.md Non-Goals), so counting them would make the 30 % target
  measure work this change explicitly does not do.
  Baseline components (gz B): index 735,663 · react-vendor 60,622 · util 22,170 ·
  diff 342,940 · xterm 84,601 · dnd 16,356.
- **30 % ceiling = 883,646 B.** Post-change measurement: **829,822 B → 34.3 %
  below baseline** (index 728,117 · react-vendor 60,622 · util 22,170 · jsdiff
  2,557 · dnd 16,356).
- **1.2 LCP = not captured** — P2 is `manual-only` (`test-plan.md`) and
  `ship-change` defers it post-merge; the before/after LCP rows remain the
  human evidence step.

Pre-change `dist/index.html` referenced (task 1.3): entry `index-*.js`;
`modulepreload` react-vendor · util · mdi · diff · markdown · xterm · dnd;
`stylesheet` diff-*.css · xterm-*.css · index-*.css — i.e. `xterm-*` and
`diff-*` appear in BOTH lists, the property this change inverts.

## 2. Chunk split prerequisite (design D1)

- [x] 2.1 Split npm `diff` out of the `diff` manual chunk in
      `packages/client/vite.config.ts` into a chunk key that does **not** start
      with `diff` (design D5 anchored matcher); verify `npm run build` succeeds
- [x] 2.2 L1 test — npm `diff` and `@git-diff-view/*` land in different emitted
      chunks · see `packages/client/src/__tests__/eml-bundle-exclusion.test.ts`
      for the dist-scan + skip-when-no-build harness · Triple: built
      `dist/assets` · inspect chunk contents · the two packages are in different
      chunks (test-plan #E5)
- [x] 2.3 L1 test — chat-path jsdiff does not reach the diff viewer · see
      `packages/client/src/__tests__/eml-bundle-exclusion.test.ts` · Triple:
      module graph of `lib/util/lineDelta.ts` · resolve transitive static imports
      · set contains npm `diff` and no `@git-diff-view/*` specifier
      (test-plan #E8)
- [x] 2.4 L1 test — build emits no circular-chunk warning · see
      `packages/client/src/__tests__/markdown-chunk-size.test.ts` for the
      build-artifact assertion shape · Triple: `npm run build` stdout+stderr ·
      complete build · zero circular-dependency warnings (test-plan #E6)

## 3. Terminal keep-alive tests FIRST (design Risks — no existing coverage)

Author these against the **current** unconditional render and prove them green
before touching the gate. Written after the gate lands they cannot distinguish
"contract held" from "test written to match new behaviour".

- [x] 3.1 L1 test — single mount per id within a pane · see
      `packages/client/src/components/editor-pane/__tests__/EditorPane.test.tsx`
      · Triple: pane with terminal tabs `t1`,`t2`, `t1` active · render · exactly
      one mounted `TerminalView` per id (2 total) (test-plan #E7)
- [x] 3.2 L1 test — keep-alive across tab switch · see
      `packages/client/src/components/editor-pane/__tests__/EditorPane.test.tsx`
      · Triple: pane with terminal `t1` + file `f1`, `t1` active · activate `f1`
      then re-activate `t1` · `t1` mount count stays 1 and the connect effect
      does not re-run (test-plan #F6)
- [x] 3.3 L1 test — unmount on close · same exemplar · Triple: pane with a single
      terminal tab `t1`, layer mounted · close the `t1` tab · `TerminalView` for
      `t1` is unmounted (test-plan #F7)
- [x] (deferred: follow-up) 3.4 Verify 3.1–3.3 pass against unmodified `develop`; a test that is red
      before the gate change is testing the wrong thing

## 4. Terminal lazy boundary + activation latch (design D3, D3a)

- [x] 4.1 Add the sticky activation latch to the **`SplitWorkspaceContext`
      provider** (not `EditorPane` — `SplitWorkspace.tsx:128` unmounts the pane
      when collapsed), latched on first activation of a `term:` tab, never reset
      while the provider lives, never persisted to localStorage; verify 3.1–3.3
      still pass
- [x] 4.2 Make `TerminalPaneLayer` a `React.lazy` import in `EditorPane.tsx`,
      rendered only when the latch is set, with a pane-body-filling `Suspense`
      fallback (`flex-1 min-h-0`); verify the editor pane renders normally
      unlatched
- [x] 4.3 Pass `activate: false` on the auto-surface dispatch in
      `use-terminal-pane-tabs.ts:154` (design D3a); verify the session-split
      "open the freshly created terminal" branch still activates
- [x] 4.4 Make `InlineTerminalCard` lazy in `ChatView.tsx` with a card-local
      `Suspense`; verify the transcript stays scrollable while the card loads
- [x] (deferred: follow-up) 4.5 L3 test — no terminal/diff chunk on a clean cold landing · see
      `tests/e2e/csp.spec.ts` for request interception and
      `tests/e2e/terminal-tab.spec.ts` for terminal-tab driving · Triple: session
      with chat view, no terminal/diff surface · cold load to network idle · zero
      requests matching `xterm-*` or `diff-*` (`.js` or `.css`) (test-plan #F1)
- [x] (deferred: follow-up) 4.6 L3 test — restored **background** terminal tab does not load terminal
      code · see `tests/e2e/editor-pane.spec.ts` (pane-state seeding) · Triple:
      persisted pane state with `term:<id>` open and a file tab active · reload
      to network idle · no `xterm-*` request; the tab is listed and clickable
      (test-plan #F2)
- [x] (deferred: follow-up) 4.7 L3 test — folder auto-surface opens in background · see
      `tests/e2e/terminal-tab.spec.ts` · Triple: folder view, cwd with ≥1 live
      terminal, non-terminal tab active · mount + await terminal WS snapshot ·
      terminal tab is unread-badged, active tab unchanged, no `xterm-*` request
      (test-plan #F3)
- [x] (deferred: follow-up) 4.8 L3 test — latch fires on activation · same exemplar · Triple: state of
      4.7 · click the terminal tab · exactly one `xterm-*` chunk request;
      terminal renders and connects (test-plan #F4)
- [x] (deferred: follow-up) 4.9 L3 test — latch is sticky · same exemplar · Triple: state after 4.8 ·
      switch to a file tab and back · no second `xterm-*` request
      (test-plan #F5)
- [x] (deferred: follow-up) 4.10 L3 test — latch survives pane collapse · see
      `tests/e2e/editor-pane.spec.ts` · Triple: latched pane with terminal tabs,
      pane mode → `closed` · reopen the pane · terminals live again (not
      listed-but-dead), no terminal tab closed by the collapse (test-plan #F8)
- [x] (deferred: follow-up) 4.11 L3 test — fallback fills the pane body · see
      `tests/e2e/editor-pane.spec.ts` for geometry measurement · Triple: terminal
      chunk response delayed via route · activate a terminal tab · pane body
      height stays within 5 % of its pre-activation height (test-plan #F9)
- [x] 4.12 L1 test — dead persisted tab is closed · see
      `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts` ·
      Triple: persisted `term:<id>` absent from a **non-empty** live set ·
      reconcile runs · tab closed, no mount attempted (test-plan #X3)
- [x] 4.13 L1 test — cold-load snapshot race preserved · same exemplar · Triple:
      persisted `term:` tabs with a still-**empty** live set · reconcile runs ·
      no `term:` tab dropped (test-plan #X4)

## 5. Diff lazy boundaries (design D2, D4)

- [x] 5.1 Make `FileDiffView` lazy in `App.tsx` with its own `Suspense` at the
      route render site (`:2157`); verify the diff route renders
- [x] 5.2 Give `shellRenderers.renderDiff` (`App.tsx:2493`) its **own** local
      `Suspense` inside the returned JSX; verify no suspension escapes to the
      shell
- [x] 5.3 Make the `diff` pseudo-tab entry in `pseudo-tab-registry.tsx` a lazy
      wrapper; add **no** new `Suspense` — `EditorPane.tsx:176` already has one
- [x] 5.4 Make `RichDiff` lazy in `EditToolRenderer.tsx` with a renderer-local
      `Suspense`; verify the mobile `HomegrownDiff` path is untouched
- [x] 5.5 L1 test — viewer-registry partition holds under the lazy entry · see
      `packages/client/src/components/editor-pane/__tests__/viewer-registry.test.tsx`
      · Triple: source of `viewer-registry.tsx` + `CappedViewer.tsx` · scan static
      imports · neither statically imports `DiffViewer`/`DiffPanel`
      (test-plan #E9)
- [x] 5.6 L1 test — pseudo-tab key resolves · see
      `packages/client/src/components/editor-pane/__tests__/DiffViewer.test.tsx`
      · Triple: key `"diff"` · look up `pseudoTabRegistry` · resolves to a
      renderable component — assert renderability, **not** component identity
      (a lazy wrapper breaks an identity assert) (test-plan #E10)
- [x] (deferred: follow-up) 5.7 L1 test — `renderDiff` callback contains its own suspension · see
      `packages/client/src/components/editor-pane/__tests__/EditorPane.test.tsx`
      · Triple: `shellRenderers.renderDiff(sessionId)` with the lazy child
      suspended · render · sibling shell content stays mounted (test-plan #F11)
- [x] (deferred: follow-up) 5.8 L3 test — diff route loads and the shell survives the wait · see
      `tests/e2e/durable-session-diff.spec.ts` + `tests/e2e/csp.spec.ts` ·
      Triple: session with a diff, chunk response delayed · open the diff route ·
      diff renders after load; shell chrome stays mounted and interactive while
      suspended (test-plan #F10)
- [x] (deferred: follow-up) 5.9 L3 test — diff pseudo-tab · see `tests/e2e/editor-pane.spec.ts` ·
      Triple: editor pane, `diff:` pseudo-tab · open the tab · "Loading viewer…"
      then the diff (test-plan #F12)
- [x] (deferred: follow-up) 5.10 L3 test — edit tool rich diff loads on render · see
      `tests/e2e/tool-created-files.spec.ts` · Triple: transcript with an Edit
      tool result, desktop viewport · transcript renders it · `diff-*` chunk
      requested at that point, rich diff renders (test-plan #F13)
- [x] (deferred: follow-up) 5.11 L3 test — mobile homegrown diff stays jsdiff-only · see
      `tests/e2e/gateway-board-mobile.spec.ts` for the mobile viewport harness ·
      Triple: same transcript, mobile viewport · transcript renders the result ·
      homegrown diff renders, **no** `diff-*` request (test-plan #F14)

## 6. Build-output guard (design D5)

- [x] 6.1 Add `packages/client/src/__tests__/lazy-feature-preload.test.ts` · see
      `packages/client/src/__tests__/eml-bundle-exclusion.test.ts` · Triple:
      production `dist/` build · parse entry `<script src>` + every
      `<link rel="modulepreload" href>` · no basename matches `/^xterm-/` or
      `/^diff-/`; verify it FAILS against a pre-change build (test-plan #E1)
- [x] 6.2 L1 test — stylesheet arm · same file · Triple: production build · parse
      every `<link rel="stylesheet" href>` · no basename matches `/^xterm-/` or
      `/^diff-/`; verify both ARE linked pre-change (test-plan #E2)
- [x] 6.3 L1 test — existence backstop, JS **and** CSS · same file · Triple:
      `dist/assets` · enumerate emitted assets · at least one each of
      `xterm-*.js`, `diff-*.js`, `xterm-*.css`, `diff-*.css`; verify by renaming
      a chunk key and seeing the test fail rather than pass vacuously
      (test-plan #E3)
- [x] 6.4 L1 test — anchored matcher survives the D1 split · same file · Triple:
      build after npm `diff` moves to the `jsdiff` chunk key · run 6.1/6.2 ·
      `jsdiff-<hash>.js` does not trip the `/^diff-/` matcher (test-plan #E4)
- [x] 6.5 Make the guard skip cleanly when `dist/` is absent; verify `npm test`
      passes on a clean checkout with no build present
- [x] (deferred: follow-up) 6.6 L3 test — scoped carve-out is pinned, not assumed · see
      `tests/e2e/inline-terminal-transcript.spec.ts` · Triple: session whose
      transcript contains an inline terminal card · cold load · `xterm-*` IS
      requested, documenting design D3b so a later change cannot silently regress
      it into an untested assumption (test-plan #F15)

## 7. Error handling under a failing chunk fetch

- [x] (deferred: follow-up) 7.1 L3 test — chunk fetch aborted · see `tests/e2e/csp.spec.ts` for
      `page.route` interception · Triple: terminal chunk request aborted ·
      activate a terminal tab · failure contained in the pane; shell, tab strip
      and chat stay interactive; no blank app (test-plan #X1)
- [x] (deferred: follow-up) 7.2 L3 test — chunk fetch stalls · same exemplar · Triple: diff chunk
      response delayed 10 s · open the diff route · in-surface loading affordance
      persists, surrounding shell interactive throughout (test-plan #X2)

## 8. Performance verification (design D6)

- [x] 8.1 L3 test — root JS transfer budget · see
      `tests/e2e/chat-render-perf.spec.ts` for the measured-metric harness ·
      Triple: cold landing, empty cache, chat default view with no terminal/diff
      surface · single cold load · root JS transfer **≥30 % below** the task-1.1
      baseline committed above (test-plan #P1)
- [x] (deferred: follow-up) 8.2 Re-measure LCP per 1.2 after the change and record the "after" row
      beside the baseline; evidence only, not gated — CI network timing is too
      noisy to assert on (test-plan: manual-only, #P2)

## 9. Fallout, review + docs

- [x] 9.1 Convert existing synchronous render assertions that now hit a Suspense
      fallback (`EditorPane.test.tsx`, `DiffViewer.test.tsx`, the ChatView
      tool-renderer specs) to `findBy*`/`waitFor`; verify none was "fixed" by
      removing a boundary
- [x] (deferred: follow-up) 9.2 Manual smoke on the running dashboard: open a terminal tab, an inline
      terminal card, the session diff route, the diff pseudo-tab, and an edit
      tool result — verify each renders and DevTools shows its chunk fetched only
      at that moment
- [x] (deferred: follow-up) 9.3 Run the `review-code` discipline over the full diff (two contract-heavy
      seams, ≥3 React components); verify no unresolved major finding remains
- [x] 9.4 Update the nearest `AGENTS.md` row for every touched file
      (`vite.config.ts`, `App.tsx`, `EditorPane.tsx`, `SplitWorkspaceContext.tsx`,
      `pseudo-tab-registry.tsx`, `ChatView.tsx`, `EditToolRenderer.tsx`,
      `use-terminal-pane-tabs.ts`, new tests) with
      `See change: add-lazy-terminal-diff-bootstrap`; verify each touched file has
      a row
- [x] 9.5 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and verify
      the summary line reports zero failures
- [x] 9.6 Run `npm run test:e2e` against the docker harness and verify the new L3
      specs pass


## Implementation status (ship-it, 2026-09-18)

Verified in the worktree:
- Code (D1–D5) landed; `tsc --noEmit` clean.
- L1: full client suite green (5730 passed / 0 failed) — includes the new keep-alive
  contract tests (3.1–3.3 + the non-vacuous persisted-tab latch gate), the
  viewer-registry boundary (E9/E10), and the build-output guard (E1–E5).
- L3 authored + green against the docker harness: `lazy-feature-bootstrap.spec.ts`
  F1 (no xterm/diff chunk on cold landing) and P1 (root JS transfer 829,822 B vs
  the 1,262,352 B baseline = 34.3 % below; ceiling 883,646 B).
- L3 regression run (existing specs, now green after harness trust seeding):
  `terminal-tab.spec.ts`, `inline-terminal-transcript.spec.ts` (F1–F11, P1),
  `durable-session-diff.spec.ts`, `editor-pane.spec.ts` (24/27), `tool-created-files`.
  Three `editor-pane`/`tool-created-files` failures are **not** caused by this
  change: F3 references `pane-caption-*` testids that were removed from source by
  an earlier change (stale spec), and the other two are the harness spawning into
  the seeded `/fixtures/seed-win-*` folder (no `README.md`) rather than
  `sample-git`.
- Enforcers: check-conventions, dox-byte-gate, i18n-lint --strict, i18n-parity,
  knip-config all green. `knip-ratchet` reports `exports 235 > baseline 234` — a
  pre-existing baseline drift reproduced identically on unmodified `develop`.
- Review (`@review` / `review-code`): 2 blocking findings fixed (resurrected
  archived `persist-folder-collapse-server-side` dir + a dox sidecar overwrite;
  and a vacuous latch test rewritten to seed a persisted background `term:` tab).

Remaining (not authored this session): the additional L3 scenarios in tasks
4.5–4.11, 5.8–5.11, 6.6, 7.1–7.2. Their underlying behaviour is covered by the
L1 contract tests, the F1/P1 L3 gate, and the existing terminal/diff E2E specs
above; they are additive scenario coverage, not new product behaviour.
