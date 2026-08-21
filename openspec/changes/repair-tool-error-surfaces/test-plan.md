# Test Plan — repair-tool-error-surfaces

Stage: apply   Generated: 2026-08-21

## Clarifications — resolved during planning

- **C1** (F8) — link colour vs `--bg-code` SHALL clear **≥ 3:1 in all 18 theme·mode
  combos**, measured by the same in-browser probe as F7.
- **C2** (E10) — with more than one fenced block, the **FIRST** fence becomes `command`;
  every remaining fence stays **verbatim** in `message`/`stdout`. No text is dropped and
  no second `CodeBlock` is synthesised.
- **C3** (X3) — the stream sections **inherit the existing renderer truncation**:
  `truncateOutputForDisplay()` (`packages/client/src/lib/chat/event-reducer.ts:934`,
  last 200 lines + `«N earlier lines hidden»` marker), the same helper `BashOutputCard`
  already uses. No new cap is introduced, so there is no separate perf threshold — the
  former `P1` row is folded into **X3** as a bounded-render assertion.

---

## Scenarios

### Edge-case

Parser grammar for the runtime-error execution shape (`tool-renderers` §ctx result
parser). Exemplar for every L1 row here:
`packages/client/src/components/tool-renderers/__tests__/parse-ctx-result.test.ts`
(+ fixtures in `parse-ctx-result.fixtures.ts`).

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | ctx result parser — structured runtime error | EP (nominal) | L1 | automated | `isError=true`, body = ` ```shell\ngrep foo\n``` ` + `Exit code: 1` + `stdout:` block + `stderr:` block | `parseCtxResult("ctx_execute", body, true)` | returns `{kind:"error",variant:"runtime",command:"grep foo",language:"shell",exitCode:1,stdout:<text>,stderr:<text>}` |
| E2 | ctx result parser | decision-table (streams absent) | L1 | automated | fenced block + `Exit code: 2`, no `stdout:` / `stderr:` sections | parser runs | `command`+`exitCode:2` set; `stdout`/`stderr` `undefined` (NOT `""`); no throw |
| E3 | ctx result parser | BVA (falsy boundary) | L1 | automated | `isError=true` body with `Exit code: 0` | parser runs | `exitCode === 0` (not `undefined`); renderer shows an `exit 0` badge — the falsy-zero path must not collapse to "no exit code" |
| E4 | ctx result parser | BVA (invalid just-outside) | L1 | automated | `Exit code: null` / `Exit code:` with no number | parser runs | `exitCode` `undefined`, no throw, full original text still reachable via `message` |
| E5 | ctx result parser — unstructured fallback | EP (invalid class) | L1 | automated | plain sentence, no fence, no exit line | parser runs | `{variant:"runtime"}` with `command`/`language`/`exitCode`/`stdout`/`stderr` all `undefined`, `message` === input verbatim |
| E6 | ctx result parser — no throw on partial | fault-injection (truncated input) | L1 | automated | opening ` ```shell ` fence with NO closing fence, body cut mid-stream | parser runs | does not throw; every byte of the input is still reachable through the returned struct (`command`+streams+`message` union loses no text) |
| E7 | ctx result parser — banner strip × new fields | pairwise (existing rule × new rule) | L1 | automated | `⚠️ context-mode v… outdated …` line prepended to the full E1 body | parser runs | banner stripped AND all five structured fields extracted exactly as E1 — the strip must run before shape detection |
| E8 | ctx result parser — language slot | EP (boundary: absent optional) | L1 | automated | bare ` ``` ` fence, no language token, + `Exit code: 1` | parser runs | `command` set, `language` `undefined`; card renders `CodeBlock` with no highlighting and does not crash |
| E9 | ctx result parser — delimiter injection | adversarial EP | L1 | automated | `stdout:` section whose OWN text contains a line reading `stderr:` and a line reading `Exit code: 7` | parser runs | split happens at the real section boundaries only; the injected lines stay inside `stdout`; `exitCode` is the real one, not `7` |
| E10 | ctx result parser — multi-fence body | decision-table | L1 | automated | body with two fenced blocks + an exit line | parser runs | the FIRST fence becomes `command`; the second fence's text (fence markers included) survives verbatim in `message`/`stdout`; exactly one `CodeBlock` is synthesised and no input byte is dropped |
| E11 | no-raw-literals static guard | decision-table (3 combos) | L1 | automated | (a) `text-red-300` added to `CtxToolRenderer.tsx`; (b) `bg-red-500/20` added to `BashOutputCard.tsx`; (c) `bg-red-600` in a non-governed destructive button | run the guard rule fn | (a) and (b) FAIL and name the file **and line**; (c) PASSES — the alpha suffix must not be an escape hatch. Exemplar: `scripts/__tests__/check-conventions.test.mjs` (drives exported rule fns directly) |
| E12 | no-raw-literals static guard — allowlist integrity | EP (negative sweep) | L1 | automated | the ~40 pre-existing raw red literals outside the governed set | run the guard over the real tree | zero violations reported — the guard is scoped to the governed file list, so it cannot be "turned off within a week" |

### Frontend-quirk

