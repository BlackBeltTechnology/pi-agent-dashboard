---
session: 019f4385
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); heavy steering (5 user prompts); large facts sheet (~12451 tok)"
upgrade_status: pending
openspec_changes: [reduce-chat-render-cpu-umbrella]
proposal_excerpt: "A long-chat session page (`/session/<id>`) pegs the browser main thread at ~100 % for any viewer who opens it — not only the typing user. A 102.6 s Chrome performance trace of a live session shows 102.3 s main-thr…"
---

# How we did it: reduce chat-render CPU (umbrella) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened by invoking the `openspec-apply-change` skill on the change
`reduce-chat-render-cpu-umbrella`. The plain-language objective: **stop a long
`/session/<id>` page from pegging the browser main thread at ~100% CPU for every
viewer.** A 102-second Chrome trace showed the main thread saturated by chat-render
work. The change is a 5-phase umbrella (memoize `ChatView`, coalesce live WS events,
kill non-composited animations, add `content-visibility`, plus ship-time trace
verification). The *real* objective that emerged through steering: implement every
phase that can be built and **automatically** verified without a live browser, then —
once the operator agreed to deploy — **prove the CPU win with a real before/after
Chrome CDP trace** on the live dashboard, and commit only the intended files.

## 2. TL;DR playbook

1. `apply` the OpenSpec change; read `proposal.md`/`design.md`/`tasks.md` and **order
   phases by testability**: land the phases that are fully unit-testable first
   (Phase 4 memoization, Phase 3 event coalescing), defer browser-only ones.
2. **Phase 4 — memoize `ChatView`**: wrap in `React.memo(forwardRef(...))`, then hunt
   the memo-defeating props at the call site and stabilize them (`useCallback` for
   handlers, a module-level `EMPTY_STEERING` const for `?? []`).
3. **Phase 3 — coalesce live events (TDD)**: extract a **pure** `foldLiveEvents`
   helper, write the identity test first (fold == sequential `reduceEvent`), then wire
   a per-session queue + `requestAnimationFrame` flush into `useMessageHandler` —
   keeping per-event side effects synchronous, coalescing only the expensive
   `setSessionStates` render.
4. **Phase 1 — de-animate**: audit `index.css`; convert `background-position` sweeps to
   `transform: translateX()`, `box-shadow` pulses to opacity cross-fades, and drop
   `transition-all`/`width` transitions on live-updating bars (snap instead). Add a
   shared `IntersectionObserver` `fx-offscreen` pause utility, attached **only while
   animating**.
5. **Phase 2 — `content-visibility`**: put `chat-cv` on the transcript container,
   `chat-cv-skip` on the live tails (streaming thinking/text, pending steering), add the
   CSS rule with a `contain-intrinsic-size` estimate.
6. **Verify automatically**: `npx tsc --noEmit` (root, not per-package), `npx biome
   check --changed`, full `npm test`; re-run any flaky failures in isolation with
   `HOME=$(mktemp -d)`.
7. **Before deploying, stop and ask.** Building writes the same `dist` the live server
   serves — a naive "isolated build" leaks to the live dashboard. Present the tradeoff.
8. **After the operator approves deploy**: `npm run build` → `POST /api/restart`
   (client production path; no `reload` since the bridge is untouched).
9. **Prove it**: drive a real long session with Playwright + system Chrome (`channel:
   "chrome"`) over CDP, A/B toggle the `chat-cv` class, and report idle layouts/s,
   off-screen rows skipped, and per-keystroke layout cost. Clean up harness files.
10. **Commit surgically**: stage only your change files; leave pre-existing dirty
    working-tree entries untouched.

## 3. How the collaboration unfolded

**Phase A — Discovery & phase ordering.** The AI read the change context, recognized a
large 5-phase umbrella, and made the key call: **sequence by what is
implementable-and-testable without a browser.** Phase 4 and Phase 3 land first; the
DevTools-gated phases are deferred. This is the move worth repeating — it front-loads
all the value that CI can prove.

**Phase B — Build the testable phases.** Phase 4 memoization plus a TDD Phase 3
(pure helper + identity test → wire the rAF flush). The effective bit: the pure
`foldLiveEvents` helper made the risky logic (coalescing WS events into one render)
unit-provable, and a "200 events → exactly 1 render/frame" probe locked in the
behavior. 453 message-handler tests stayed green because side effects stayed
synchronous and only the render was coalesced.

