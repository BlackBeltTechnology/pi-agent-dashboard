---
session: 019f0b2b
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [default-node-24-keep-22-floor]
proposal_excerpt: "The Docker all-in-one base image and the standalone-install test script both default to `node:22-bookworm-slim`. Node 22 is fine, but the project already runs Node 24 (and 25) green in CI smoke and uses Node 24 for th…"
---

# How we did it: Default the Docker runtime to Node 24 (keep the 22 floor) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single command:

```
/skill:openspec-apply-change default-node-24-keep-22-floor
```

The real objective, once the proposal was read: **bump the default runtime everywhere
the project ships one — the Docker all-in-one base image and the standalone-install
test script — from `node:22-bookworm-slim` to `node:24-bookworm-slim`, while keeping
Node 22 as a *supported floor*** (unchanged `engines.node >=22.19.0 <26`, unchanged
CI PR lane on Node 22, unchanged `-bookworm-` glibc base so node-pty's N-API prebuild
keeps loading without a recompile). A two-line source change on paper — the work was
proving it non-breaking and getting the verification harness to actually go green.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — let the apply skill read `proposal.md` /
   `design.md` / `tasks.md`, then make the code edits (`docker/Dockerfile` base tag,
   `scripts/test-standalone-npm-install-docker.sh` default `IMAGE`).
2. Confirm the *invariant* tasks by grep, don't touch them: `engines.node` floor, CI
   PR lane `node-version: 22`, glibc base stays `-bookworm-`.
3. Run `npm test 2>&1 | tee /tmp/pi-test.log`; **re-run any single failure in
   isolation** before calling it a regression (timing/perf flakes pass solo).
4. Run the docker smoke harness on **both** the new default and the old floor:
   `./scripts/test-standalone-npm-install-docker.sh` and `... node:22-bookworm-slim`.
5. When the harness fails, **isolate whether the harness is wrong or the change is
   wrong** — prove the core claim directly (`docker run --rm node:24 …` installs
   node-pty from prebuild + allocates a PTY) before editing harness code.
6. Restore any file your tooling churned out of scope (here: `git checkout --
   package-lock.json` after `npm install` rewrote 34k lines).
7. Delegate `docs/` edits to a subagent in caveman style (Documentation Update Protocol).
8. `use skill ship-change` — verify gate, archive + sync specs, commit, push, open PR
   against `develop`, watch CI, confirm CodeRabbit posted a *real* review, squash-merge,
   delete branch, remove worktree.

## 3. How the collaboration unfolded

**Discovery.** The AI read the change's `proposal.md`, `design.md`, and `tasks.md`,
then grepped the two target files to confirm the exact `FROM node:22-bookworm-slim`
and `IMAGE=` lines before editing. Effective because the edit surface was tiny and
verifiable up front — no speculative refactor.

**Implement.** Two surgical edits (Dockerfile base tag + comment, script default
`IMAGE` + usage comments, keeping a `node:22` floor example). Invariant tasks were
*confirmed by grep, not edited* — the discipline that keeps a "bump the default"
change from silently moving the floor.

**Verify (the long tail — ~9h of elapsed clock, most of the real work).** This is
where the session earned its keep. `npm test` threw a timing flake (`doctor-route`,
3505ms vs 3000ms) — the AI **re-ran it in isolation (14/14 green)** and correctly
declined to treat load-induced jitter as a Docker regression. The docker smoke
harness then failed on Node 24, and the AI resisted the reflex to "fix the change":

- **False positive #1** — the harness regex `node-gyp.*rebuild` matched npm 11's new
  `npm warn allow-scripts … node-gyp rebuild` line (Node 24 ships npm 11). Not a gyp
  failure. The AI *proved* it by running `docker run --rm node:24 …` and watching
  node-pty install from its `linux-x64` prebuild with zero `gyp ERR!` and allocate a
  working PTY. **The change was sound; the harness regex was stale.**
- **Harness rot #2** — after the regex fix, *both* Node 22 and Node 24 hit a
  `parse-error` at the health-poll step. Root cause: the harness still polled
  `/api/bootstrap/status`, a route **deleted** by an earlier merged change
  (`eliminate-electron-runtime-install`), so it got SPA HTML back and `JSON.parse`
  choked. Pre-existing, reproduces identically on Node 22, unrelated to the bump.

**Decision points (human gate).** Both harness fixes were *orthogonal to the Node
bump*, so the AI **paused and reported before touching harness code** — asking for a
go-ahead on the regex tweak and again on the more substantive readiness-poll repoint.
The human's approval kept scope honest.

