# OBSOLETE — 2026-07-13

Reason: **target surface deleted.** This change adds a streaming bootstrap progress log *under the first-run wizard*. That wizard no longer exists.

Evidence (drift audit 2026-07-13):
- Archived `2026-07-04-auto-launch-first-run-skip-welcome` removed the first-run wizard entirely — deleted `wizard-window.ts`, `wizard-ipc.ts`, `wizard.html`, `showWelcomeStep()`.
- `packages/electron/src/main.ts` header comment: "There is no first-run wizard: launch is unconditional."
- Startup state machine collapsed 6→4 states; no `wizard` gate remains. Renderer has only `doctor.html` + `remote-connect.html`.
- The `first-run-wizard` capability this change's delta spec targets is gone.

The `loading.html` splash persists but is a different surface. If the same UX need arises for the splash, write a fresh proposal against the current bootstrap architecture (see `docs/electron-bootstrap-flow.md`). Original artifacts preserved below for history.
