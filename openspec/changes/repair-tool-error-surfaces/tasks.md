# Tasks — tokenize the tool-result error surfaces

Test tasks below are folded from `test-plan.md` (24 automated rows, 3 manual-only).
The manifest is the source of truth for automated-vs-manual; each folded task names
its harness exemplar and carries the scenario Triple.

## 1. Setup

- [x] 1.1 Create a worktree + branch. Do NOT work in the main checkout.
- [x] 1.2 Confirm the red baseline before touching source: the §5 e2e probes must fail
      **light mode only**, 7 cells, matching the measured table in `proposal.md`
      (ctx body ≈ 1.24:1 is the canary).

## 2. Author the parser scenarios (red first)

Exemplar for every task in this section:
`packages/client/src/components/tool-renderers/__tests__/parse-ctx-result.test.ts`
(fixtures in `parse-ctx-result.fixtures.ts`).

- [x] 2.1 Structured runtime error, nominal shape (test-plan #E1). Input: `isError=true`,
      body = fenced ```shell block `grep foo` + `Exit code: 1` + `stdout:` + `stderr:`
      sections · Trigger: `parseCtxResult("ctx_execute", body, true)` · Observable:
      `{kind:"error",variant:"runtime",command:"grep foo",language:"shell",exitCode:1,
      stdout,stderr}`. See `parse-ctx-result.test.ts`.
- [x] 2.2 Streams absent (test-plan #E2). Input: fence + `Exit code: 2`, no stream
      sections · Trigger: parser runs · Observable: `command` + `exitCode:2` set,
      `stdout`/`stderr` `undefined` (NOT `""`), no throw.
- [x] 2.3 Falsy-zero boundary (test-plan #E3). Input: body with `Exit code: 0` ·
      Trigger: parser runs · Observable: `exitCode === 0`, not `undefined` — the
      falsy-zero path must not collapse to "no exit code".
- [x] 2.4 Non-numeric exit code (test-plan #E4). Input: `Exit code: null` / `Exit code:`
      with no number · Trigger: parser runs · Observable: `exitCode` `undefined`, no
      throw, full original text still reachable via `message`.
- [x] 2.5 Unstructured fallback (test-plan #E5). Input: plain sentence, no fence, no exit
      line · Trigger: parser runs · Observable: `variant:"runtime"` with all five fields
      `undefined` and `message` === input verbatim.
- [x] 2.6 Truncated input, no throw (test-plan #E6). Input: opening ```shell fence with
      no closing fence, body cut mid-stream · Trigger: parser runs · Observable: does not
      throw; every input byte still reachable across `command` + streams + `message`.
- [x] 2.7 Banner strip × new fields (test-plan #E7). Input: `⚠️ context-mode v… outdated …`
      line prepended to the #E1 body · Trigger: parser runs · Observable: banner stripped
      AND all five fields extracted exactly as #E1 — strip runs before shape detection.
- [x] 2.8 Fence with no language (test-plan #E8). Input: bare ``` fence + `Exit code: 1` ·
      Trigger: parser runs · Observable: `command` set, `language` `undefined`.
- [x] 2.9 Delimiter injection (test-plan #E9). Input: a `stdout:` section whose own text
      contains lines reading `stderr:` and `Exit code: 7` · Trigger: parser runs ·
      Observable: split at real section boundaries only; injected lines stay inside
      `stdout`; `exitCode` is the real one, not `7`.
- [x] 2.10 Multi-fence body (test-plan #E10). Input: two fenced blocks + an exit line ·
      Trigger: parser runs · Observable: FIRST fence becomes `command`; the second fence's
      text (markers included) survives verbatim in `message`/`stdout`; exactly one
      `CodeBlock` is synthesised; no byte dropped.
- [x] 2.11 Malformed-input fuzz table (test-plan #X1). Input: empty string, only a fence,
      only `Exit code:`, CRLF endings, control chars, 0-length streams · Trigger: parser
      runs on each · Observable: no throw for any case; each returns a `{kind:"error"}`
      struct whose `message` retains the input text.

## 3. Author the rendered-card scenarios (red first)

Exemplars: `tool-renderers/__tests__/CtxToolRenderer.test.tsx`,
`tool-renderers/__tests__/AskUserToolRenderer.test.tsx`,
`components/__tests__/{ToolBurstGroup,BashOutputCard,ToolCallStep}.test.tsx`.

- [x] 3.1 Structured card renders sections (test-plan #F1). Input: #E1's parsed struct ·
      Trigger: render the error card · Observable: DOM has a `CodeBlock` carrying
      `grep foo`, an `exit 1` badge, labelled `stdout`/`stderr` sections; DOM text
      contains NO literal ``` and NO `Exit code:` string. See `CtxToolRenderer.test.tsx`.
- [x] 3.2 Chrome-vs-content split (test-plan #F2). Input: any multi-line ctx error card ·
      Trigger: render · Observable: container carries `--severity-error-bg` +
      `--severity-error-border`, label `--severity-error-fg`; the body carries
      `--text-secondary` + `--bg-code` and NO `--severity-` reference and NO `red-<NNN>`.
- [x] 3.3 Error signal redundancy (test-plan #F3). Input: neutral-body error card ·
      Trigger: render · Observable: container fill, container border and text label are
      asserted as three separate DOM facts, so deleting any one turns the test red.
- [x] 3.4 Five single-line surfaces (test-plan #F4). Input: `exit 3` bash badge ·
      `2 failed` burst badge · errored `ToolCallStep` icon · cancelled `ask_user` error
      line · `AgentToolRenderer` `Error:` marker · Trigger: render each · Observable: each
      resolves colour from `--severity-error-fg` (message bodies `--text-secondary`), none
      carries `red-300/400/500/950` with or without an alpha suffix. `AgentToolRenderer`
      has no sibling unit test yet — add one in `tool-renderers/__tests__/` using
      `AskUserToolRenderer.test.tsx` as the exemplar.
- [x] 3.5 receivedArgs block unchanged (test-plan #F5). Input: validation error with
      `receivedArgs` · Trigger: render + expand · Observable: still `--text-secondary` on
      `--bg-code`; no severity class added by this change.
- [x] 3.6 Unstructured fallback renders flat (test-plan #F6). Input: #E5's parsed struct ·
      Trigger: render · Observable: flat `message` verbatim (no text dropped) in
      `--text-secondary` on `--bg-code`; chrome still carries severity; no `exit` badge,
      no empty stream sections.
- [x] 3.7 Partial extraction degrades (test-plan #X2). Input: struct with `command` set but
      `exitCode`/streams `undefined` · Trigger: render · Observable: command block renders,
      badge and sections omitted — never `exit undefined`, never empty labelled sections.
- [x] 3.8 Oversized stream inherits truncation (test-plan #X3). Input: runtime error with a
      5,000-line `stdout` · Trigger: parse + render · Observable: the rendered section
      carries ≤ 200 lines plus a leading `«N earlier lines hidden»` marker via
      `truncateOutputForDisplay` (`packages/client/src/lib/chat/event-reducer.ts:934`), and
      the input's last line is still present. See `BashOutputCard.test.tsx` for the
      existing truncation-marker assertion shape.

## 4. Author the static-guard scenarios (red first)

Exemplar: `scripts/__tests__/check-conventions.test.mjs` — drives the exported rule fns
directly rather than shelling out.

- [x] 4.1 Resolve design Q1: guard in `scripts/check-conventions.mjs` (ship gate) vs a
      Biome rule (`quality:changed`). Record the choice in `design.md`.
- [x] 4.2 Guard decision table (test-plan #E11). Input: (a) `text-red-300` in
      `CtxToolRenderer.tsx`, (b) `bg-red-500/20` in `BashOutputCard.tsx`, (c) `bg-red-600`
      in a non-governed destructive button · Trigger: run the guard rule fn · Observable:
      (a) and (b) FAIL naming file **and line**; (c) PASSES — the alpha suffix is not an
      escape hatch.
- [x] 4.3 Allowlist integrity (test-plan #E12). Input: the ~40 pre-existing raw red
      literals outside the governed set · Trigger: run the guard over the real tree ·
      Observable: zero violations — the guard is scoped to the governed file list.

## 5. Author the in-browser contrast scenarios (red first)

Exemplar: `tests/e2e/severity-contrast.spec.ts` — port its `probe(cls)` helper, which
measures a real SHIPPED class string in-browser; do not invent a new probe.

- [x] 5.1 Seven surfaces clear the floor (test-plan #F7). Input: probes built from the
      shipped class strings of all 7 surfaces · Trigger: 9 themes × {light,dark} sweep with
      `getComputedStyle` · Observable: every surface's resolved fg-on-its-own-bg ≥ 3:1 in
      all 18 combos, including every light cell.
- [x] 5.2 Links legible on `--bg-code` (test-plan #F8). Input: a `LinkifiedText` link
      rendered on `--bg-code` · Trigger: 18 theme·mode sweep · Observable: link colour vs
      resolved `--bg-code` ≥ 3:1 in every combo.
- [x] 5.3 Anti-vacuity guard (test-plan #F9). Input: the same probes as #F7 · Trigger: read
      raw computed values before asserting · Observable: no probe background is
      `rgba(0, 0, 0, 0)` — an unresolvable `var()` would score high against black and pass
      green. Mirrors the existing `--bg-tertiary` check in the same spec.

## 6. Implementation — the ctx error card (the reported symptom)

### 6a. Chrome + neutral body (defects 1–2)
- [x] 6.1 `CtxToolRenderer.tsx:187` — container to
      `bg-[var(--severity-error-bg)] border-[var(--severity-error-border)]`.
- [x] 6.2 `:188` — label to `text-[var(--severity-error-fg)]`.
- [x] 6.3 `:189` — body to `text-[var(--text-secondary)] p-2 bg-[var(--bg-code)] rounded`,
      matching the `receivedArgs` block six lines below. This is the chrome/content split,
      not just a token swap.

### 6b. Split the runtime error into sections (defect 3)
- [x] 6.4 Extend the `runtime` arm of `parseError` to extract
      `{command, language, exitCode, stdout, stderr}`. Keep it pure and React-free.
- [x] 6.5 `CtxToolRenderer` error card — when structured, render `command` through the
      existing `CodeBlock` (syntax-highlighted), an `exit <n>` badge, and each non-empty
      stream as a labelled section. Reuse `CodeBlock`; do NOT add a markdown pipeline.
- [x] 6.6 Unstructured runtime error falls back to the flat neutral body from 6.3. No text
      dropped.

## 7. Implementation — the five single-line surfaces

- [x] 7.1 `ToolBurstGroup.tsx:383` — `N failed` badge to severity bg/fg/border.
- [x] 7.2 `BashOutputCard.tsx:46` — non-zero `exit N` badge to severity bg/fg. Leave the
      success branch (`green-500/20`) alone; it is out of scope and a separate tier.
- [x] 7.3 `ToolCallStep.tsx:149` — errored status icon to `--severity-error-fg`. Leave the
      sibling `sky-400` / `green-400` / `yellow-400` branches alone.
- [x] 7.4 `AskUserToolRenderer.tsx:220-221` — icon to `--severity-error-fg`; message to
      `--text-secondary`. Drop the `/80` alpha: it compounds a low-contrast literal and has
      no purpose once the token is derived.
- [x] 7.5 `AgentToolRenderer.tsx:346` — `Error:` marker to `--severity-error-fg`, the
      message itself to `--text-secondary`.

## 8. Implementation — make the regression impossible

- [x] 8.1 Implement the guard over the governed file allowlist only (per the 4.1 decision).

## 9. Verify

- [x] 9.1 All §2–§5 scenarios green.
- [x] 9.2 `npm test` green; report the red list before touching source if any.
- [x] 9.3 Biome + `tsc --noEmit` clean (`npm run quality:changed`).
- [x] 9.4 `review-code` pass on the diff — six components, two directories.
- [x] 9.5 `doubt-driven-review` on the chrome-vs-content rule before it becomes precedent
      for every future error surface. SKIPPED as moot: the rule shipped in #465 and is
      already precedent; this reopened pass hardened its tests without altering it.
- [x] 9.6 Deploy: client-only change → `npm run build` + `POST /api/restart`.

## 10. Manual QA

- [ ] 10.1 Trigger a failing `ctx_execute` (`exit 3`); confirm the body is no longer a flat
      red wash and reads as code with visible structure, in dark mode
      (test-plan: manual-only).
- [ ] 10.2 Spot-check one non-default theme in both modes; confirm the card reads correctly
      — the numeric part is already gated by §5.1 (test-plan: manual-only).
- [ ] 10.3 Re-open `mockups/tool-error-cards/index.html` side by side with the live chat and
      confirm the AFTER column matches what ships; refresh the mock's stylesheet href if
      the bundle hash rotated (test-plan: manual-only).