**Ship.** Second prompt `use skill ship-change` drove the full landing flow: gate
(another perf-smoke flake, again confirmed green in isolation), `openspec archive`
(which syncs the `docker-packaging` delta spec Node 22→24 *and* archives in one step),
commit via a message file, push, PR #182 → `develop`, CI watch, a **real** CodeRabbit
review ("No actionable comments 🎉" against HEAD `1a127aa`, verified not a rate-limited
ACK), squash-merge, branch + worktree cleanup.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change default-node-24-keep-22-floor`.
  Effective because the *change already existed* as an OpenSpec artifact: the proposal
  encoded the invariants (floor stays, CI lane stays, glibc stays), so the AI had an
  unambiguous spec to implement and verify against rather than a vague "upgrade Node".
- **High-leverage follow-up** — `use skill ship-change`. One short line handed off the
  entire archive→commit→PR→CI→merge→cleanup pipeline to a disciplined skill.
- **Implicit approvals** — the human's go-aheads on the two harness fixes were the
  turns that unblocked green. A stronger version to bake in: *"if a smoke failure is a
  harness bug orthogonal to this change, fix it in the same PR and note it."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| pause and ask before editing *orthogonal* harness code | approve the regex + readiness-poll fixes | pre-authorize "harness bugs blocking this change's green may be fixed in-PR with a note" |
| trust a red smoke result as a regression | (self-corrected) prove the core claim directly via `docker run` | make "isolate harness-vs-change before editing" a standing verify rule |
| let `npm install` churn `package-lock.json` (34k lines) | restore it: `git checkout -- package-lock.json` | run installs knowing the lockfile is out of scope; revert immediately |
| curl `localhost:8000` and hit the **host** dashboard, not the container | notice `platform: darwin` + 8.7h uptime, retry on a free port | always probe container health from *inside* the container (loopback), on a non-8000 port |

Quality bars the human's skills imposed: re-run flakes in isolation before blaming a
change; keep the diff to only intended files; confirm CodeRabbit is a real review not
an ACK before merging.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — this session *consumed* the project's existing
discipline stack rather than adding to it:

- **`openspec-apply-change`** — turns a spec into checked tasks with verification notes;
  its invariant tasks (grep-confirm, don't edit) are what kept the floor intact.
- **`ship-change`** — the whole landing pipeline as one prompt, including the
  CodeRabbit real-vs-ACK check and the squash-merge cleanup pitfalls.
- **Documentation Update Protocol subagent** — `docs/file-index-docker.md` rows bumped
  to Node 24 in caveman style, delegated to a `general-purpose` subagent.

Recommendation: the two harness bugs (npm-11 `allow-scripts` regex false-match; stale
`/api/bootstrap/status` readiness poll) are worth a **memory** so the next Node bump
doesn't rediscover them from scratch.

## 7. Pitfalls & dead ends

- **npm 11's `allow-scripts` warning trips gyp-failure greps.** Node 24 ships npm 11,
  which prints `npm warn allow-scripts … node-gyp rebuild`. A harness regex like
  `node-gyp.*rebuild` false-matches it. Fix the regex, don't blame the base image.
- **Stale readiness endpoint.** `/api/bootstrap/status` was removed server-side
  (`eliminate-electron-runtime-install`, server.ts:940); the current signal is
  `/api/health` → `{ ok: true }`. Repoint any poller that still hits bootstrap/status.
- **`npm install` rewrites `package-lock.json`.** 34k-line churn, out of scope —
  `git checkout -- package-lock.json` after.
- **Host vs container port collision.** curl to `localhost:8000` hit the *host's*
  pi-dashboard (`platform: darwin`, 8.7h uptime), not the container. Use a free port
  and probe from inside the container over loopback.
- **`VOLUME /home/pi/.pi` before mkdir/chown.** On Docker Desktop / macOS a fresh
  named (or even anonymous) volume mounts root-owned → UID 1000 `EACCES` crash-loop.
  Pre-existing image quirk; sidestep by mounting `/home/pi/.pi` as a UID-1000 tmpfs
  to verify the image itself. (Left as-is — orthogonal to the Node bump.)
- **`gh pr merge` tries to switch to `develop` locally.** That branch is checked out
  by the parent worktree, so the local step fails *after* the merge lands on GitHub.
  Verify state `MERGED` on the remote, then clean up manually.
- **Squash-merge leaves the local branch "unmerged".** git doesn't see a squash as a
  merge — force-delete the local branch after confirming the remote merge.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <change>` — implement the two edits, grep-confirm invariants.
- [ ] `git checkout -- package-lock.json` if `npm install` churned it.
- [ ] `npm test 2>&1 | tee /tmp/pi-test.log`; re-run any failure solo before believing it.
- [ ] `./scripts/test-standalone-npm-install-docker.sh` **and** `... node:22-bookworm-slim`.
- [ ] On a red smoke: prove the claim directly (`docker run --rm node:24 …` → prebuild + PTY) before editing harness code; get a go-ahead for orthogonal harness fixes.
- [ ] Delegate `docs/` row bumps to a caveman-style subagent.
- [ ] `use skill ship-change` → archive+sync, commit (via message file), PR → `develop`, watch CI, verify CodeRabbit is a real review, squash-merge, delete branch + worktree.

**Inputs to have ready:** Docker running; `gh` authenticated; the OpenSpec change
artifact already drafted. **Final artifacts:** `docker/Dockerfile` (Node 24 base),
`scripts/test-standalone-npm-install-docker.sh` (Node 24 default + 2 harness fixes),
`docs/file-index-docker.md`, main spec `openspec/specs/docker-packaging/`, change
archived to `openspec/changes/archive/2026-06-28-default-node-24-keep-22-floor/`,
merged as PR #182 (`348ff2c`).

---

_Generated from session `019f0b2b-90f7-72ab-9797-4b80a22453bf` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-28. Source extract: `/tmp/facts-50244-1784849009.md`._
