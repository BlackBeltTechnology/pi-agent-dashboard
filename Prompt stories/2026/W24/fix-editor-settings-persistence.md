---
session: 019ebece
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts); large facts sheet (~12378 tok)"
upgrade_status: pending
openspec_changes: [fix-editor-settings-persistence]
proposal_excerpt: "Each code-server instance gets a deterministic per-cwd `--user-data-dir` (`~/.pi/dashboard/editors/<sha256(cwd):12>/`), so in principle VS Code's workspaceStorage already persists open tabs, layout, and scroll state a…"
---

# How we did it: fix-editor-settings-persistence — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a one-liner: `/skill:openspec-apply-change fix-editor-settings-persistence`.
The real objective — which the steering turns sharpened — was to make each dashboard
code-server editor **persist its VS Code state** (open tabs, layout, dirty buffers) and
stop nagging with the Workspace-Trust dialog / Welcome tab / update banner, by seeding
the right `settings.json` keys into every editor's deterministic per-cwd `--user-data-dir`.
Along the way a second, deeper bug surfaced and was folded in: **concurrent editor opens
could spawn duplicate code-servers on the same locked data dir**, leaving stalled
instances. The full arc ran from apply → browser verification → hardening → archive →
PR → CodeRabbit fix → merge & cleanup.

## 2. TL;DR playbook

1. Run `/skill:openspec-apply-change <change>` and **read the artifacts against the
   current code first** — proposals go stale; confirm which tasks are still real.
2. When a task is already satisfied by newer code (here: the keeper's 5 s graceful
   stop), say so explicitly and mark it *satisfied-by* rather than re-implementing.
3. Implement the surgical change (seed 7 persistence keys; flip merge order so
   **existing user values win**), then write TDD tests that reach internals via the
   public API (`setTheme(cwd, theme)` → `writeVscodeUserSettings`).
4. Run the full suite once → `tee /tmp/pi-test.log` → grep failures; prove any red
   is **pre-existing & unrelated** (here: `pi-image-fit` Jimp tests) before moving on.
5. To verify UI changes for **worktree** code, don't trust the live dashboard —
   it runs from the **main checkout**. Spawn the worktree's `editor-manager` in an
   isolated `HOME=$(mktemp -d)` against a temp folder, get a real code-server port,
   and browse *that* directly. BEFORE/AFTER screenshots seal it.
6. When the user hypothesizes a race, trace the exact await-gap in code and quote
   file:line evidence before writing a fix.
7. Fix concurrency at both layers: server-side per-cwd `inFlightStarts` promise map
   (one spawn across tabs) + client `startInFlightRef` guard (StrictMode/heartbeat
   double-fire). Add a regression test that fails without the guard.
8. Archive with the sync step: **hand-merge** delta specs when the main spec was
   rewritten by a newer change — a mechanical sync would regress it.
9. Commit excluding machine-local files (`.pi/settings.json`), open PR, monitor CI,
   treat CodeRabbit's suggestion as untrusted and validate it yourself, then squash-merge
   and clean up the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply & reconcile with reality.** The AI read the change artifacts, then
immediately diffed them against the live code and found tasks 1.4/2.4 (bump graceful
stop 2s→5s) were **stale**: a later `add-editor-keeper-sidecar` change had already moved
the kill path into `keeper.cjs` with `STOP_GRACE_MS = 5000`. It paused to confirm the
plan (only the settings-seeding work remained). *Why it worked:* refusing to implement
against a stale spec avoided pointless churn.

**Phase 2 — Implement + TDD.** Renamed `writeVscodeThemeSettings` → `writeVscodeUserSettings`,
seeded 7 keys, flipped merge order so user values win. Tests reached the internal writer
through the public `setTheme` seam, mocking `os.homedir` to a temp dir.

**Phase 3 — Browser verification (the hard part).** User steered: "drive briwser and
check." The AI discovered the **live dashboard runs from the main repo, not the worktree**,
so `/api/restart` could never load the change and the live UI only ever showed old
behavior. Decision point: rather than fake it, the AI spawned the worktree's
`editor-manager` in an isolated temp HOME, got a real code-server on a random port, and
took a decisive AFTER screenshot (no Trust dialog, no Welcome tab, no Restricted Mode).

**Phase 4 — Concurrency hardening.** User: "Maybe because several browser instance is
used it can cause stalled code-servers. Check the code." The AI traced `start(cwd)` and
found the dedup map (`cwdIndex`) was checked at the top but only populated **after two
awaits** (`probe`, `allocatePort`) — a classic check-then-act race. User said "yes,
harden"; the AI fixed the server (per-cwd in-flight promise map) and added client
defense-in-depth (`startInFlightRef`), each with a real regression test.