**Phase C — De-animate + content-visibility.** The AI audited `index.css`, converted
paint/layout-heavy animations to compositor-only `transform`/`opacity`, dropped
`width` transitions on the token bar, and added a shared offscreen-pause observer and
`content-visibility` on the transcript. It recorded findings in
`phase1-animation-audit.md` and `phase2-content-visibility-notes.md`.

**Phase D — The "can an agent build/deploy/test?" investigation.** The operator asked
if an agent could build, deploy, and test against the running dashboard. The AI did a
deep, careful spike and found: `npm run build` writes the exact `dist` the live server
serves, the event store is **in-memory** (copied `dashboard.db` is legacy/unused), and
transcripts load from the pi JSONL on subscribe — so a "fresh isolated server with a
copied DB" is a dead end (shows 0 sessions). It captured this in the
`isolated-ui-verification` skill so the deep dig isn't repeated.

**Phase E — Deploy & prove.** Operator chose to deploy manually. The AI ran `npm run
build` → `POST /api/restart`, then drove a real 515-row / 10.7k-node session with
Playwright + system Chrome over CDP, A/B-toggling `chat-cv`. Result: **idle layouts/s
85 → 0, 504/515 rows skipped off-screen, per-key layout 131 ms → 4.5 ms, no console
errors, no visible clipping.** Then a surgical commit of exactly the 15 change files.

## 4. Prompts that worked

- **Goal prompt** — invoking `openspec-apply-change` on a named change. Effective
  because it hands the AI a fully-specified, phased spec: the AI could self-sequence and
  self-verify with minimal steering. Stronger still: add "land the unit-testable phases
  first; stop before anything that needs a live browser."
- **"Is it possible to build and deploy and test with an agent?"** — high-leverage: it
  triggered the isolation investigation *before* anything touched the live server,
  surfacing the "build leaks to live dist" and "in-memory event store" facts.
- **"I will do manually. build and redeploy"** — a clean unblock that authorized the
  deploy while keeping the human in control of the risky step.
- **"compare"** — one word that unlocked the whole before/after CDP trace. Terse but
  unambiguous given the prior context.
- **"commit changes"** — trusted the AI to stage surgically; worked because the AI first
  inspected working-tree state and commit style.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to build/deploy to verify browser-only phases | Asking "is it possible to test with an agent?" (forcing the isolation question first) | State up front: "never build/deploy to the live dashboard without explicit approval — `npm run build` writes the live `dist`" |
| Propose an elaborate isolated-instance harness | Choosing the simplest path ("I will do manually. build and redeploy") | Offer the deploy-to-live option early with its rollback (`git stash` + rebuild + restart) instead of chasing full isolation |
| Stop after implementation + automated tests | Asking to "compare" (demand a real before/after trace) | Plan a CDP trace step into the change's ship-time tasks; treat the perf claim as unproven until traced |
| Leave verification abstract | Implicitly requiring numbers | Always A/B-isolate the risky change (toggle `chat-cv`) and report concrete deltas |

Quality bars the operator imposed implicitly: real numbers (not "should be faster"), a
surgical commit (only intended files), and zero disruption to the live instance until
explicitly authorized.

## 6. Skills, tools & memory created — and why they're effective

- **`isolated-ui-verification` skill (patched)** — captures the hard-won architectural
  finding that this dashboard is a **live aggregator**: in-memory event store, sidebar
  lists only live-bridge sessions, transcripts load from pi JSONL on subscribe, and
  `dashboard.db`'s events table is legacy. **Why effective:** it prevents a future
  session from repeating a ~20-minute spike that ends in "0 sessions." Invoke it before
  any attempt to stand up an isolated dashboard against a *real long session*.
- **Two memory saves attempted** (flaky-test knowledge: `useImagePaste.test.ts`,
  `doctor-route.test.ts`, `recovery-offer.test.ts` fail under full-parallel `npm test`
  but pass in isolation; re-run single files with `HOME=$(mktemp -d)`). Note: both
  memory stores were reported at capacity, so the save may not have persisted — worth a
  consolidation pass. **Why it matters:** it turns "mysterious CI red" into "known
  load-flake, re-run in isolation," saving a needless debugging detour.
