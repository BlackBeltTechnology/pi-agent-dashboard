---
session: 019f2e2d
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts); large facts sheet (~12652 tok)"
upgrade_status: pending
openspec_changes: [auto-launch-first-run-skip-welcome, fix-local-electron-dmg-build]
proposal_excerpt: "The first-run wizard is currently a single screen with a single button (`[Launch dashboard]`) and an `Advanced` disclosure for connecting to a remote server. Reading `packages/electron/src/renderer/wizard.html`:"
---

# How we did it: Remove the Electron first-run wizard & auto-launch — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change auto-launch-first-run-skip-welcome
```

The real objective, once the steering turns landed: **take a fully-specified OpenSpec
change from proposal to merged PR.** The change collapses the Electron first-run wizard
(a single-screen "Launch dashboard" gate) — deleting the wizard window/IPC/preload/renderer,
making launch unconditional, and *replacing* the wizard's remote-server disclosure with a
proper app-menu-driven "Connect to Remote Dashboard" window backed by a renamed settings
file (`mode.json` → `dashboard-settings.json`, with migration) and a `recentRemotes[]` MRU
store. The user wanted it **implemented, locally verified with the two real test harnesses
(Docker Playwright + Electron CDP), a real packaged app launched to prove "no wizard,"
committed, and shipped via PR to `develop`** — not just unit-passed and hand-waved.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — read `tasks.md` + context files, map every
   consumer with `rg` **before** rewriting anything. Confirm scope on the softest/riskiest
   slice (`ask_user`) before touching it.
2. Implement bottom-up: foundation state file first (`wizard-state.ts`), then the new
   window/preload/renderer, then wire the app-menu, then delete the dead wizard files with
   `git rm`, then update tests (add migration + MRU round-trip cases).
3. **Isolate every test run**: electron vitest needs an ephemeral `HOME` — run
   `HOME=$(mktemp -d) npx vitest run …`. Stash your diff (`git stash -u`) to prove which
   failures are pre-existing baseline vs. yours.
4. Update the `AGENTS.md` tree directly (source-tree rows); **delegate all `docs/` prose to
   a general-purpose subagent** (caveman style, Rule 6).
5. Run the two real harnesses: **Docker Playwright** (`PW_CHANNEL=chrome playwright test
   smoke navigation` against `:18000`) for web regression; **Electron CDP**
   (`dev:cdp` / packaged `electron-forge package` + `--debug-cdp`, isolated `HOME`) to
   assert `/json/list` shows **0 wizard windows**.
6. Only tick a validation checkbox for what you *empirically* verified; leave genuinely
   untested deliverables unchecked with an inline reason.
7. When a build target is pre-existing-broken, don't fix it inline — **scaffold a follow-up
   OpenSpec change** (`fix-local-electron-dmg-build`) capturing the root cause.
8. Commit as **single-concern conventional commits** (feature, then follow-up proposal).
9. `/skill:ship-change` — flip QA/manual tasks to `[x]`, verify gate, archive + sync specs,
   push, open PR, watch CI, wait for CodeRabbit, squash-merge, then remove the worktree
   **via the dashboard endpoint** (never self-destruct the live CWD from inside it).

## 3. How the collaboration unfolded

**Phase 1 — Discovery & scope-lock.** The AI read `tasks.md` (no `design.md` existed yet;
decisions lived inline in tasks), read all source + tests + the remote-connect mockup, and
`rg`'d every consumer. It flagged that **Section 2B** (the `mode.json` rename + migration +
`recentRemotes[]` MRU) carried the real risk, and used `ask_user` to confirm full-2B scope
before rewriting `wizard-state.ts`. *Why it worked:* mapping consumers first (e.g. spotting
that `update-checker.test.ts` mocks `readModeFile`) let it keep function names and rename
only the file+type — a smaller, safer diff.

**Phase 2 — Implementation (bottom-up).** Foundation state file → new
`remote-connect-window.ts` + preload + `remote-connect.html` (adapted from the mockup) →
app-menu wiring → `git rm` of the four dead wizard files → collapsed the `main.ts` startup
machine (6→5 states, hoisted `registerBundledBridgeExtension()` to every spawn) → Doctor
`run-setup` removal across four files → added migration + MRU tests. Net **−342 LOC**.

**Phase 3 — Verify (unit) & docs.** Ran electron tests under ephemeral `HOME`; **stashed the
diff to confirm 7 failures were pre-existing baseline**, not the change. Edited the
`AGENTS.md` tree directly, **delegated `docs/` prose to a subagent** (caveman style). Ran
Biome (only warn-tier `noExplicitAny`/`useTemplate` remained; auto-fixed the new files, left
`main.ts` untouched). CodeRabbit timed out on rate-limit → treated as advisory/deferred.

**Phase 4 — Real-harness QA (the steered part).** Steering #1 ("Make tests can be done
locally with docker test and playwright") pushed past unit-only. The AI distinguished the two
layers cleanly: **Docker Playwright drives the web dashboard** (can't see Electron windows) →
3/3 smoke+navigation green; **Electron CDP drives the real shell** → `/json/list` = 1 window,
**0 wizard windows**. Steering #2 ("check tasks which tested") forced honest checkbox
accounting — tick only what was empirically proven.

**Phase 5 — Packaged build & a discovered infra bug.** Steering #3 ("Build local electron")
hit `electron-forge make` failing on darwin ("Could not find any make targets…"). The AI
root-caused it: `build-installer.sh` still calls `npm run make` but `forge.config.ts`
**removed the DMG maker** in favor of `electron-builder --prepackaged` — a pre-existing
local-wrapper-only bug (CI is correct). It produced a runnable `.app` via `electron-forge
package` instead, CDP-verified 0 wizard windows on the *packaged* app, and (steering #4
"yes") **scaffolded a follow-up change `fix-local-electron-dmg-build`** rather than
scope-creeping the fix inline.

**Phase 6 — Commit & ship.** Steering #5 ("commit") → two single-concern conventional
commits (reverting the `.last-arch` build sentinel byproduct first). Steering #6 ("I will
tests manual tests later, use ship-change skill") → ran `ship-change`: flipped QA tasks,
verify gate (build ✅; 17 local failures isolated to `pi-image-fit-extension` jimp drift —
develop CI confirmed green), **fixed a malformed live spec** so the REMOVED delta could
archive, pushed, opened **PR #237**, CI green (9m5s), CodeRabbit clean, squash-merged. It
**stopped short of removing the worktree** (its own live CWD). Steering #7 ("remove") →
removed it **via the dashboard endpoint** from outside the doomed directory.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change auto-launch-first-run-skip-welcome`.** Good
  kickoff *because the change was already fully specified*; the skill gives the AI a task
  ledger to work and verify against. Lesson: front-load the spec so the apply is mechanical.
