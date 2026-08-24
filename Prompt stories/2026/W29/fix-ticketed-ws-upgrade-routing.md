---
session: 019f5a9b
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-ticketed-ws-upgrade-routing]
proposal_excerpt: "Every paired/remote device (phone browser, installed PWA) is unable to open the main dashboard WebSocket, so after a successful QR pairing the client shows **\"Offline\"** and never receives session data. Root cause: th…"
---

# How we did it: Fix ticketed WS upgrade routing — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a throwaway check — `"Is kb_search available and working?"` —
but the *real* objective landed one prompt later: `/skill:openspec-apply-change
fix-ticketed-ws-upgrade-routing`. The user wanted an already-scoped OpenSpec change
implemented end-to-end and shipped. The change fixes a real regression: after a
successful QR pairing, every paired/remote device (phone browser, installed PWA) fails
to open the main dashboard WebSocket and shows **"Offline"** forever. Root cause: the
server's `on("upgrade")` handler dispatched on an **exact** `request.url === "/ws"`
match, so an *authorized* ticketed upgrade at `/ws?ticket=<t>` was destroyed by its own
query string. The job: apply the change (TDD), verify, and land it on `develop`.

## 2. TL;DR playbook

1. Confirm the change context: `openspec status --change <name> --json` + read the
   proposal/spec/tasks files.
2. **Write the regression test FIRST** (TDD red): a real HTTP-upgrade integration test
   via `createTestServer` + a real `WsTicketStore`, simulating remote clients with an
   `x-forwarded-for` header so the *ticket* is what authorizes the upgrade.
3. Run it scoped to the package with an ephemeral HOME to isolate config:
   `cd packages/server && HOME=$(mktemp -d) npx vitest run src/__tests__/ws-upgrade-routing.test.ts`.
   Confirm it reproduces the bug (red on the ticketed-open cases only).
4. Apply the fix in `server.ts`: replace the `request.url === "/ws"` exact-match chain
   with `switch (routeScopeForUrl(request.url))` — `routeScopeForUrl` strips the query
   string, so `/ws?ticket=<t>` routes identically to bare `/ws`.
5. Re-run the suite → green. Then `npm test` for the full run; triage any failures as
   **yours vs pre-existing/environment** before trusting them.
6. Verify the branch base is clean: `git log --oneline origin/develop..HEAD`. If stray
   commits or a stale base appear, **back up your 3 fix files, `git reset --hard
   origin/develop`, re-apply**, never commit a mass reversion.
7. `openspec archive <name> --yes` (syncs the spec delta + moves to archive/), commit
   with a file-based message, push, open PR against `develop`.
8. Watch CI (`gh pr checks <n> --watch`), confirm CodeRabbit did a *real* review (not a
   rate-limit ACK), then `gh pr merge <n> --squash --delete-branch` and remove the
   worktree **from the parent repo**.

## 3. How the collaboration unfolded

**Discovery → Understand the upgrade path.** The AI read the proposal, spec, and tasks,
then greppped for `routeScopeForUrl`, `on("upgrade")`, `ws-ticket`, and `WsTicketStore`
to map how the server dispatches WS upgrades and how tickets are validated. It located
the buggy exact-match block and the existing `createTestServer` harness. *Why it
worked:* it reconstructed the full call path before touching a line.

**TDD red.** It wrote `ws-upgrade-routing.test.ts` at the HTTP-upgrade layer (real
server, real ticket store), used `x-forwarded-for` to make clients look remote, and ran
it scoped to `packages/server` with `HOME=$(mktemp -d)`. The test failed on exactly the
3 ticketed-open cases and passed the 4 negative/local guards — the bug reproduced
cleanly.

**Fix + verify.** One `switch (scope)` replaced the exact-match chain. Suite went 7/7
green; the broader WS/ticket/auth suites stayed green. `npm test` surfaced 18 failures —
all in **unrelated packages** (`pi-image-fit-extension` Jimp-constructor errors + one
`browse-endpoint` worktree artifact). The AI proved they were pre-existing/environment
(stale worktree `node_modules` resolving jimp 0.16 instead of the declared ^1.6.1) and
not caused by its diff.

**The decision point — a dirty branch.** During the verify gate the AI found a **stray
commit** (`d6f794531`, a `focus-driven-folder-compaction` docs commit) riding on its
branch, plus the WS fix still uncommitted. It **stopped and reported** rather than
committing. The user replied *"I rebased and it is pushed to develop. Recheck"* —
prompting a `git range-diff` that confirmed both docs commits were now byte-identical on
`origin/develop`. A `git reset --soft` then exposed a *worse* problem: the branch base
was far behind the rebased develop, so the soft reset staged a mass **reversion** of
merged work. The AI refused to commit that, backed up its 3 files, `git reset --hard
origin/develop`, and cleanly re-applied only its fix.

