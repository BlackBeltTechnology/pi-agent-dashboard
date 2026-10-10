## 1. Repair module tests first (L1, write failing; exemplar for all: packages/client/src/lib/preview/__tests__/adoc-math.test.ts; new file packages/client/src/lib/preview/__tests__/mermaid-repair.test.ts, fixtures ported from ~/.pi/agent/skills/mermaid-md-doctor/tests/broken.md plus new R1/R7 cases, the `&gt;` block reclassified as valid-no-repair)

- [x] 1.1 R1 test: input BOM-prefixed, U+200C-containing and leading-`mermaid`-line sources · trigger repairMermaid · observable BOM/U+200C removed, `mermaid` line dropped, applied = ["R1"] (test-plan #E1); verify it fails before 2.1
- [x] 1.2 R2 test: input `participant end` + `Alice->>end: hi` · trigger repair · observable declaration and message renamed to `p_end`, applied includes R2 (test-plan #E2); verify it fails
- [x] 1.3 R2 terminator test: input `participant end`, `alt ok`, `end->>Alice: y`, bare `end` · trigger repair · observable message alias renamed, bare `end` line byte-identical (test-plan #E3); verify it fails
- [x] 1.4 R2 collision test: input declares both `end` and `p_end` · trigger repair · observable alias becomes `p_end_2`, no duplicate participant ids (test-plan #E4); verify it fails
- [x] 1.5 R3 boundary test: input unclosed `alt`; unclosed `alt`+`loop`; surplus `end` at depth 0 · trigger repair · observable 1 / 2 `end` lines appended, surplus removed, applied includes R3 (test-plan #E5); verify it fails
- [x] 1.6 R6 test: input erDiagram attribute `DomainModels$String Name` · trigger repair · observable `String Name`, applied = ["R6"] (test-plan #E6); verify it fails
- [x] 1.7 R4 test: input `A -->|(empty)| B` and `A -->|yes| B -->|no| C` · trigger repair then repair again · observable `|"(empty)"|`, `A -->|"yes"| B -->|"no"| C`, second pass applied = [] (test-plan #E7); verify it fails
- [x] 1.8 R4 quoted-pipes test: input `A["a|b|c"] --> B(x (y))` · trigger repair · observable `A["a|b|c"]` byte-identical (test-plan #E8); verify it fails
- [x] 1.9 R5 trailing-context test: input `A[call X (commit)] --> B`, `A[call X (commit)]-->B`, label at EOL, `B{a > b}` · trigger repair · observable each label quoted, edge operator preserved (test-plan #E9); verify it fails
- [x] 1.10 R5 quoted-guard test: input `A["x(y;)"] --> B[z (w)]` · trigger repair twice · observable only `B` quoted, `A` unchanged on both passes (test-plan #E10); verify it fails
- [x] 1.11 R7 entity test: input `A["say #quot;hi#quot;; no #1"]` · trigger repair · observable `;`→`,`, `#1`→`no.1`, `#quot;` unchanged (test-plan #E11); verify it fails
- [x] 1.12 Kind-detection decision-table test: input frontmatter+flowchart, `flowchart-elk`, `%%`-first, erDiagram with bracket text · trigger repair · observable flowchart rules fire on first three only (test-plan #E12); verify it fails
- [x] 1.13 Purity/idempotence property test: input every fixture + 200 seeded-random strings over `[]()|"{};#-> \nA-Z` with `graph TD`/`sequenceDiagram` headers · trigger repair(repair(x)) and repair(x) twice · observable second pass applied = [] and code unchanged; repeat calls deep-equal (test-plan #E13); verify it fails
- [x] 1.14 Perf near-limit test (timed): input 50 000-char failing flowchart of repeated `A[x (y)] -->|z| B` lines · trigger repairMermaid · observable median of 5 runs (after 1 warm-up) < 100 ms (test-plan #P1); verify it fails
- [x] 1.15 Perf pathological test (timed): input one 50 000-char line alternating `[`, `(`, `|`, `"` after `graph TD` · trigger repairMermaid · observable median of 5 runs < 100 ms (test-plan #P2); verify it fails

## 2. Repair module implementation

- [x] 2.1 Implement `packages/client/src/lib/preview/mermaid-repair.ts` exporting `repairMermaid(code) → { code, applied: RuleId[] }` and `RuleId` (`"R1"`…`"R7"`, no R8) per design D2; verify 1.1–1.15 pass (`npx vitest run mermaid-repair`)
- [x] 2.2 Extract the inline `mermaid.initialize` literal into `mermaidConfig(resolved)` in new React-free `packages/client/src/components/preview/mermaid-config.ts`; MermaidBlock uses it; verify existing MermaidBlock tests pass
- [x] 2.3 Real-parse fixture test: input every repaired fixture · trigger real mermaid (node_modules) `initialize(mermaidConfig("light"))` then `parse` · observable original rejects, repaired resolves (test-plan #E16); first confirm real mermaid imports under the client jsdom env, else use `// @vitest-environment node` and record it in design.md Risks; exemplar packages/client/src/lib/preview/__tests__/adoc-math.test.ts; verify it passes

## 3. MermaidBlock tests first (L1, write failing; exemplar for all: packages/client/src/components/__tests__/MermaidBlock.test.tsx — extend this suite, mocked mermaid)

- [x] 3.1 Render-flow decision-table test: input mocked render ok / fail+no-rule / fail+rule+ok / fail+rule+fail · trigger mount · observable SVG no badge 1 call / original error 1 call / SVG + badge R4, 2 calls, 2nd id ends `-r` / original error from call 1, 2 calls (test-plan #E14); verify it fails
- [x] 3.2 Streaming test: input invalid code with `complete={false}` · trigger mount · observable 0 render calls, 0 repair calls, loading placeholder (test-plan #E15); verify it passes already (guards regression)
- [x] 3.3 Cached repaired remount test: input repairable code · trigger mount, unmount, remount · observable SVG + badge immediately, no loading text, render call count unchanged (test-plan #F1); verify it fails
- [x] 3.4 Cached error remount test: input unrepairable code · trigger mount, unmount, remount · observable error immediately, no loading text, call count unchanged (test-plan #F2); verify it fails
- [x] 3.5 Show-original-after-remount test: input cached repairable code · trigger remount then click show original · observable raw `code` prop text + original error message (test-plan #F3); verify it fails
- [x] 3.6 Hidden-from-keyboard test: input focused repaired diagram · trigger click show original · observable viewport `hidden`, `focused` false, no tabbable element in viewport, toggle `aria-pressed="true"` (test-plan #F4); verify it fails
- [x] 3.7 Zoom-survives-toggle test: input repaired diagram zoomed to 2×, `ResizeObserver` stub capturing its callback, per-element `getBoundingClientRect` returning 0×0 while `hidden` · trigger show original, fire RO callback, toggle back · observable scale 2× and translate unchanged (test-plan #F5); verify it fails
- [x] 3.8 Fitted-scale-survives-toggle test: input never-zoomed repaired diagram with fit 0.6, same stubs · trigger show original, fire RO with 0×0, toggle back · observable scale 0.6, not 1 (test-plan #F6); verify it fails
- [x] 3.9 Outcome-change test: input repaired diagram with original view open · trigger rerender with valid code; separately switch theme · observable original view closed; valid → no badge; theme → badge + diagram shown (test-plan #F7); verify it fails
- [x] 3.10 A11y description test: input diagram repaired with R4, R5 · trigger render · observable each code element's `aria-describedby` resolves to non-empty localized text (test-plan #F8); verify it fails
- [x] 3.11 Unmount-during-repair race test: input first render rejects, second render held on a manual promise · trigger unmount, then resolve · observable no React act/state warning, cache holds repaired outcome, next mount shows it without render (test-plan #F10); verify it fails
- [x] 3.12 Copy-fixed test: input indented, entity-encoded repairable source · trigger click copy fixed · observable clipboard text equals dedented, decoded, repaired source (test-plan #F11); verify it fails
- [x] 3.13 Unrepairable test: input `unknownDiagram\nA-->B` · trigger mount · observable raw code + original error, no badge, 1 render call (test-plan #X1); verify it fails or passes for the right reason
- [x] 3.14 Retry-fails test: input mocked render throws `E1` then `E2` · trigger mount · observable displayed error is `E1`, never `E2` (test-plan #X2); verify it fails
- [x] 3.15 Repair-throws test: input `repairMermaid` mocked to throw · trigger mount invalid code · observable original error display, no unhandled rejection (test-plan #X3); verify it fails

## 4. MermaidBlock implementation

- [x] 4.1 Replace `_svgCache`/`_errorCache` with one `MermaidOutcome` cache (`ok | repaired{svg,code,applied,error} | error`) keyed on original code+themeId, global clear on theme re-init kept; update tests that imported the old maps; export the `MermaidOutcome` type; verify existing tests pass and `npm run lint` passes
- [x] 4.2 Implement fail→repair→re-render inside the queued `renderMermaid` (retry id `<id>-r`, defensive `#d<id>` cleanup after each attempt, error always from the original attempt, repair exceptions caught); verify 3.1, 3.11, 3.13–3.15 pass
- [x] 4.3 Add the zero-rect early return to the fit `measure()` (today it always calls `setFit`; `computeFitScale` returns 1 for 0×0); verify 3.7, 3.8 pass
- [x] 4.4 Add the badge row (R-codes with `aria-describedby` → visually-hidden localized descriptions + `title`; show-original toggle with `aria-pressed` that sets viewport `hidden`, clears `focused`, resets on `code`+`themeId` change; copy-fixed via `CopyButton`) using theme tokens; verify 3.3–3.10, 3.12 pass

## 5. i18n

- [x] 5.1 Add badge/toggle/copy label keys and the seven rule descriptions to `packages/client/src/lib/i18n/i18n.tsx` (zh-CN) and `packages/client/src/lib/i18n/i18n-hu.ts` (English at call-site fallbacks; touch `packages/client/src/lib/i18n-en-source.json` only if the key-migration flow requires it)
- [x] 5.2 Catalog-parity test: input the new keys · trigger per-change key sweep in packages/client/src/__tests__/i18n.test.ts (exemplar: its existing per-change sweeps) plus `node scripts/i18n-parity.mjs` · observable every new key present in zh-CN and hu, parity script exit 0 (test-plan #X4); verify it passes

## 6. Browser E2E (L3)

- [x] 6.1 Every-surface e2e: input docker-harness fixtures — a chat message with `participant end` + `alt…end`, a `.md` with `A[call (x)]-->B`, an `.adoc` `[source,mermaid]` and a `.mmd` with the same · trigger open each surface · observable each shows a rendered `svg` in `.mermaid-diagram` plus a badge listing the rule codes and no error block (test-plan #F9); exemplar tests/e2e/mermaid-stability.spec.ts (file-viewer case) and tests/e2e/asciidoc-preview.spec.ts; harness port from `.pi-test-harness.json`; verify it passes via `npm run test:e2e -- mermaid-repair`

## 7. Docs, out-of-band, verification

- [x] 7.1 Update `packages/client/src/components/preview/MermaidBlock.tsx.AGENTS.md`, add rows for `mermaid-repair.ts` (`packages/client/src/lib/preview/AGENTS.md`) and `mermaid-config.ts` (`packages/client/src/components/preview/AGENTS.md`), add a row for the new e2e spec in `tests/e2e/AGENTS.md` (See change: add-mermaid-auto-repair); verify rows present
- [x] 7.2 Out-of-band (outside the repo, not covered by repo gates or rollback): in `~/.pi/agent/skills/mermaid-md-doctor/` backport design D2 deviations to `fix.py`, fix its module docstring and the stale `check.mjs` header comment, add R1/R7 cases to `tests/broken.md`, note the TS twin in SKILL.md; verify with a python snippet importing `fix_block` over each fixture block that rule codes match the TS port
- [x] 7.3 Run full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and `npm run quality:changed`; verify green
- [x] 7.4 Manual: badge legibility and layout in dark + light theme, narrow chat bubble and wide file preview — badge readable, not crowding the diagram, theme-token colors (test-plan: manual-only, #F12) **DEFERRED — not yet run**
