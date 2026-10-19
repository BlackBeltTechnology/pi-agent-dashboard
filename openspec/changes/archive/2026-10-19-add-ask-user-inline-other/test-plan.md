# Test Plan — add-ask-user-inline-other

Stage: design   Generated: 2026-10-19

Hard gate passed: no unfillable Triple slots. No latency/throughput budget is specified, so there are no performance rows.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | interactive-renderers "Inline Other enablement" (shared predicate) | decision-table | L1 | automated | `allowOther` ∈ {`true`, `false`, absent, `"true"`} × options ∈ {`[]`, `["A","B"]`, `["A","Other (describe)"]`} | `isOtherAllowed({allowOther, options})` | `true` only for (`true`, `["A","B"]`); every other cell `false` |
| E2 | interactive-renderers "Inline Other enablement" rule (own-Other) | EP+BVA | L1 | automated | options `"Other (describe)"`, `"other"`, `" Other: x"`, `"Other — describe"`, `"Other-wise"` vs `"Others"`, `"Otherwise"`, `"Other1"`, `"Otheré"`, `42`, `null` | `hasOwnOtherOption([opt])` per value | first five → `true`; the rest → `false`; non-strings never throw |
| E3 | pending-question-stack REST validation — select | EP+BVA | L1 | automated | select prompt, options `["A","B"]`, `allowOther:true` | `validateQuestionAnswer` with `"C"`, `"A"`, `""`, `"   "`, `" A "`; and `"C"` with `allowOther` absent | `"C"`/`"A"` → `{ok:true}`; `""`, `"   "`, `" A "` → `{ok:false}`; `"C"` without opt-in → `{ok:false}` |
| E4 | pending-question-stack REST validation — multiselect | EP+BVA | L1 | automated | multiselect, options `["A","B"]`, `allowOther:true` | validate `["A","D"]`, `["D"]`, `[]`, `["D","E"]`, `["D","D"]`, `["A","A"]`, `["A"," D"]`; and `["A","D"]` without opt-in | first three ok; the rest `{ok:false}`; `["A","D"]` without opt-in `{ok:false}` |
| E5 | pending-question-stack REST validation — batch + own-Other | decision-table | L1 | automated | batch with select sub (`allowOther:true`), select sub (no opt-in), select sub (`allowOther:true`, options incl. `"Other (describe)"`), confirm, input | custom value `"C"` given to each select sub in turn | only the first sub accepts; the second and third → `{ok:false}` naming `batch[i]`; confirm/input validation unchanged |
| E6 | prompt-answer-response-encoding "Custom answers encode like option answers" | EP | L1 | automated | results `{value:"something else"}`, `{values:["A","D"]}`, `{answers:[{value:"C"},{values:["A","D"]}]}` | `encodePromptAnswer(result,false)` and `encodeDialogAnswer(result)` | `"something else"`; `'["A","D"]'`; `JSON.stringify(answers)` unchanged |
| E7 | bridge-extension "Dialog prompts carry the inline Other opt-in" | decision-table | L1 | automated | opts `{allowOther:true}` alone; `{allowOther:false}`; `{}`; `{pluginMeta:{allowOther:true}}`; `{message:"m",allowOther:true}` | `buildPromptMeta(opts)` | `{allowOther:true}`; `undefined`; `undefined`; `{plugin:{allowOther:true}}` with no top-level key; `{message:"m",allowOther:true}` |
| E8 | bridge-extension opt-in transport + custom pass-through | state (bus round trip) | L1 | automated | patched `ctx.ui.select("Pick",["A","B"],{allowOther:true})` and `ctx.ui.multiselect(...,{allowOther:true})` on a fake bus | bus emits request; test responds `answer:"x"` / `answer:'["A","x"]'` | request `metadata.allowOther === true`; select resolves `"x"`; multiselect resolves `["A","x"]` |
| E9 | ask-user-tool "opts its choices into inline Other" — single dispatch | decision-table | L1 | automated | `ask_user` select / multiselect / confirm / input, each with `allowOther` ∈ {absent, `true`, `false`} | `execute` with stub `ctx.ui` | select/multiselect absent or `true` → opts `allowOther:true`; `false` → no `allowOther:true`; confirm/input never get `allowOther` |
| E10 | ask-user-tool batch fan-out | decision-table | L1 | automated | batch: top-level `allowOther:false`; subs = select (absent), multiselect (`true`), select (`false`), confirm, input | `execute` → `ctx.ui.batch` stub captures `questions` | sub0 no `allowOther`; sub1 `allowOther:true`; sub2 none; confirm/input none; with top-level absent, sub0 gets `allowOther:true` |
| E11 | ask-user-tool rescue (alias + coercion) | EP | L1 | automated | args `{allowCustom:false}`; `{allowOther:"false"}`; `{allowOther:"yes"}`; batch sub `{allowCustom:false}`; `{allowCustom:true, options:["A","B"]}` | `prepareArguments(args)` then `execute` | effective false; false; dropped → default `true`; sub effective false; `allowCustom` absent from normalized args in all cases; options stay `["A","B"]` (no literal appended) |
| E12 | ask-user-tool "result flags custom answers" + MODIFIED result-shape rule | EP | L1 | automated | select over `["A","B"]` answered `"C"` / `"A"`; multiselect `["A","D"]`; batch: select `"C"`, input `"free text"`, confirm `true` | `execute` returns | text exactly `Custom answer (not one of the options).\nUser responded: "C"`, `details.result === "C"`; `User responded: "A"` exactly; `Custom values (not among the options): ["D"].\nUser responded: ["A","D"]`; batch select line ends ` (custom)`, input/confirm lines do not |
| E13 | ask-user-tool ADDED "Flat parameter schema" (+ REMOVED oneOf) | invariant | L1 | automated | serialized `ask_user` parameters schema | inspect root + `questions.items` | both `type:"object"`; no `oneOf`/`anyOf`/`allOf`/`enum`/`not`; `properties.allowOther.type === "boolean"`, not in `required` |
| E14 | pending-question-stack record + REST road | state | L1 | automated | tracked `prompt_request` select with `metadata.allowOther:true` and another without | `onTracked`; `GET /api/questions/:id`; `POST …/answer {answer:"C"}`; persist round trip | detail `allowOther:true` (absent for the other); opted-in → transmitted `answer:"C"` unchanged; other → `400`, question stays open; persisted `QuestionFile` has no `allowOther` key |
| E15 | ask-user-tool "history card shows custom answers" | EP | L1 | automated | toolResult texts: select custom `"C"` (note+line); multiselect `["A","D"]`; multiselect custom `"x User responded: y"`; option `"A"` | render `AskUserToolRenderer` status complete, options `["A","B"]` | chips unhighlighted + Response row `C`; Response row `D` only; Response row exactly `x User responded: y`; chip `A` highlighted and no Response row |
| E16 | interactive-renderers enablement wiring (reducers) | state | L1 | automated | `prompt_request` with `metadata.allowOther:true` / absent | fold through `useMessageHandler` and `useSessionState` | `interactiveUi` params `allowOther === true` / no `allowOther` key |
| E17 | bridge-extension MODIFIED "Bridge registers ask_user tool" | EP | L1 | automated | LLM `ask_user {method:"select", title:"Pick one", options:["A","B"]}` | `execute` | `ctx.ui.select` called with `("Pick one", ["A","B"], opts)` where `opts.allowOther === true` |
| E18 | ask-user-tool MODIFIED "Argument rescue for batch shapes" + "prepareArguments preserves empty-args rejection" | regression | L1 | automated | stringified `questions`; wrapped single question; `input_type` wrapper; explicit batch missing title; empty `{}` | `prepareArguments` then `execute` | synthesized `method:"batch"` + title; dispatch succeeds (no throw); `{}` stays empty (no `method`/`title`/`questions`/`allowOther`); existing rescue tests stay green |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | interactive-renderers "Select prompts offer an inline Other answer" | state-transition | L1 | automated | pending SelectRenderer, options `["A","B"]`, `allowOther:true` | click "Other", type `  something else  `, press Enter | text input has focus after the click; `onRespond` called once with `{value:"something else"}` |
| F2 | same — empty custom | BVA | L1 | automated | Other active, text `""` then `"   "` | press Enter; inspect Submit | Submit `disabled`; `onRespond` not called |
| F3 | same — keyboard + Escape consumed | state-transition | L1 | automated | Other row focused via Tab | Space → type → Escape | field appears focused; after Escape the field is gone, `onRespond` not called, keydown event `defaultPrevented === true` |
| F4 | interactive-renderers enablement (renderer) | decision-table | L1 | automated | SelectRenderer with (a) no `allowOther`, (b) `allowOther:false`, (c) `allowOther:true` + `["Approve","Other (describe)"]`, (d) `allowOther:true` + `["A","B"]` | render; click `"A"` in (d) | inline Other row absent in a/b/c, present in d; in (c) clicking `"Other (describe)"` responds `{value:"Other (describe)"}`; in (d) clicking `"A"` responds `{value:"A"}` immediately |
| F5 | interactive-renderers "Custom answers render as plain text" — select | EP | L1 | automated | resolved SelectRenderer, options `["A","B"]`, value `"C"`; second case value `"<b>x</b> **y**"` | render | A/B unpicked + picked "Other" row text `C`; second case text content equals `<b>x</b> **y**` and no `<b>`/`<strong>` element inside the row |
| F6 | interactive-renderers "Multiselect prompts offer an inline Other answer" | decision-table | L1 | automated | MultiselectRenderer `["A","B","C"]`, `allowOther:true` | (i) check A + Other `"D"`, submit; (ii) only Other `"Z"`; (iii) A + Other `"A"`; (iv) Other checked, empty; (v) Other `"D"` then Select all | (i) `{values:["A","D"]}`, Submit label `(2)`; (ii) `{values:["Z"]}`; (iii) `{values:["A"]}`; (iv) Submit disabled; (v) A/B/C checked, Other still checked with text `D` |
| F7 | interactive-renderers plain-text — multiselect resolved | EP | L1 | automated | resolved MultiselectRenderer `["A","B","C"]`, values `["A","D"]` | render | `A` picked, picked "Other" row `D`, count text `2 of 3` |
| F8 | interactive-renderers "Batch select and multiselect steps offer an inline Other answer" | state-transition | L1 | automated | BatchRenderer: step0 select `["A","B"]` (`allowOther:true`), step1 multiselect `["A","B"]` (`allowOther:true`), step2 select (no opt-in), step3 confirm, step4 input | step0 Other `"C"` → Next → Back → Next; step1 A + Other `"D"`; step0 Other empty attempt; Review → Submit all | after Back, step0 shows Other with `C`; Next disabled while empty; step2/3/4 show no Other row; Review shows `C` and pills `A`,`D`; `onRespond({answers:[{value:"C"},{values:["A","D"]},…]})` |
| F9 | interactive-renderers "Escape inside the question dialog collapses Other only" + dialog wiring | state-transition | L1 | automated | QuestionDialog detail: select `["A","B"]`, `allowOther:true` | click Other, type `C`, Escape; Escape again; reopen, type `C`, Enter | first Escape: field gone, dialog still mounted; second Escape: `onClose` called; Enter posts answer body `{answer:"C"}` |
| F10 | interactive-renderers i18n of new strings | invariant | L1 | automated | new keys for "Other", field label, resolved "Other" label | `node scripts/i18n-parity.mjs` + `node scripts/i18n-lint.mjs` (exemplar test `packages/client/src/__tests__/i18n-folder-missing.test.ts`) | both scripts exit 0; keys present in `i18n-hu.ts` and `i18n-zh-CN.ts`; no hardcoded English in the new component |
| F11 | end-to-end chat card round trip | state-convergence | L3 | automated | faux session `[[faux:ask-select-roundtrip]]` (dashboard `ask_user`, opted in by default) | in the inline card click "Other", type `zeta`, Enter | transcript converges to `/you picked[\s\S]*"zeta"/`; card resolves showing picked "Other" row `zeta` |
| F12 | end-to-end pending-question dialog road | state-convergence | L3 | automated | hidden faux session `[[faux:ask-select-roundtrip]]` | pill → panel → "Answer here" → dialog Other `zeta` → submit | pill count −1; hidden run transcript `/you picked[\s\S]*"zeta"/` |
| F13 | accessibility look & feel | subjective | — | manual-only | Other row + field in base dark/light + one non-base theme, with VoiceOver | human tabs through and listens | [judgment: label announced as "Other answer", focus ring visible, row spacing matches option rows] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | pending-question-stack REST validation (new client vs stale server) | fault-injection (abort) | L1 | automated | `POST /api/questions/:id/answer` mocked to `400 {error:"answer is not one of the options"}` | QuestionDialog submits Other `C` | dialog stays open, error text visible, question not removed from stack |
| X2 | shared predicate robustness | fault-injection (bad input) | L1 | automated | batch sub-question options `[1, 2]` (numbers) with `allowOther:true`; top-level select options `[1,"A"]` | `validateQuestionAnswer` and SelectRenderer render | no throw; validator returns `{ok:false}` / `{ok:true}` deterministically (no 500); renderer mounts |
| X3 | bridge-extension "Default emits nothing" (non-opted callers byte-identical) | regression | L1 | automated | path-gate approval select and ACP permission frame (no `allowOther`) | build request metadata / frame | `metadata` has no `allowOther` key; REST custom answer to such a prompt → `400` |

---

## Coverage summary

- Requirements covered: 18/18. interactive-renderers (5 ADDED), prompt-answer-response-encoding (1 ADDED), ask-user-tool (4 ADDED + 3 MODIFIED + 1 REMOVED), bridge-extension (1 ADDED + 1 MODIFIED), pending-question-stack (1 MODIFIED). The REMOVED requirement is covered by E13.
- Scenarios by class: edge 18 · perf 0 · frontend 13 · error 3
- Scenarios by level: L1 31 · L2 0 · L3 2 · — 1
- Scenarios by disposition: automated 33 · manual-only 1

## New infra needed

- None. L3 reuses the faux `ask-select-roundtrip` fixture and the hidden-session helper from `tests/e2e/faux-ask.spec.ts`. Its follow-up turn echoes the tool result text (`you picked <tool text>`), which already contains `User responded: "zeta"`.