**Ship.** `openspec archive` synced the `bearer-device-auth` delta and moved the change
to archive/. Commit → push → PR #297 → CI green (10m41s) → CodeRabbit "No actionable
comments" (verified as a real review, not a rate-limit placeholder) → squash-merge →
worktree removed from the parent repo.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change fix-ticketed-ws-upgrade-routing`. A
  single skill invocation with the change name handed the AI a fully-scoped spec and let
  it run the whole apply→ship pipeline. The strength: the *change was already written*,
  so the AI had an unambiguous target.
- **High-leverage steering** — `"I rebased and it is pushed to develop. Recheck"`. Three
  words of ground truth unblocked the AI from a git ambiguity it had correctly refused to
  guess through. Feeding the AI the *state change you just made externally* is far
  faster than letting it re-derive git history.
- **`yes`** — a one-word approval on a manual-QA gate, keeping the flow moving.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Discover a stray commit + dirty base and **pause for a human call** | "I rebased and it is pushed to develop. Recheck" | Rebase the worktree onto fresh `origin/develop` **before** invoking apply, so the base is clean from the start |
| Treat a full `npm test` run's failures as blocking | (self-corrected) proving 18 failures were pre-existing env artifacts | Know the worktree's stale `node_modules` produces jimp/browse-endpoint red; scope the gate to the touched suite + `npm run build` |
| Risk committing a `soft reset` mass reversion | (self-corrected) hard-reset to `origin/develop` + re-apply 3 files | When base drift is detected, always back up your changed files and re-apply on a clean base — never commit a diff you didn't intend |

The consistent quality bar the human's environment enforced: **a PR must carry only its
own change** — no stray commits, no reverting merged work.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session ran entirely on existing skills
(`openspec-apply-change`, then the ship flow) and existing test infrastructure
(`createTestServer`, `WsTicketStore`). That's the right call: the workflow *is* already
captured. The one reusable pattern worth internalizing (and a candidate for a project
memory) is the **HTTP-upgrade-layer regression-test recipe**: real `createTestServer` +
real ticket store + `x-forwarded-for` to simulate a remote client so a *ticket*, not
locality, authorizes the upgrade — run with `HOME=$(mktemp -d)` to isolate config.
Invoke it whenever a WS auth/routing regression needs a deterministic reproduction.

## 7. Pitfalls & dead ends

- **`grep` misses on symbol names** — `validateWsUpgrade`, `isGenuinelyLocal`, and the
  `AuthConfig` type weren't where first guessed (`bearer-auth.ts` / `server/src`); the
  type actually lives in `packages/shared/src/config.ts`. If a grep returns empty, widen
  to `grep -rn` across `packages/` before assuming the symbol doesn't exist.
- **Full `npm test` in a worktree is noisy** — stale `node_modules` resolves jimp
  `0.16.13` (not the declared `^1.6.1`), so `pi-image-fit-extension` throws "Jimp is not
  a constructor" and `browse-endpoint` chokes on a `node_modules` listing. These are
  environment artifacts; CI's fresh `npm ci` passes. Don't chase them.
- **`git reset --soft` on a drifted base stages a reversion** — if your branch base is
  behind a rebased `origin/develop`, a soft reset will stage the *removal* of all the
  merged work between them. Hard-reset to `origin/develop` and re-apply your files
  instead.
- **`--delete-branch` collides with the parent worktree** — squash-merge succeeded but
  `--delete-branch` failed trying to update the local `develop` checked out in the parent
  worktree. The remote merge is done regardless; delete the remote branch manually.
- **Removing the worktree pulls the shell's cwd out** — the session's Bash cwd was inside
  the removed worktree, so subsequent shell commands fail. Cosmetic only; the ship was
  already complete. Start a fresh session in the parent repo.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a written OpenSpec change (proposal + spec + tasks), a clean
worktree rebased on `origin/develop`, `gh` authenticated.

- [ ] `git fetch && git reset --hard origin/develop` in the worktree — clean base first.
- [ ] Read proposal/spec/tasks; map the upgrade path (`routeScopeForUrl`, `on("upgrade")`,
      `WsTicketStore`).
- [ ] Write the HTTP-upgrade regression test (`createTestServer` + real ticket store +
      `x-forwarded-for`); run with `HOME=$(mktemp -d)`; confirm **red**.
- [ ] Apply the `switch (routeScopeForUrl(request.url))` fix in `server.ts`; suite → green.
- [ ] Scope the verify gate to the touched suite + `npm run build`; skip known env-red.
- [ ] `openspec archive <name> --yes`; commit (file-based message); push; PR vs `develop`.
- [ ] Watch CI; confirm CodeRabbit is a real review; `gh pr merge --squash --delete-branch`.
- [ ] Delete remote branch manually if the collision fires; `git worktree remove` from the
      parent repo.

**Final artifacts produced:**
- `packages/server/src/server.ts` — `switch (scope)` WS-upgrade routing (query-safe).
- `packages/server/src/__tests__/ws-upgrade-routing.test.ts` — 7-test regression suite.
- `openspec/specs/bearer-device-auth/**` — synced delta; change archived.
- **PR #297 — MERGED** → squash commit `8632e261` on `develop`.

---

_Generated from session `019f5a9b-b3aa-7175-b800-73c5cb939fab` · `pi-agent-dashboard/.worktrees/os-fix-ticketed-ws-upgrade-routing` · 2026-07-13. Source extract: deterministic session facts sheet._