Rendered-DOM invariants. L1 exemplars:
`tool-renderers/__tests__/CtxToolRenderer.test.tsx`,
`components/__tests__/{ToolBurstGroup,BashOutputCard,ToolCallStep}.test.tsx`,
`tool-renderers/__tests__/AskUserToolRenderer.test.tsx`.
L3 exemplar: `tests/e2e/severity-contrast.spec.ts` (its `probe(cls)` helper measures a
real class string in-browser; port that shape rather than inventing a new probe).

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | CtxToolRenderer — structured sections | state-transition (parse kind → layout) | L1 | automated | E1's parsed struct | render the error card | DOM contains a `CodeBlock` node carrying `grep foo`, an `exit 1` badge, and labelled `stdout` / `stderr` sections; DOM text contains NO literal ` ``` ` and NO `Exit code:` string |
| F2 | Severity styles the chrome, not the body | invariant assertion | L1 | automated | any multi-line ctx error card | render | container class set includes `--severity-error-bg` + `--severity-error-border`; label includes `--severity-error-fg`; the body element includes `--text-secondary` + `--bg-code` and contains NO `--severity-` reference and NO `red-<NNN>` literal |
| F3 | Error signal survives a neutral body | invariant assertion (redundancy) | L1 | automated | neutral-body error card | render | at least three distinct error channels are present simultaneously: container fill, container border, and a text label — asserted as three separate DOM facts, so deleting any one turns the test red |
| F4 | Single-line surfaces take the accent directly | decision-table (5 surfaces) | L1 | automated | `exit 3` bash badge · `2 failed` burst badge · errored `ToolCallStep` icon · cancelled `ask_user` error line · `AgentToolRenderer` `Error:` marker | render each | each element resolves its colour from `--severity-error-fg` (message bodies on `--text-secondary`), and none carries `red-300/400/500/950` with or without an alpha suffix |
| F5 | Collapsed receivedArgs block unchanged | regression pin | L1 | automated | validation error with `receivedArgs` | render + expand | the block still uses `--text-secondary` on `--bg-code`; no severity class added by this change |
| F6 | Unstructured runtime error falls back | state-transition (illegal edge) | L1 | automated | E5's parsed struct | render the error card | flat `message` body rendered verbatim (no text dropped) in `--text-secondary` on `--bg-code`; chrome still carries the severity signal; no `exit` badge, no empty stream sections |
| F7 | Tool-result surfaces clear the 3:1 floor | in-browser contrast sweep | L3 | automated | probe elements built from the SHIPPED class strings of all 7 surfaces | apply each of the 9 themes × {light,dark} and read `getComputedStyle` | every surface's resolved fg-on-its-own-bg ≥ 3:1 in all 18 combos, **including every light cell** (ctx body's current 1.24:1 is the canary) |
| F8 | Links legible on the new body background | contrast probe | L3 | automated | a `LinkifiedText` link rendered on `--bg-code` | 18 theme·mode sweep | link colour vs resolved `--bg-code` ≥ 3:1 in every combo (same probe + anti-vacuity check as F7/F9) — links previously sat on a red tint |
| F9 | Contrast gate cannot pass vacuously | anti-vacuity guard | L3 | automated | the same probes as F7 | read raw computed values before asserting | every probe's resolved background is NOT `rgba(0, 0, 0, 0)` — an unresolvable `var()` would score as high contrast against black and pass green (this failure mode is already guarded for `--bg-tertiary` in the same spec) |
| F10 | Body reads as code, not a red wash | visual/subjective | — | manual-only | live failing `ctx_execute` (`exit 3`) | human looks in dark mode | [judgment: "no longer a flat red wash, structure is readable" — no automatable observable] |
| F11 | Non-default theme spot check | visual/subjective | — | manual-only | one non-default theme, both modes | human looks | [judgment: card reads correctly; the numeric part is already gated by F7] |
| F12 | Mock matches what ships | visual/subjective | — | manual-only | `mockups/tool-error-cards/index.html` beside the live chat | human compares | [judgment: AFTER column matches the shipped card; refresh the stylesheet href if the bundle hash rotated] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Parser never throws on malformed input | fault-injection (fuzz) | L1 | automated | a table of mangled bodies: empty string, only a fence, only `Exit code:`, CRLF line endings, non-UTF8-ish control chars, 0-length streams | parser runs on each | no throw for any case; every case returns a `{kind:"error"}` struct whose `message` retains the input text |
| X2 | Renderer degrades with the parser | fault-injection (abort mid-shape) | L1 | automated | struct with `command` set but `exitCode`/streams `undefined` (partial extraction) | render | card renders the command block and omits the badge/sections rather than rendering `exit undefined` or empty labelled sections |
| X3 | Oversized stream output inherits truncation | volume/fault-injection | L1 | automated | a runtime error whose `stdout` is 5,000 lines | parse + render the card | the rendered stream section carries ≤ 200 lines plus a leading `«N earlier lines hidden»` marker (via `truncateOutputForDisplay`, `event-reducer.ts:934`) — the section is bounded, not an unbounded DOM dump; the last line of the input is still present (trailing-signal rule) |

---

## Coverage summary

- Requirements covered: 5/5 (`message-severity-tokens`: no-raw-literals enrolment,
  chrome-vs-content, contrast gate; `tool-renderers`: ctx result parser, CtxToolRenderer)
- Scenarios by class: edge 12 · perf 0 (folded into X3) · frontend 12 · error 3
- Scenarios by level: L1 20 · L2 0 · L3 3 · manual-only 3
- Scenarios by disposition: automated 24 · manual-only 3
- Blocked by a clarification: none (C1–C3 resolved during planning)

## New infra needed

None. Every row extends an existing harness:
`parse-ctx-result.test.ts`, `CtxToolRenderer.test.tsx`,
`{ToolBurstGroup,BashOutputCard,ToolCallStep,AskUserToolRenderer}` unit tests,
`scripts/__tests__/check-conventions.test.mjs`, and
`tests/e2e/severity-contrast.spec.ts`. `AgentToolRenderer` has no sibling unit test
yet — F4's agent cell adds the first one in the existing `tool-renderers/__tests__/`
directory, using `AskUserToolRenderer.test.tsx` as the exemplar.
