---
session: 019e8a4c
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [classify-process-list-entries]
proposal_excerpt: "The session card's PROCESS drawer leaks pi's own process group. The screenshot that triggered this shows three rows — `node v25.8…`, `pi`, `bun …/.pi/agent/npm/node_modules/context-mode/server.bundle.mjs` — none of wh…"
---

# How we did it: classify-process-list-entries — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change classify-process-list-entries
```

The *real* objective, once the spec was read: the session card's **PROCESS drawer
was leaking pi's own process group** — showing raw rows like `node v25.8…`, `pi`,
and the `context-mode` bun sidecar with no meaning attached. The change had to (1)
**hide pi's own pgid** at the bridge so it never enters the tracked set, (2) add an
**additive, back-compatible classification** to the shared protocol (`kind` / `label`
/ `sessionRef`), (3) **classify processes server-side** into sub-session / pi-worker
/ plugin / task buckets, and (4) **render icon + human label** in the client, linking
sub-session rows to their session card. Then land it: implement TDD, validate in a
real browser, monitor CI, merge the PR.

## 2. TL;DR playbook

1. **Kick off the apply skill** against the OpenSpec change name. Let the AI read the
   change's `tasks.md` + spec files before touching code.
2. **Resolve the open decisions first.** The tasks flagged D4/D5/D6 as blockers — the
   AI surfaced them via `ask_user` and the human locked: D4 = generic `"pi worker"`
   label, D5 = link sub-session rows to their card, D6 = `mdi-icon-system` (@mdi/js).
3. **Implement strictly bottom-up, TDD, one task at a time**: bridge `getOwnPgid()` →
   shared protocol fields → pure server classifier → event-wiring → client render.
   Write the test, run just that file with `HOME=$(mktemp -d) npx vitest run <file>`,
   then wire the implementation.
4. **Type-check + full suite**: `npx tsc --noEmit` then `npm test | tee /tmp/pi-test.log`.
   Grep your files out of the log; prove any residual failure is **pre-existing on a
   clean tree** (stash → re-run) before dismissing it.
5. **Validate in a browser from an isolated worktree server** — never against the live
   dashboard. Boot the worktree build on free ports (8400/9400) and drive it.
6. **When live spawns won't hit your worktree code** (mDNS auto-discovers the parent),
   fall back to a synthetic injector that pushes a `process_list` straight into the
   worktree gateway, then read `/api/sessions` to confirm the exact client payload.
7. **Land it**: confirm the worktree is a plain git worktree (not a jj workspace),
   stage only the work files (exclude `.pi/settings.json`), commit, push, open the PR
   with a body **file** (not a heredoc), `gh run watch` to green, then merge.

## 3. How the collaboration unfolded

**Phase 1 — Locate the skill & the change (Discovery).** The apply skill wasn't at the
worktree path; several `find` probes failed before the AI resolved the parent repo's
OpenSpec definitions (see the two steering prompts in §5). It then read the change
status and the `tasks.md`, spotting that **D4/D5/D6 were explicit "resolve before
implementing" blockers**. *Why it worked:* reading tasks-first turned three latent
ambiguities into one `ask_user` batch instead of three mid-implementation stalls.

**Phase 2 — Decisions locked (Design).** The human chose generic label / link rows /
mdi icons. The AI then read every source file it would touch before writing a line.

**Phase 3 — Bottom-up TDD build (Generate).** Six task groups, strictly in dependency
order: `getOwnPgid()` in the scanner → seed `selfSpawnedPgids` in `bridge.ts` → shared
`ProcessKind` + optional fields on three protocol shapes → a **pure**
`process-classifier.ts` (`classifyProcesses` + `buildPidIndex`, connected-sessions-only
with a pid-reuse guard) → event-wiring handler → client `ProcessList` with a shared
`ProcessRow` (DRY across compact/full) and a threaded `onNavigateToSession`. Each task:
test first, run the single file, then implement. *Why it worked:* the pure classifier
made the core logic testable without any transport, and the additive protocol fields
kept every existing test green.

**Phase 4 — Suite + docs (Verify).** `tsc --noEmit` clean except a **pre-existing**
`error-patterns.test` rootDir issue; full suite green except a **pre-existing flaky**
`image-fit-extension` timeout — the AI proved both by stashing its changes and re-running
on the clean tree. Docs: the `Explore` subagent role failed to resolve (roles plugin not
loaded), so the AI made the caveman-style file-index edits directly.

**Phase 5 — Browser validation (Verify, the hard part).** The running dashboards (:8000,
:8300) serve *other* repos, so the AI booted **this worktree's** build on 8400/9400.
Real spawned sessions auto-discovered the **parent** via mDNS and loaded the parent's
bridge — so it switched to a **synthetic `process_list` injector** hitting the worktree
gateway directly, then read `/api/sessions` to confirm the classifier output byte-for-byte.
The mobile modal sheet proved un-automatable (1s global re-render invalidated refs), which
the AI correctly diagnosed as a **harness limitation, not a code defect**.

**Phase 6 — Land it (Ship).** Confirmed plain-git-worktree safety, committed 18 files
(excluding `.pi/settings.json`), pushed, opened PR #72 (body file, not heredoc — the
apostrophes/backticks tripped the shell), watched CI to green (ci + CodeRabbit), merged.
Auto branch-delete failed (develop checked out in the parent) so it deleted the remote
branch manually.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change classify-process-list-entries`.
  Effective because the change was already fully specified in OpenSpec; the skill name +
  change name is all the kickoff needs. *Stronger version for next time:* add "use the
  parent worktree's OpenSpec skills" up front (see §5) to skip the skill-resolution
  detour.