- **`Make tests can be done locally with docker test and playwright`** — high leverage: one
  sentence reoriented the AI from "unit-passed, defer the rest" to actually driving both real
  harnesses. Stronger version: *"Verify locally with the Docker Playwright harness (web) AND
  Electron CDP (shell) before claiming any 7.x checkbox."*
- **`check tasks which tested`** — forced honest, evidence-backed checkbox accounting. Bake
  this in as a standing rule: *tick a task only with a reproduced observation, cite it inline.*
- **`Bulild local electron`** (typo, still worked) — surfaced the pre-existing DMG bug.
- **`yes`** / **`commit`** / **`remove`** — tiny confirmations that unblocked large moves
  (scaffold follow-up / land commits / destroy worktree). Effective because the AI had
  already laid out the exact plan and only needed a go/no-go.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Blanket-defer all QA/manual tasks after unit tests passed | "Make tests can be done locally with docker test and playwright" | State up front: run BOTH harnesses (Docker web + Electron CDP) before deferring any verify task |
| Leave validation checkboxes ambiguous | "check tasks which tested" | Rule: tick a checkbox only with a reproduced observation + inline evidence; leave the rest unchecked with a reason |
| Stop at unit-verified without a packaged artifact | "Bulild local electron" | Include "produce & launch a packaged `.app`, assert 0 wizard windows via CDP" in the definition of done |
| Risk scope-creeping a discovered infra fix into this change | (implicit; AI proposed, user said "yes") | On an out-of-scope bug, scaffold a follow-up OpenSpec change — never fix inline |
| Nearly self-destruct the live worktree/session on cleanup | AI self-halted; user later said "remove" | Remove the session's own worktree via the dashboard endpoint from OUTSIDE the directory, never `git worktree remove` from within |

