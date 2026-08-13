# Tasks — tokenize the tool-result error surfaces

## 1. Lock the failure in before fixing it

- [ ] 1.1 Create a worktree + branch. Do NOT work in the main checkout.
- [ ] 1.2 Red: extend `tests/e2e/severity-contrast.spec.ts` with probes for the six
      governed surfaces. Confirm it fails **light mode only**, 7 cells, matching the
      measured table in `proposal.md` (ctx body ≈ 1.24:1 is the canary).
- [ ] 1.3 Red: assert the guard from §4 fails against the current tree.

## 2. The ctx error card (the reported symptom)

### 2a. Chrome + neutral body (defects 1–2)
- [ ] 2.1 `CtxToolRenderer.tsx:187` — container to
      `bg-[var(--severity-error-bg)] border-[var(--severity-error-border)]`.
- [ ] 2.2 `:188` — label to `text-[var(--severity-error-fg)]`.
- [ ] 2.3 `:189` — body to `text-[var(--text-secondary)] p-2 bg-[var(--bg-code)] rounded`,
      matching the `receivedArgs` block six lines below. This is the chrome/content
      split, not just a token swap.
- [ ] 2.4 Verify `LinkifiedText` links stay distinguishable against the new body
      background — they previously sat on a red tint.
- [ ] 2.5 Unit: assert the body carries no severity class and the container does.

### 2b. Split the runtime error into sections (defect 3)
- [ ] 2.6 Red: `parse-ctx-result` test — a runtime error with a fenced ```shell
      block + `Exit code: 1` + `stdout:`/`stderr:` parses into
      `{ command, language:"shell", exitCode:1, stdout, stderr }`.
- [ ] 2.7 Red: `parse-ctx-result` test — a plain-sentence runtime error leaves
      those fields undefined and keeps `message`; parser never throws.
- [ ] 2.8 Green: extend the `runtime` arm of `parseError` to extract the fields.
      Keep it pure and React-free.
- [ ] 2.9 Green: `CtxToolRenderer` error card — when structured, render `command`
      through the existing `CodeBlock` (syntax-highlighted), an `exit <n>` badge,
      and each non-empty stream as a labelled section. Reuse `CodeBlock`; do NOT
      add a markdown pipeline.
- [ ] 2.10 Green: unstructured runtime error falls back to the flat neutral body
      from 2.3. No text dropped.
- [ ] 2.11 Unit: assert the structured card renders no literal ` ``` ` fence text
      and no `Exit code:` label as body text; assert the fallback path renders
      `message` verbatim.

## 3. The five single-line surfaces

- [ ] 3.1 `ToolBurstGroup.tsx:383` — `N failed` badge to severity bg/fg/border.
- [ ] 3.2 `BashOutputCard.tsx:46` — non-zero `exit N` badge to severity bg/fg.
      Leave the success branch (`green-500/20`) alone; it is out of scope and a
      separate tier.
- [ ] 3.3 `ToolCallStep.tsx:149` — errored status icon to `--severity-error-fg`.
      Leave the sibling `sky-400` / `green-400` / `yellow-400` branches alone.
- [ ] 3.4 `AskUserToolRenderer.tsx:220-221` — icon to `--severity-error-fg`; message
      to `--text-secondary`. Drop the `/80` alpha: it compounds a low-contrast
      literal and has no purpose once the token is derived.
- [ ] 3.5 `AgentToolRenderer.tsx:346` — `Error:` marker to `--severity-error-fg`,
      the message itself to `--text-secondary`.

## 4. Make the regression impossible

- [ ] 4.1 Resolve design Q1: guard in `scripts/check-conventions.mjs` (ship gate) vs
      a Biome rule (`quality:changed`). Record the choice in `design.md`.
- [ ] 4.2 Implement the guard over the governed file allowlist only.
- [ ] 4.3 Confirm it does NOT fire on the ~40 legitimate literals outside the set
      (destructive buttons, preview panes, connectivity panels).

## 5. Verify

- [ ] 5.1 Green: the §1.2 e2e probes pass in all 18 theme×mode combos.
- [ ] 5.2 `npm test` green; report the red list before touching source if any.
- [ ] 5.3 Biome + `tsc --noEmit` clean (`npm run quality:changed`).
- [ ] 5.4 `review-code` pass on the diff — six components, two directories.
- [ ] 5.5 `doubt-driven-review` on the chrome-vs-content rule before it becomes
      precedent for every future error surface.
- [ ] 5.6 Deploy: client-only change → `npm run build` + `POST /api/restart`.

## 6. Manual QA

- [ ] 6.1 Trigger a failing `ctx_execute` (`exit 3`). Confirm the card renders the
      command as a syntax-highlighted code block, an `exit 3` badge, and
      stdout/stderr sections — no literal ` ``` ` fences — in **light** mode.
- [ ] 6.2 Same in dark mode — confirm the body is no longer a flat red wash and the
      sections are present.
- [ ] 6.2b Trigger a runtime error with no execution shape (e.g. a validation-style
      sentence routed to runtime); confirm it degrades to the neutral flat body
      with no dropped text.
- [ ] 6.3 Trigger a failing `Bash` call; confirm the `exit N` badge and the
      `N failed` burst badge are both legible in light mode.
- [ ] 6.4 Cancel an `ask_user` prompt; confirm the error message is readable.
- [ ] 6.5 Spot-check one non-default theme in both modes.
- [ ] 6.6 Re-open `mockups/tool-error-cards/index.html` side by side with the live
      chat and confirm the AFTER column now matches what ships. Refresh the mock's
      stylesheet href if the bundle hash rotated.
