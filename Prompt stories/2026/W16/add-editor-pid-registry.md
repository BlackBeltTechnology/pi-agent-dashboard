---
session: 019da4e4
week: 2026/W16
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (13 user prompts); large facts sheet (~10364 tok)"
upgrade_status: pending
openspec_changes: [add-editor-pid-registry]
proposal_excerpt: "When the dashboard server exits non-gracefully (SIGKILL, crash, OOM, force-quit), it does not run `editorManager.stopAll()`, and the spawned `code-server` child processes are reparented to init/launchd instead of being cleaned up."
---

# How we did it: persistent editor PID registry with boot-time orphan cleanup — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** — a thinking-partner stance, not an implementation one:

> "Enter explore mode. Think deeply. Visualize freely. Follow the conversation wherever it goes. **Explore mode is for thinking, not implementing.**"

The operator did not start with a feature request; they started with a *suspicion*. They then pasted a raw `ps aux | grep code-server` dump showing a live, orphaned `code-server` process tree still bound to a port with nothing owning it. The real objective that crystallized: **when the dashboard server dies non-gracefully (SIGKILL / crash / OOM / force-quit), it never runs `editorManager.stopAll()`, so spawned `code-server` children are reparented to launchd and leak ports + user-data-dir locks.** Fix: persist a PID registry to disk and sweep orphans on the next boot — mirroring the existing `headless-pid-registry.ts` pattern. The work then ran end-to-end through the OpenSpec pipeline: explore → proposal/design/spec/tasks → implement → verify → commit → archive.

## 2. TL;DR playbook

1. **Start in explore mode** to confirm the bug is real before proposing anything. Ask the AI to *trace the actual shutdown path*, not guess. Feed it real evidence (`ps aux`, PID trees) — it turned the dump into a labeled process-tree diagram and confirmed the orphan.
2. **`/opsx:ff add-editor-pid-registry`** — fast-forward all four artifacts (proposal → design → specs delta → tasks) in one shot. Point the AI at the sibling pattern to copy (`headless-pid-registry.ts`) so the design writes itself.
3. **`/opsx:apply add-editor-pid-registry`** — implement TDD: new module + unit tests first, then wire 3 hook points into `editor-manager.ts`, then the boot sweep in `server.ts`.
4. When the **full test suite kills the session**, tell the AI to run only the *targeted* test files it touched. Don't let it re-run the whole suite.
5. **`/opsx:verify`** — cross-map every spec requirement/scenario to a code location. It found 3 fixable gaps (S1/S2/S3) + 1 manual-only gap (W1).
6. **"fix"** — one word. It replaced an invented unportable test path with a cross-platform technique, added a clarifying comment, and wrote a real integration test using a fake `ChildProcess` that binds a real TCP listener.
7. **"commit changes"** in a repo full of unrelated in-flight work → tell it to commit **only its own hunks**. It surgically staged mine-only content out of mixed files (`server.ts`, `AGENTS.md`, `architecture.md`) via `git hash-object` + `git update-index`, leaving the working tree untouched.
8. **`/opsx:archive`** — sync the delta spec into the main capability spec and archive, accepting the 6 manual-verification tasks as deferred (covered by 31 automated tests).

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI read `editor-manager.ts` + the server shutdown path and drew the in-memory state model, correctly concluding the *literal* question ("does a stale entry survive a restart?") was **no** — new process boots with empty Maps. But it reframed to the sharper question: *does anything stale survive in the OS?* The operator's `ps aux` paste was the smoking gun; the AI mapped the 4-PID tree (code-server → worker → extensionHost → language-server), confirmed PPID reparenting to launchd, and matched it to the "graceful-stop-didn't-run" branch. **Why it worked:** evidence-first. The human supplied a real process dump instead of asking "is this possible?", so the AI reasoned about a concrete artifact.