- **Recommended if not present:** a small skill for "prove a perf change with a
  Playwright + system-Chrome CDP trace against the live dashboard" — the exact recipe
  (`channel: "chrome"`, run the probe from the repo dir so `playwright` resolves, A/B a
  CSS class) is reusable for any future render-perf change.

## 7. Pitfalls & dead ends

- **Isolated server + copied `dashboard.db` = dead end.** The event store is in-memory;
  the copied DB is legacy. A fresh isolated server shows 0 sessions. If you need a real
  long transcript, you must register a session + its pi JSONL, or just deploy to live.
- **`npm run build` leaks to live.** `pi-dashboard-web` symlinks to `packages/client`,
  and the live server serves `packages/client/dist` — the exact dir the build writes.
  There is no `clientDir` override env. So "build in isolation" is a myth here.
- **Headless Playwright wanted a bundled Chromium that wasn't present.** Fix: use the
  system Google Chrome via `channel: "chrome"`.
- **Probe script run from `/tmp` couldn't resolve `playwright`.** Fix: write and run the
  trace script inside the repo dir.
- **First idle measurement (46.8 layouts/s) was a mount-settling artifact.** Fix:
  wait for hydration/mount-layout to settle before starting the idle window; the
  stabilized run showed 0/s.
- **Per-package `tsc --noEmit` surfaced a pre-existing rootDir/test-fixture error.**
  Use root `npx tsc --noEmit` to judge your change; ignore the unrelated per-package
  noise.
- **Flaky full-suite failures** in `useImagePaste`, `doctor-route`, `recovery-offer`
  under parallel load. Confirm by re-running the single file with `HOME=$(mktemp -d)` —
  they pass 10/10 in isolation.
- **Dirty working tree.** `groups.json`, `package-lock.json`,
  `generated/plugin-registry.tsx`, `b05_*.txt`, and an unrelated change dir were
  pre-existing. Stage only your files; don't sweep them into your commit.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; a running live dashboard on :8000
from this checkout; Playwright + system Google Chrome installed.

- [ ] `apply` the change; read proposal/design/tasks; **order phases by testability**.
- [ ] Phase 4: `React.memo(forwardRef(...))` + stabilize call-site props (`useCallback`,
      module-level `EMPTY_STEERING`).
- [ ] Phase 3 (TDD): pure `foldLiveEvents` + identity test → rAF-coalesced
      `setSessionStates` in `useMessageHandler`, side effects synchronous.
- [ ] Phase 1: `transform`/`opacity` animations only; drop `width`/`transition-all` on
      live bars; shared `IntersectionObserver` pause, attached only while animating.
- [ ] Phase 2: `chat-cv` container + `chat-cv-skip` live tails + CSS with
      `contain-intrinsic-size`.
- [ ] Verify: root `npx tsc --noEmit`, `npx biome check --changed`, `npm test`;
      re-run flakes with `HOME=$(mktemp -d)`.
- [ ] **Stop and get deploy approval** (build leaks to live `dist`).
- [ ] Deploy: `npm run build` → `POST /api/restart`; hard-refresh the tab.
- [ ] Prove: Playwright + `channel: "chrome"` CDP trace on a long session, A/B toggle
      `chat-cv`; report idle layouts/s, off-screen rows skipped, per-key layout ms.
- [ ] Clean up harness files; commit only your change files.

**Artifacts produced:** `lib/coalesce-live-events.ts`, `lib/fx-visibility.ts`,
`hooks/useFxVisibility.ts` (+ edits to `ChatView.tsx`, `App.tsx`,
`useMessageHandler.ts`, `index.css`, `TokenStatsBar.tsx`, `ToolBurstGroup.tsx`,
`SessionCard.tsx`); tests `coalesce-live-events.test.ts`,
`useMessageHandler.event-coalescing.test.tsx`; change notes
`phase1-animation-audit.md`, `phase2-content-visibility-notes.md`. Commit `7edac49ab`
`perf(chat): reduce chat-render CPU across four phases` (15 files, +589/−61) on
`develop`.

---

_Generated from session `019f4385` · `pi-agent-dashboard` · 2026-07-08. Source extract: `/tmp/facts-cKVgXL.md`._
