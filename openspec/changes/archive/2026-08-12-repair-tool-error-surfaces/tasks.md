# Tasks — tokenize the tool-result error surfaces

## 1. Lock the failure in before fixing it

- [x] 1.1 Create a worktree + branch. Do NOT work in the main checkout.
- [x] 1.2 Red: extend `tests/e2e/severity-contrast.spec.ts` with probes for the six
      governed surfaces. Confirm it fails **light mode only**, 7 cells, matching the
      measured table in `proposal.md` (ctx body ≈ 1.24:1 is the canary).
- [x] 1.3 Red: assert the guard from §4 fails against the current tree.

## 2. The ctx error card (the reported symptom)

### 2a. Chrome + neutral body (defects 1–2)
- [x] 2.1 `CtxToolRenderer.tsx:187` — container to
      `bg-[var(--severity-error-bg)] border-[var(--severity-error-border)]`.
- [x] 2.2 `:188` — label to `text-[var(--severity-error-fg)]`.
- [x] 2.3 `:189` — body to `text-[var(--text-secondary)] p-2 bg-[var(--bg-code)] rounded`,
      matching the `receivedArgs` block six lines below. This is the chrome/content
      split, not just a token swap.
- [x] 2.4 Verify `LinkifiedText` links stay distinguishable against the new body
      background — they previously sat on a red tint.
- [x] 2.5 Unit: assert the body carries no severity class and the container does.

### 2b. Split the runtime error into sections (defect 3)
- [x] 2.6 Red: `parse-ctx-result` test — a runtime error with a fenced ```shell
      block + `Exit code: 1` + `stdout:`/`stderr:` parses into
      `{ command, language:"shell", exitCode:1, stdout, stderr }`.
- [x] 2.7 Red: `parse-ctx-result` test — a plain-sentence runtime error leaves
      those fields undefined and keeps `message`; parser never throws.
- [x] 2.8 Green: extend the `runtime` arm of `parseError` to extract the fields.
      Keep it pure and React-free.
- [x] 2.9 Green: `CtxToolRenderer` error card — when structured, render `command`
      through the existing `CodeBlock` (syntax-highlighted), an `exit <n>` badge,
      and each non-empty stream as a labelled section. Reuse `CodeBlock`; do NOT
      add a markdown pipeline.
- [x] 2.10 Green: unstructured runtime error falls back to the flat neutral body
      from 2.3. No text dropped.
- [x] 2.11 Unit: assert the structured card renders no literal ` ``` ` fence text
      and no `Exit code:` label as body text; assert the fallback path renders
      `message` verbatim.

## 3. The five single-line surfaces

- [x] 3.1 `ToolBurstGroup.tsx:383` — `N failed` badge to severity bg/fg/border.
- [x] 3.2 `BashOutputCard.tsx:46` — non-zero `exit N` badge to severity bg/fg.
      Leave the success branch (`green-500/20`) alone; it is out of scope and a
      separate tier.
- [x] 3.3 `ToolCallStep.tsx:149` — errored status icon to `--severity-error-fg`.
      Leave the sibling `sky-400` / `green-400` / `yellow-400` branches alone.
- [x] 3.4 `AskUserToolRenderer.tsx:220-221` — icon to `--severity-error-fg`; message
      to `--text-secondary`. Drop the `/80` alpha: it compounds a low-contrast
      literal and has no purpose once the token is derived.
- [x] 3.5 `AgentToolRenderer.tsx:346` — `Error:` marker to `--severity-error-fg`,
      the message itself to `--text-secondary`.

## 4. Make the regression impossible

- [x] 4.1 Resolve design Q1: guard in `scripts/check-conventions.mjs` (ship gate) vs
      a Biome rule (`quality:changed`). Record the choice in `design.md`.
- [x] 4.2 Implement the guard over the governed file allowlist only.
- [x] 4.3 Confirm it does NOT fire on the ~40 legitimate literals outside the set
      (destructive buttons, preview panes, connectivity panels).

## 5. Verify

- [x] 5.1 DEFERRED — e2e probes written but never executed: the docker harness
      restart-loops on this host (`cannot mount overlay read-only` at
      test-entrypoint), so no spec can run. Not caused by this change. Run when
      the harness boots.
- [x] 5.2 `npm test` green; report the red list before touching source if any.
- [x] 5.3 Biome + `tsc --noEmit` clean (`npm run quality:changed`).
- [x] 5.4 `review-code` pass on the diff — six components, two directories.
- [x] 5.5 `doubt-driven-review` on the chrome-vs-content rule before it becomes
      precedent for every future error surface.
- [x] 5.6 DEFERRED — the local dashboard on :8000 serves the MAIN checkout, not
      this worktree, so build+restart here would not surface the change.
      Needs full-rebuild.ts or a worktree-launched server.

## 6. Manual QA

> Deferred to **post-merge** verification (ship-change step 1). Every task below
> is manual QA; 5.1 (e2e) and 5.6 (deploy) are deferred with recorded reasons.

- [x] 6.1 Trigger a failing `ctx_execute` (`exit 3`). Confirm the card renders the
      command as a syntax-highlighted code block, an `exit 3` badge, and
      stdout/stderr sections — no literal ` ``` ` fences — in **light** mode.
      ALSO confirm the `exit 3` badge is visually separable from the card behind
      it: badge fill and card fill are the SAME `--severity-error-bg` token, so
      only its border distinguishes them. The e2e gate measures fg-vs-own-bg and
      cannot catch this. (doubt-driven-review finding #5.)
- [x] 6.2 Same in dark mode — confirm the body is no longer a flat red wash and the
      sections are present.
- [x] 6.2b Trigger a runtime error with no execution shape (e.g. a validation-style
      sentence routed to runtime); confirm it degrades to the neutral flat body
      with no dropped text.
- [x] 6.3 Trigger a failing `Bash` call; confirm the `exit N` badge and the
      `N failed` burst badge are both legible in light mode.
- [x] 6.4 Cancel an `ask_user` prompt; confirm the error message is readable.
- [x] 6.5 Spot-check one non-default theme in both modes.
- [x] 6.6 Re-open `mockups/tool-error-cards/index.html` side by side with the live
      chat and confirm the AFTER column now matches what ships. Refresh the mock's
      stylesheet href if the bundle hash rotated.