**Phase 2 — Artifact generation (`/opsx:ff`).** All four OpenSpec artifacts written and validated in one pass. Design captured 7 decisions (new sibling module vs. extending headless; kill vs. reclaim orphans; **cmdline verification against the `~/.pi/dashboard/editors/` prefix** so you never kill the user's own `code-server`; 1s SIGTERM→SIGKILL escalation; hook points; sweep-before-routes ordering). Spec delta: 3 ADDED requirements, 11 scenarios. **Why it worked:** the AI was told to mirror an existing, trusted pattern — so the design is a diff against known-good code, not a blank-page invention.

**Phase 3 — Implementation (`/opsx:apply`, TDD).** Module first (`editor-pid-registry.ts`, ~187 lines), then 14 unit tests (green), then 3 hook points in `editor-manager.ts` (`register` after ready, `remove` in stop/exit/error), then the boot sweep in `server.ts`. The AI verified ordering explicitly: `cleanupOrphans()` runs at the top of `server.start()`, **before `fastify.listen`** actually accepts requests (registration ≠ acceptance).

**Phase 4 — Verify & fix (`/opsx:verify` → "fix").** The verification report mapped all 11 scenarios to code and flagged: **S1** a persistence-failure test that used an invented `/proc/1/...` path (not portable), **S2** a missing explanatory comment at the route-registration site, **S3** no real end-to-end register/remove test. The one-word "fix" produced all three, including a `FakeChild` that binds a real TCP listener on the port parsed from `--bind-addr` so the production `start()` path runs for real.

**Phase 5 — Commit into a messy tree ("commit changes").** The repo had ~72 unrelated modified/untracked files (marketing-site, `@fastify/compress`, image-paste, etc.), some **mixed into the same files** the AI edited. It staged only its own hunks by extracting the HEAD version, applying just its hunks, and swapping the index entry with `git hash-object -w` + `git update-index` — leaving the working tree fully intact. Commit `97dd4bd`: 13 files, +906/-2.

**Phase 6 — Archive (`/opsx:archive`).** Synced the 3-requirement delta into `openspec/specs/editor-manager/spec.md` (now 10 requirements) and archived, explicitly accepting 6 manual-verification tasks (§6.1–6.6, `kill -9` + orphan observation) as deferred since 31 automated tests cover the code paths.

## 4. Prompts that worked

- **The goal prompt (explore mode).** Strong because it *withheld the implementation* and forced a diagnosis first. The operator didn't say "add a PID registry" — they let the AI discover the bug's shape, so the eventual design was grounded in a real process tree, not an assumption.
- **The `ps aux` paste (high-leverage).** Feeding raw evidence mid-explore is worth more than a paragraph of description — the AI turned bytes into a labeled diagram and a confirmed root cause.
- **"the full tests kills the session. Ignore it" (high-leverage).** One sentence permanently redirected the AI from a session-killing full-suite run to targeted test files for the rest of the session.
- **"fix" (high-leverage).** A one-word unlock — because the preceding `/opsx:verify` had already produced a precise, numbered gap list (S1/S2/S3/W1), "fix" had an unambiguous referent.
- **"commit changes" (needed a guardrail, see §5).** Effective only because the AI proactively audited the tree first and asked before sweeping unrelated work in.

**Rewrite of a weak prompt:** instead of a bare "commit changes" in a dirty repo, say up front: *"Commit ONLY the hunks that belong to this change; the repo has unrelated in-flight work — do not stage anything else, and leave the working tree untouched."* That states the guardrail before the AI has to infer it.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Run the **full test suite**, which killed the pi session | "the full tests kills the session. Ignore it" | State up front: *run only the targeted test files you touched; never the whole suite* |
| Write a persistence-failure test with an **invented, unportable path** (`/proc/1/...`) | `/opsx:verify` caught it → "fix" | Ask for cross-platform test techniques (e.g. `mkdirSync(target)` → EISDIR on rename) instead of magic paths |
| Risk staging **unrelated in-flight work** in a dirty repo | "commit changes" → AI self-audited and flagged mixed files before acting | Say *commit only my hunks; leave everything else untouched* in the commit prompt |
| **Defer** the real integration test to "manual verification" | `/opsx:verify` demanded coverage → S3 fix | Ask for a fake `ChildProcess` that binds a real port so `start()`→`stop()` runs end-to-end in unit tests |
| Leave the route-registration ordering **undocumented** | S2 fix | Request an inline comment wherever ordering is load-bearing (sweep before `fastify.listen`) |

The load-bearing quality bar the human imposed implicitly: **surgical commits** (only your own changes) and **real coverage** (don't hand-wave e2e behavior into "manual later" when a fake listener can assert it now).

## 6. Skills, tools & memory created — and why they're effective

No new pi skill or memory was created this session — the work rode entirely on the existing **OpenSpec slash-command pipeline** (`/opsx:ff`, `/opsx:apply`, `/opsx:verify`, `/opsx:archive`) and the repo's `editor-manager` conventions.

**What *should* be captured as a reusable skill:** *"surgically commit only my hunks from a dirty repo."* The AI improvised a genuinely reusable technique — extract `git show HEAD:<file>` to a temp copy, apply only your hunks, then `git hash-object -w` + `git update-index --cacheinfo` to swap just that file's index entry, leaving the working tree untouched. That's a repeatable, error-prone-to-do-by-hand move worth a project skill, because dirty-tree commits recur constantly on this repo.

**Effective existing pattern reused:** mirroring `headless-pid-registry.ts` for `editor-pid-registry.ts`. When a new module has a proven sibling, *naming the sibling* turns design + review into a diff against known-good code.

## 7. Pitfalls & dead ends

- **Full `vitest` run kills the pi session** on this machine — always scope to the touched test files (`npx vitest run packages/server/src/__tests__/editor-*.test.ts`). If your session dies mid-suite, this is why.
- **Unportable test paths.** A persistence-failure test using `/proc/1/...` won't work on macOS/Windows. Use `mkdirSync(file)` so the target becomes a directory and the `rename(tmp, file)` fails with EISDIR everywhere.
- **`register` ≠ acceptance ordering trap.** Editor routes are registered early (line ~389) but Fastify only *accepts* after `fastify.listen`. The orphan sweep must run at the top of `server.start()`, before `listen` — not merely "before route registration". Verify against `listen`, not registration, or you'll reason about the wrong gate.
- **Dirty-repo commits.** With ~72 unrelated modified files (some mixed into your own edited files), a naive `git add -A` sweeps in other people's work. Extract-HEAD + hash-object + update-index to stage mine-only.
- **A malformed tool call surfaced an error toast** mid-implementation; nothing had actually executed. Don't treat a visible reasoning-panel error as a real failed side effect — re-check state and continue.
- **Archived with 6 incomplete manual tasks (§6.1–6.6).** The `kill -9` + `ps` orphan-observation steps need a human at the keyboard; the AI cannot reliably observe cross-session process state. Code paths are covered by 31 automated tests, so archiving was accepted — but the true end-to-end (real `code-server` spawned + force-killed) was never run on this machine.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- Evidence of the bug (a real `ps aux | grep code-server` orphan dump).
- The sibling pattern to mirror: `packages/server/src/headless-pid-registry.ts`.
- Touch points: `editor-manager.ts` (3 hooks), `server.ts` (boot sweep), `AGENTS.md` + `docs/architecture.md` (docs).

**Steps:**
1. `explore mode` → trace the shutdown path, confirm orphans survive via a real PID dump. Do NOT implement here.
2. `/opsx:ff add-editor-pid-registry` — generate proposal/design/spec/tasks; tell it to mirror `headless-pid-registry.ts`.
3. `/opsx:apply` — TDD: module + unit tests first, then wire hooks + boot sweep. **Run only targeted test files.**
4. `/opsx:verify` — map every requirement/scenario to a code location; collect the gap list.
5. `fix` — resolve gaps; require a fake `ChildProcess`-with-real-listener integration test instead of deferring e2e.
6. `commit changes` — with the guardrail: *only my hunks; leave the dirty tree untouched* (extract-HEAD + hash-object + update-index for mixed files).
7. `/opsx:archive` — sync delta → main spec, archive; accept manual-verification tasks as deferred if automated coverage is sufficient.

**Final artifacts produced:**
- `packages/server/src/editor-pid-registry.ts` (new module, ~187 lines)
- `packages/server/src/__tests__/editor-pid-registry.test.ts`, `editor-manager-pid-registry.test.ts` (+ hunks in `editor-manager.test.ts`) — 31 tests
- Hooks in `packages/server/src/editor-manager.ts`, boot sweep in `packages/server/src/server.ts`
- Docs: `AGENTS.md` row + `docs/architecture.md` "Orphan Cleanup" subsection
- OpenSpec change archived to `openspec/changes/archive/2026-04-20-add-editor-pid-registry/`; 3 requirements synced into `openspec/specs/editor-manager/spec.md`
- Commit `97dd4bd` — 13 files, +906/-2

---

_Generated from session `019da4e4-b9ea-771c-89e4-11d1beacb2b9` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-19. Source extract: deterministic facts sheet._