- **`can you run and validate with browser?`** — high-leverage: it forced real
  end-to-end proof and surfaced the isolated-server + injector technique that the code
  alone wouldn't have exercised.
- **`Monitor CI`** — short, unlocked the whole land sequence (commit → push → PR → watch).
- **`merge PR`** — one-word close-out once CI was green.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Hunt for the apply skill locally / with broad `find /` probes when in a worktree | "Use paren't openspec definitions in workspace" / "Use paren't worktree parent directory's openspec skills wgen in git worktree" | State up front: *in a worktree, resolve OpenSpec skills from the main repo root* (already an AGENTS.md convention — apply it immediately) |
| Consider implementation "done" after unit tests | "can you run and validate with browser?" | Treat a UI-affecting change as unfinished until validated in an **isolated** worktree browser |
| Assume "landed" == code written | "Monitor CI" then "merge PR" | For UI/protocol changes, plan the commit→push→PR→CI→merge sequence as part of the task |

Quality bars the human implicitly imposed: nothing merges without CI green + CodeRabbit;
validation must be real (browser), not asserted.

## 6. Skills, tools & memory created — and why they're effective

No new skill was created this session. The session **re-used** `openspec-apply-change`
and spawned one `Explore` subagent (which failed to resolve — roles plugin not loaded).

**Recommended skill to create — "isolated worktree UI validation":** the reusable win
here is the pattern *boot the worktree build on free ports → if mDNS steals live spawns,
inject a synthetic `process_list` into the worktree gateway → read `/api/sessions` to
confirm the exact client payload → tear everything down and confirm the parent recovered.*
It removes the guesswork every time a UI/protocol change can't be trusted from unit tests
alone. (This repo now ships an `isolated-ui-verification` skill covering exactly this —
invoke it instead of re-deriving the port/injector dance.)

## 7. Pitfalls & dead ends

- **Skill resolution in a worktree** — `find /` for the SKILL.md is slow and fails; use
  the parent repo root's `.pi/skills/` directly.
- **mDNS hijacks spawned sessions** — headless sessions spawned via the worktree API
  auto-discover the **parent** dashboard and load its bridge, so they never exercise
  worktree code. Don't spawn real sessions to validate; inject synthetically.
- **Mobile modal sheet is un-automatable** — the dashboard's 1s global elapsed-timer
  re-render invalidates browser refs and closes the sheet. `isMobile` triggers on
  viewport **height < 600px**. This is a harness limit; verify via DOM text / `/api/sessions`,
  not screenshot round-trips.
- **PR body via heredoc breaks** on apostrophes/backticks — write the body to a file and
  pass `--body-file`.
- **`--delete-branch` fails in a worktree** when `develop` is checked out in the parent —
  delete the remote branch manually (`git push origin --delete <branch>`).
- **Pre-existing failures masquerade as yours** — `error-patterns.test` rootDir error and
  the flaky `image-fit-extension` timeout both fail on a clean tree; stash + re-run to
  prove it before spending time.
- **Excluded file** — `.pi/settings.json` showed as modified but was unrelated; stage only
  the 18 work files.

## 8. Reproduce it faster — checklist

- [ ] In the worktree, resolve OpenSpec skills from the **parent repo root**.
- [ ] `openspec` read the change's `tasks.md` + specs; **resolve all open decisions via one
      `ask_user` batch** before coding.
- [ ] Implement bottom-up TDD: scanner → bridge → shared protocol → pure classifier →
      event-wiring → client. One task, one test file (`HOME=$(mktemp -d) npx vitest run <f>`).
- [ ] `npx tsc --noEmit`; `npm test | tee /tmp/pi-test.log`; grep your files; prove any
      residual failure pre-exists via stash + re-run.
- [ ] Update the docs file-index rows (caveman style) + `See change:` annotations.
- [ ] Boot the worktree build on free ports (8400/9400); validate in browser; if mDNS
      steals spawns, inject a synthetic `process_list` and read `/api/sessions`. Tear down,
      confirm the parent recovered.
- [ ] Confirm plain-git-worktree; stage the work files only (exclude `.pi/settings.json`);
      commit; push.
- [ ] `gh pr create --body-file <f>`; `gh run watch`; on green (ci + CodeRabbit) merge;
      delete the remote branch manually if auto-delete fails.

**Key inputs:** the OpenSpec change name; a running local dashboard for port reference;
`gh` auth. **Final artifacts:** `packages/server/src/process-classifier.ts` (+tests),
edits across extension/shared/server/client, the four `docs/file-index-*.md` rows, and
merged PR #72 (squash `cc147414` on `develop`).

---

_Generated from session `019e8a4c` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-03. Source extract: `/tmp/facts-1784849709N.md`._
