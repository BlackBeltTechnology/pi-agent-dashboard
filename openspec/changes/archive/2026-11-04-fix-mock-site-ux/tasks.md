# Tasks

## 1. Example out of the mock roots

- [x] 1.1 `git mv mockups/2026-11-03-session-pills packages/mockup-loop/examples/2026-11-03-session-pills`; add `examples/` to `packages/mockup-loop/package.json` `files`; `mockups/tsconfig.json` include `../packages/mockup-loop/examples/*/mock.tsx`
- [x] 1.2 Rewrite the example: frames 1–2 keep ring numbers (current 1–2, proposed 1–2); current ring 2 drops the invented ENOENT box; add `why` to each frame; add frame 3 "Re-link flow" with 3 `steps` and a `Tap`
- [x] 1.3 `tests/e2e/mock-site/fixture.ts`: `makeE2eProject()` copies the example from `packages/mockup-loop/examples/`; fixture mock gains a 121-char `why`, a `play: true` 2-step frame, and a `steps`+`current` frame
- [x] 1.4 Docs: `mockups/AGENTS.md` drop the example row; `packages/mockup-loop/AGENTS.md` add `examples/` row; `references/live-mock-site.md` documents `why`, `steps`, `play`, `Tap`, examples

## 2. Kit + shell

- [x] 2.1 `kit.tsx`: `Frame.why`, `Step`, `Frame.steps`, `Frame.play`, `Tap`, `InPlayer` context; `tipsOf` also walks steps
- [x] 2.2 `Site.tsx`: overview cards; `why` under frame title with `WHY > 120`; steps strip with `step-<k>` ref ids; player (Pause/Play, dots, 2.5 s, reduced motion → strip); steps+panes problem; "No mocks yet" empty state; `PhonePane` cached / 240px start height + loading line
- [x] 2.3 `site.css`: chips for pane labels, overview, strip, player, tap pulse, `.mk-ring` inline-flex, phone badge above the ring with pane top padding

## 3. Tests

- [x] 3.1 L1 vitest: example outside mock roots — input repo root · trigger `discoverMocks(repoRoot)` · observable no `2026-11-03-session-pills` entry, example file exists (test-plan #U1); exemplar: `packages/mockup-loop/src/__tests__/mock-site-core.test.ts`
- [x] 3.2 L3 Playwright: steps side by side — input example frame 3 · trigger open `#<example>` · observable 3 `.mk-step` labelled 3a–3c with `step-1..3` ids (test-plan #U2); exemplar: `tests/e2e/mock-site/mock-site.spec.ts` F13
- [x] 3.3 L3 Playwright: step deep link — input example · trigger open `#<example>/3/proposed/step-2` · observable step 2 `mk-hit` + in viewport (test-plan #U3); exemplar: `tests/e2e/mock-site/mock-site.spec.ts` F10
- [x] 3.4 L3 Playwright: animated steps — input fixture `play` frame · trigger wait, Pause, wait · observable one `.mk-scene.on`, advances, stops on Pause (test-plan #U4); exemplar: `tests/e2e/mock-site/mock-site.spec.ts` F2
- [x] 3.5 L3 Playwright: reduced motion — input fixture `play` frame, `reducedMotion: "reduce"` · trigger open · observable no `.mk-player`, `.mk-step` cards render (test-plan #U5); exemplar: `tests/e2e/mock-site/mock-site.spec.ts` F5
- [x] 3.6 L3 Playwright: steps with panes — input fixture steps+current frame · trigger open · observable `.mk-problems` names fixture + frame; steps render (test-plan #U6); exemplar: `tests/e2e/mock-site/mock-site.spec.ts` X7
- [x] 3.7 L3 Playwright: overview — input example · trigger click overview card 2 · observable 3 cards, hash `#<example>/2` (test-plan #U7); exemplar: `tests/e2e/mock-site/mock-site.spec.ts` F12
- [x] 3.8 L3 Playwright: why + lint — input example + fixture · trigger open each · observable `.mk-why` text; `WHY > 120` on fixture (test-plan #U8); exemplar: `tests/e2e/mock-site/mock-site.spec.ts` E20
- [x] 3.9 L3 Playwright: phone badge off ringed text — input example frame 2 current iframe · trigger read boxes · observable badge box ∩ ring box = ∅ (test-plan #U9); exemplar: `tests/e2e/mock-site/mock-site.spec.ts` F4
- [x] 3.10 L3 Playwright: ring no wrap — input example frame 1 current ring 1 · trigger read child boxes · observable pills share one vertical centre ±1px (test-plan #U10); exemplar: `tests/e2e/mock-site/mock-site.spec.ts` P1
- [x] 3.11 L3 Playwright: no mocks — input temp project with mock dirs moved aside · trigger open, restore · observable "No mocks yet" + path pattern, then fixture listed (test-plan #U11); exemplar: `tests/e2e/mock-site/mock-site.spec.ts` F16
- [x] 3.12 Manual: phone pane cold load shows loading line at ≥240px, no blank jump (test-plan: manual-only) (test-plan #U12)