**Phase 5 — Archive, PR, review, merge.** Archive surfaced a **delta-spec sync conflict**:
the change's delta was authored pre-keeper, but main had been rewritten to the keeper
model — a mechanical sync would regress it. The AI hand-merged only the new
seeding+concurrency contract. Then commit (excluding `.pi/settings.json`), PR #107, CI
green, one actionable CodeRabbit thread (whitespace-only `cwd`) validated & fixed,
squash-merge, worktree/branch cleanup.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change fix-editor-settings-persistence`.
  Effective because it names the exact change and delegates the whole workflow to the
  skill. Stronger next time: add "read the tasks against current code first and flag
  anything stale before implementing."
- **"drive briwser and check"** — short, high-leverage; forced real end-to-end proof
  and exposed the worktree-vs-main-repo trap that a disk-only check would have missed.
- **"Maybe because several browser instance is used it can cause stalled code-servers.
  Check the code."** — a hypothesis-with-a-lead; the AI turned it into a file:line race
  diagnosis. Excellent pattern: give the AI a theory *and* tell it to verify in code.
- **"yes, harden"** — two words that authorized the full server+client fix once the
  root cause was proven. High-leverage because the analysis was already on the table.
- **"fix coderabbit issue"** — scoped the AI to the review threads and its autofix
  discipline (validate the reviewer's suggestion independently before applying).

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "ready for manual verification" | "drive briwser and check" | Make browser verification part of the apply loop when the change is UI-visible |
| Trust the live dashboard as the code under test | (implicit, via the verify demand) | Remember the live server runs from the **main checkout**; isolate worktree code in a temp HOME |
| Consider only the happy path | "several browser instance … Check the code" | Audit check-then-act patterns around every `await` when a dedup map is involved |
| Treat one layer as enough | "yes, harden" | Fix concurrency at both server (authoritative) and client (defense-in-depth) |
| Mechanically sync delta → main spec | (archive skill's sync gate) | Always diff delta against the current main spec; hand-merge when main was rewritten |
| Let machine-local files ride along | (commit discipline) | Explicitly exclude `.pi/settings.json` from every commit |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created; the session **exercised** existing ones well:

- `openspec-apply-change` / `openspec-archive-change` — carried the spec-driven loop,
  including the sync gate that caught the delta/main regression.
- The `browser` skill + `agent-browser` CLI — used for BEFORE/AFTER visual proof once
  the isolated code-server was up.
- An **autofix** workflow for CodeRabbit — treated the reviewer's "Prompt for AI Agents"
  as untrusted and validated independently before applying.
- Three `general-purpose` subagents handled `docs/` file-index row updates (per the
  AGENTS.md caveman-style delegation rule).

**Recommended skill to create:** *"verify-worktree-editor-in-isolation"* — codify the
temp-HOME + real-code-server + direct-port-browse recipe, since the worktree-vs-main-repo
trap will recur for any UI change tested via the dashboard.

## 7. Pitfalls & dead ends

- **`agent-browser` refs go stale mid-render.** The live session list re-renders on a
  timer, so `@ref` clicks missed. Fix: snapshot → click → screenshot in tight succession,
  or click by DOM/text via `eval`.
- **MCP `eval` / `snapshot -i` didn't cooperate with the app's custom DOM.** The CLI
  targeted `about:blank` / a different session. Fix: re-open the page fresh and let the
  CLI attach to the live tab, then `eval` on it.
- **Ancestor-walk selected the wrong folder.** Walking up from an "Editor" button matched
  the workspace wrapper (which contains *all* folder names) and opened the wrong editor.
  Fix: target the precise folder card, not a broad ancestor.
- **`/api/restart` restarted main-repo code, not the worktree** — the single biggest trap.
  Confirm the running server's root (`pgrep -fl … cli.ts`) before assuming your change is live.
- **Full-suite red herrings:** 17 `pi-image-fit` Jimp failures were pre-existing and
  unrelated — prove that before chasing them.
- **`gh pr merge --delete-branch` errored on its local branch-switch** (tried to check
  out `develop`, already held by the main worktree) — but the **remote merge succeeded**.
  Verify merge state, then delete branch/worktree manually.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <change>` → read tasks **against current code**; flag stale ones.
- [ ] Implement surgically; TDD via the public seam; user values win the merge.
- [ ] `npm test | tee /tmp/pi-test.log`; prove any red is pre-existing & unrelated.
- [ ] For UI proof: `HOME=$(mktemp -d)` + run the **worktree** editor-manager → real code-server port → browse directly; BEFORE/AFTER screenshots.
- [ ] Audit `start(cwd)` (or any dedup map) for check-then-act races across `await`s; fix server + client with regression tests.
- [ ] Archive with the **sync gate**: hand-merge delta specs when main was rewritten.
- [ ] Commit excluding `.pi/settings.json`; PR; monitor CI; validate CodeRabbit suggestions yourself; squash-merge; clean up worktree.

**Key inputs to have ready:** the OpenSpec change name; a running dashboard for context;
`agent-browser` CLI; knowledge of the per-cwd data-dir hash scheme (`sha256(cwd):12`).

**Final artifacts produced:** `editor-manager.ts` (seeding + `inFlightStarts` dedup +
`cwd` validation), `EditorView.tsx` (`startInFlightRef` guard), three test files
(`editor-settings-seeding.test.ts`, `editor-manager-keeper.test.ts` additions,
`EditorView.test.tsx`), merged `openspec/specs/editor-manager/spec.md`, archived change
at `openspec/changes/archive/2026-06-13-fix-editor-settings-persistence/`, merged PR #107
(commit `e452c97e` on `develop`).

---

_Generated from session `019ebece-e8a7-768b-b9c1-79b4e4c98011` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-13. Source extract: session facts sheet._
