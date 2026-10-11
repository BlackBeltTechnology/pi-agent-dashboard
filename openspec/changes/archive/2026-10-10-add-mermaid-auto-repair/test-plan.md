# Test Plan — add-mermaid-auto-repair

Stage: design   Generated: 2026-10-08

Hard gate cleared: C1 (repair perf budget) answered by user — < 100 ms for 50 000 chars, folded into spec `Repair is bounded in time`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Rule set — R1 | EP | L1 | automated | `"\ufeffgraph TD\nA-->B"`, `"graph TD\nA\u200c-->B"`, `"mermaid\ngraph TD\nA-->B"` | `repairMermaid(src)` | BOM / U+200C removed, leading `mermaid` line dropped; `applied` = `["R1"]` |
| E2 | Rule set — R2 | EP | L1 | automated | `sequenceDiagram\nparticipant end\nAlice->>end: hi` | repair | declaration + message renamed to `p_end`; `applied` includes `R2` |
| E3 | Rule set — R2 terminator | EP (boundary) | L1 | automated | `sequenceDiagram\nparticipant end\nalt ok\nend->>Alice: y\nend` | repair | message alias renamed, final bare `end` line byte-identical; output passes `mermaid.parse` |
| E4 | Rule set — R2 collision | EP | L1 | automated | sequence with `participant end` AND `participant p_end` | repair | alias renamed to `p_end_2`; no duplicate participant ids |
| E5 | Rule set — R3 | BVA (depth 0/1/2, surplus) | L1 | automated | `alt` unclosed; `alt`+`loop` unclosed; one surplus `end` at depth 0 | repair | 1 / 2 `end` lines appended; surplus `end` removed; `applied` includes `R3` |
| E6 | Rule set — R6 | EP | L1 | automated | `erDiagram\nA {\n  DomainModels$String Name\n}` | repair | attribute line becomes `String Name`; `applied` = `["R6"]` |
| E7 | Rule set — R4 single + double label | EP | L1 | automated | `A -->|(empty)| B`; `A -->|yes| B -->|no| C` | repair, then repair again | `|"(empty)"|`; `A -->|"yes"| B -->|"no"| C`; second pass `applied` = `[]` |
| E8 | Rule set — R4 quoted pipes | EP | L1 | automated | `flowchart TD\nA["a|b|c"] --> B(x (y))` | repair | `A["a|b|c"]` byte-identical in output |
| E9 | Rule set — R5 trailing contexts | EP | L1 | automated | `A[call X (commit)] --> B`, `A[call X (commit)]-->B`, `A[call X (commit)]` at EOL, `B{a > b}` | repair | each label wrapped in `"…"`; edge operator after `]` preserved |
| E10 | Rule set — R5 quoted guard | EP | L1 | automated | `A["x(y;)"] --> B[z (w)]` | repair twice | first pass quotes only `B`; `A` label unchanged on both passes |
| E11 | Rule set — R7 + entities | EP | L1 | automated | `A["say #quot;hi#quot;; no #1"]` in failing flowchart | repair | `;`→`,`, `#1`→`no.1`, both `#quot;` unchanged |
| E12 | Rule set — kind detection | decision-table (frontmatter × kind) | L1 | automated | frontmatter+flowchart; `flowchart-elk`; `%%` comment first; erDiagram with `A[x (y)]`-like text | repair | flowchart rules fire for first three; no flowchart rule fires on erDiagram |
| E13 | Pure + idempotent | property (curated + adversarial) | L1 | automated | every fixture + 200 seeded-random strings over alphabet `[]()|"{};#-> \nA-Z` prefixed by `graph TD` / `sequenceDiagram` | `r1 = repair(x)`, `r2 = repair(r1.code)`; repeat `repair(x)` | `r2.applied = []`, `r2.code === r1.code`; two `repair(x)` calls deep-equal |
| E14 | Repair runs only on failed renders | decision-table (render ok/fail × rules apply/none × retry ok/fail) | L1 | automated | mocked `mermaid.render`: ok; fail+no rule; fail+rule+ok; fail+rule+fail | mount `MermaidBlock` | ok → SVG, no badge, 1 render call; fail/no-rule → original error, 1 call; fail/rule/ok → SVG + badge `R4`, 2 calls, 2nd id ends `-r`; fail/rule/fail → original error text (from call 1), 2 calls |
| E15 | Streaming not repaired | state | L1 | automated | `complete={false}` with invalid code | mount | 0 render calls, 0 repair calls, loading placeholder |
| E16 | Repaired fixtures really parse | EP | L1 | automated | every repaired fixture | real mermaid (node_modules) `initialize(mermaidConfig("light"))` → `parse` | original rejects, repaired resolves (catches vacuous fixtures) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Repair is bounded in time — near-limit | threshold (timed unit) | L1 | automated | failing flowchart, 50 000 chars (repeated `A[x (y)] -->|z| B` lines) | `repairMermaid` wall time < 100 ms | median of 5 runs after 1 warm-up |
| P2 | Repair is bounded in time — pathological | threshold (backtracking) | L1 | automated | single 50 000-char line alternating `[`, `(`, `|`, `"` after `graph TD` | `repairMermaid` wall time < 100 ms | median of 5 runs after 1 warm-up |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Cache — repaired remount | state-transition | L1 | automated | repairable code, theme fixed | mount → unmount → remount | remount shows SVG + badge immediately, no loading text, render call count unchanged |
| F2 | Cache — error remount | state-transition | L1 | automated | unrepairable code | mount → unmount → remount | error shown immediately, no loading text, render call count unchanged |
| F3 | Show original after remount | state-transition | L1 | automated | repairable code, cached | remount → click "show original" | raw `code` prop text + original error message (from first render) displayed |
| F4 | Show original hides diagram from keyboard | state | L1 | automated | repaired diagram, focused (zoom controls visible) | click "show original" | viewport has `hidden` attr; `focused` false; no element inside viewport matches tabbable selector; toggle has `aria-pressed="true"` |
| F5 | Toggle keeps zoom (zero-rect guard) | state-transition | L1 | automated | repaired diagram, zoomed to 2×; `ResizeObserver` stub + per-element `getBoundingClientRect` returning 0×0 while `hidden` | show original → RO callback fired → toggle back | scale still 2×, translate unchanged |
| F6 | Toggle keeps fitted scale | state-transition | L1 | automated | repaired diagram never zoomed, fit = 0.6; same stubs as F5 | show original → RO fires 0×0 → toggle back | scale still 0.6 (not 1) |
| F7 | Outcome change closes original view | state-transition | L1 | automated | repaired diagram with original view open | rerender with valid `code`; separately: switch theme | original view closed; valid → no badge; theme → badge visible, diagram shown |
| F8 | Accessible rule descriptions | a11y | L1 | automated | repaired with R4, R5 | render | each code element has `aria-describedby` resolving to non-empty localized text |
| F9 | Every surface repairs | integration (per surface) | L3 | automated | docker harness fixture files: chat message with `participant end` + `alt…end`; `.md` with `A[call (x)]-->B`; `.adoc` `[source,mermaid]` with same; `.mmd` with same | open each surface | each shows a rendered `svg` inside `.mermaid-diagram` and a badge listing the rule codes; no error block |
| F10 | Unmount during repair | race | L1 | automated | first render rejects, second render deferred (manual promise) | unmount before second resolves, then resolve | no React act/state warning; cache holds `repaired` outcome; next mount shows it without render |
| F11 | Copy fixed | state | L1 | automated | repaired diagram from indented, entity-encoded source | click copy-fixed | clipboard text = normalized + repaired source (dedented, decoded) |
| F12 | Badge legibility + layout | visual | — | manual-only | badge row in dark + light theme, narrow chat bubble and wide preview | human looks | [judgment: badge readable, does not crowd the diagram, matches theme tokens] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Unrepairable keeps error display | fault (no rule) | L1 | automated | `unknownDiagram\nA-->B` | mount | raw code + original error; no badge; 1 render call |
| X2 | Repair still fails | fault (retry throws) | L1 | automated | mocked render throws `E1` then `E2` | mount | displayed error text is `E1` (never `E2`) |
| X3 | Repair throws internally | fault (defensive) | L1 | automated | `repairMermaid` mocked to throw | mount invalid code | original error display; no unhandled rejection |
| X4 | i18n catalog parity | contract | L1 | automated | new badge/toggle/copy/rule-description keys | `i18n.test.ts` key sweep + `node scripts/i18n-parity.mjs` | every new key present in zh-CN and hu; parity script exit 0 |

---

## Coverage summary

- Requirements covered: 10/10 (mermaid-rule-repair: 7; mermaid-diagram MODIFIED: 3)
- Scenarios by class: edge 16 · perf 2 · frontend 12 · error 4
- Scenarios by level: L1 32 · L2 0 · L3 1 · manual 1
- Scenarios by disposition: automated 33 · manual-only 1

## New infra needed

- none (L3 F9 extends the existing mermaid e2e specs; harness port read from `.pi-test-harness.json`)