Quality bars the user imposed: **local, real-harness proof over inference**; **honest task
accounting**; **a packaged build actually launched**.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session was driven by **existing** ones:
`openspec-apply-change` (task ledger), `ship-change` (archive→PR→merge→cleanup), plus the
`browser` skill's **Electron CDP-attach recipe** (isolated `HOME`, background launch,
`/json/list` enumeration, clean teardown) and the docs-Rule-6 **subagent delegation** for
`docs/` prose.

*Recommended skill to create:* an **"electron-cdp-verify"** procedure capturing the exact
hermetic pattern that worked here — launch dev/packaged Electron with `--debug-cdp` under
`HOME=$(mktemp -d)`, poll `:9222/json/list` via file-output (never inline `curl` — the
context guard rejects blocks containing it), assert window count, tear down + free `:9222`.
This session re-derived that recipe from scratch; it should be one skill invocation.

## 7. Pitfalls & dead ends

- **Electron vitest needs an ephemeral `HOME`** — bare `npx vitest run` fails the harness;
  use `HOME=$(mktemp -d) npx vitest run …`.
- **Distinguish baseline failures from yours** by `git stash -u` then re-running — here 7
  (then 17/18) failures were pre-existing (`pi-image-fit-extension` jimp v1 API drift,
  `server-lifecycle`/`smart-startup`), none in electron. CI's clean `npm ci` won't hit the
  jimp drift.
- **The context guard rejects any bash block containing `curl`** — one CDP probe block was
  silently rejected and launched nothing. Probe CDP via file-output/`node` fetch instead.
- **`npm run electron:make`/`electron:build` is pre-existing-broken on darwin** —
  `build-installer.sh` calls `npm run make` but the DMG maker was removed from
  `forge.config.ts`. Use `electron-forge package` to get a runnable `.app`; file a follow-up
  change for the wrapper.
- **`electron-forge make` on darwin** → "Could not find any make targets configured for the
  darwin platform" (no maker; DMG comes from `electron-builder --prepackaged`).
- **The live `first-run-wizard` spec was malformed** (delta headers written verbatim into the
  live spec) — blocked `openspec archive`. Fix the live spec's structure minimally
  (`## Purpose` + `## Requirements`) so the REMOVED delta applies.
- **Never remove the worktree that is your own CWD from inside it** — use the dashboard
  removal endpoint from the parent repo.
- **macOS AppleScript menu-driving needs assistive-access grant** (absent here) — menu wiring
  stayed code/unit-verified rather than UI-driven.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a fully-specified OpenSpec change (`tasks.md` + mockup); Docker
running; system Chrome (`PW_CHANNEL=chrome`, no Playwright Chromium cache needed); a free
`:9222`; awareness that `:8000` in use forces the Electron *attach* path.

- [ ] `/skill:openspec-apply-change <change>`; read tasks + all consumers via `rg` first
- [ ] `ask_user` to confirm scope on the riskiest slice before rewriting
- [ ] Implement bottom-up (state → window/preload/renderer → menu → `git rm` dead files → tests)
- [ ] `HOME=$(mktemp -d) npx vitest run …`; `git stash -u` to isolate baseline failures
- [ ] Edit `AGENTS.md` tree directly; delegate `docs/` prose to a subagent (caveman style)
- [ ] Docker Playwright `smoke navigation` (web regression) → green
- [ ] Electron CDP (`dev:cdp` + packaged `electron-forge package`, isolated `HOME`) →
      `/json/list` shows 0 wizard windows
- [ ] Tick only empirically-verified checkboxes; inline-reason the rest
- [ ] Scaffold a follow-up change for any out-of-scope infra bug
- [ ] Single-concern conventional commits (revert build byproducts like `.last-arch`)
- [ ] `/skill:ship-change` → verify gate, archive + sync specs, PR to `develop`, watch CI,
      CodeRabbit, squash-merge, worktree removal via dashboard endpoint

**Final artifacts produced:** PR **#237** (merged, squash `83c64f6b6`); commits
`470e963f5` (feat), `c15a8cc62` (follow-up proposal), + archive commit; follow-up change
`fix-local-electron-dmg-build`; packaged `packages/electron/out/PI-Dashboard-darwin-x64/PI-Dashboard.app`.

---

_Generated from session `019f2e2d-80d7-7060-bff8-5fd4036ee800` · `pi-agent-dashboard` · 2026-07-04. Source extract: `/tmp/facts-*.md`._
