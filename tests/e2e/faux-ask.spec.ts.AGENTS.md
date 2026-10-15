# faux-ask.spec.ts — index

Playwright spec. Sends `[[faux:ask-select]]` via `sendPrompt`. Asserts interactive select widget mounts (option button alpha visible). Needs `PI_E2E_SEED=1`. See change: add-e2e-faux-model-roundtrip.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): Faux-provider ask_user round trip.

Adds `pending-question stack` describe (F2/F3/F7/P1). Selectors: `question-pill`, `question-panel[data-variant]`, `question-row-<id>`, `question-dialog`, `question-later`, `[data-pending-ask]`, `composer-root`.
- F2: hidden pi run (`helpers/hidden-session.ts`) asks `ask-select-roundtrip`; pill → panel → "Answer here" row → dialog option `b`; pill count −1; transcript `you picked … b`.
- F3: visible session parked, other session selected; row "Go to session" → `[data-pending-ask]` in viewport; no dialog.
- F7: 375×812; pill ≥44×44; panel `data-variant=sheet` at bottom edge; dialog = viewport; composer topmost after close.
- P1: 2 contexts; 20 re-prompts of one session; in-page MutationObserver in B vs Node `t0` before click in A; p95 ≤1000 ms.
- Hidden run = explicit `PI_DASHBOARD_HIDDEN` pi, not a real automation run: engine broken in harness (#683).
See change: add-pending-question-stack.

