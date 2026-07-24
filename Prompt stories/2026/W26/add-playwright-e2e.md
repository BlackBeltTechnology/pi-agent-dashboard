---
session: 019ef264
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies)"
upgrade_status: pending
openspec_changes: [add-playwright-e2e]
proposal_excerpt: "QA today splits in two and neither layer drives the browser end-to-end:"
---

# How we did it: Add a Playwright browser-E2E suite against the Docker harness — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single command: `/skill:openspec-apply-change add-playwright-e2e`.
No prose, no explanation — the intent lived entirely in the OpenSpec change already on
disk. The *real* objective (from the proposal excerpt) was: **QA today splits in two and
neither layer drives the browser end-to-end** — so add a Playwright browser-E2E layer that
boots the existing Docker all-in-one harness, renders the real dashboard UI, runs specs,
and tears everything down cleanly. The scope was deliberately narrow: harness wiring +
config + lifecycle + one trivial smoke spec. The eight scenario tasks (§5.1–5.8) were an
**explicitly deferred backlog**, not part of this change.

The second (and only other) prompt came ~4h later and was a pure post-implementation
pipeline: `1. I will tests manual later 2. archive / sync 3. create PR 4. monitor CI
5. fix coderabbit issues 6. merge PR 7. delete branch 8. delete worktree`.

## 2. TL;DR playbook

1. **Kick off with the skill, not a description:** `/skill:openspec-apply-change add-playwright-e2e`.
   The change artifacts (proposal + tasks.md) carry the scope, so the AI reads context
   instead of guessing.
2. **Read the depended-on infra first** — client shell selectors (`header-app-bar`,
   testids), the Docker `test-up.sh`/`test-down.sh` scripts, the site's existing
   `playwright.config` as a reference. Don't invent selectors.
3. **Implement in the tasks.md order:** §1 deps+scripts+gitignore → §2/§3 config+lifecycle
   → §4 helpers+smoke spec → §6 docs → §7 verification.
4. **Verify cheaply before booting anything:** `playwright test --list` (specs parse),
   repo `tsc` lint, and confirm **vitest's `include` glob does NOT swallow `tests/e2e`**
   (`npx vitest list | grep tests/e2e` must be empty).
5. **Run the full managed lifecycle once** (`npm run test:e2e`): boot container → poll
   `/api/health` → run specs → `test-down.sh`. Snapshot `~/.pi` before/after to prove the
   harness leaves the host byte-identical.
6. **If the chromium download times out**, pin `@playwright/test` to a version whose
   chromium revision is *already cached* (here: 1.57.0 → revision 1200) instead of fighting
   the CDN. Force the exact version — a `^` range may keep the newer pin in the lockfile.
7. **Land it:** archive+sync the OpenSpec change (`yes | openspec archive <name>`), commit,
   push, `gh pr create` against `develop`, poll CI + CodeRabbit, apply CodeRabbit fixes,
   re-push, `gh pr merge --squash --delete-branch`, then `git worktree remove`.

## 3. How the collaboration unfolded

**Phase A — Context load (§ read).** The AI resolved the change with `openspec status` +
`openspec instructions apply`, then read the client `index.html`, `ConnectionStatusBanner`,
`SessionList`, and the site playwright config to find **stable selectors** and a config
template. It committed to implementing §1–4, §6, §7 and skipping the deferred §5 backlog.
*Why it worked:* grounding selectors and config in real source removed a whole class of
flaky-test rework.

**Phase B — Build (§1–§4).** Deps + scripts + gitignore, then `playwright.config.ts`
(`testDir tests/e2e`, `baseURL :18000`, chromium, globalSetup/teardown, 10s expect / 15min
global timeout, `retries CI?1:0`), then the lifecycle module (`lifecycle.ts` shared
paths/health-poll/marker, `global-setup.ts` booting `test-up.sh` from a throwaway tmp
workspace and polling `/api/health` 180s, `global-teardown.ts` calling `test-down.sh`),
then helpers (`gotoDashboard()` + a `TESTIDS` map) and a smoke spec (shell renders +
negative-hold WS proof: no `role=alert` banner in 5s).

**Phase C — Cheap verification.** Specs parsed via `--list`; `tsc` lint stayed green; the
AI proactively checked that `smoke.spec.ts` wouldn't be picked up by vitest's default glob.
*Decision point:* verify the vitest boundary **before** the expensive container boot.

**Phase D — Docs.** README written directly; the `file-index` update **delegated to a
general-purpose subagent** per the repo's docs-write protocol; AGENTS.md convention already
present from the proposal.

**Phase E — Integration verify (§7).** Full managed E2E boot→specs→teardown, with a
before/after `~/.pi` shasum snapshot to prove no host mutation. First run failed only
because Playwright 1.61.0 needed a newer chromium than cached — the CDN then timed out. The
AI pivoted to **pinning to a cached revision** rather than retrying the download. Both the
managed path and the `PW_E2E_USE_RUNNING=1` fast path passed.

**Phase F — Ship pipeline.** Triggered by prompt 2: archive+sync, commit, push, PR #154,
poll CI + CodeRabbit (both green), apply 2 CodeRabbit fixes (close a leaked `logFd`, add a
120s teardown timeout), re-push, squash-merge, delete branch + worktree.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change add-playwright-e2e`.** Effective
  *because the spec did the talking.* When an OpenSpec change already encodes scope +
  tasks + deferred backlog, the shortest kickoff is to point the apply skill at it. No
  need to re-describe the feature in prose.
- **The pipeline prompt — the 8-step numbered list.** A high-leverage batch: one message
  drove archive → PR → CI → CodeRabbit → merge → cleanup. *Why it worked:* it front-loaded
  every downstream decision ("I'll test manually later", "squash+delete") so the AI never
  had to stop and ask. **Reuse this pattern:** hand the ship pipeline as a numbered list,
  not one step at a time.
- **Stronger version of the goal prompt for a future run:** `/skill:openspec-apply-change
  add-playwright-e2e — verify the ~/.pi host dir stays byte-identical, and if the chromium
  CDN is slow, pin to a cached revision instead of downloading.` Bakes the two hard-won
  lessons into the kickoff.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation, unsure whether to ship | Sending the explicit 8-step pipeline ("archive / sync / PR / CI / fix / merge / delete") | Include the ship pipeline in the kickoff so apply→land is one continuous run |
| Treat all 30 tasks as in-scope | (Self-corrected from tasks.md) — §5.1–5.8 marked "authored later, NOT in this change" | Keep the deferred backlog clearly labelled in tasks.md so scope is unambiguous |
| Want manual testing done in-session | "I will tests manual later" | State manual-QA ownership up front so it isn't a blocker |

Most steering here was *self-steering*: the AI read the deferred-backlog marker in tasks.md
and correctly declared 22/30 tasks = "all in-scope done." The one human redirect was simply
supplying the ship sequence.

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved (tool-quirk / failure):** *"Playwright browser download CDN
  (cdn.playwright.dev) can time out / be blocked in some envs. When `npx playwright install
  chromium` fails, pin `@playwright/test` to a version whose chromium revision is already
  cached."* — Captures the single biggest time-sink of the session (≈20 min lost to CDN
  timeouts). **When to invoke:** any Playwright setup on a flaky-network or offline machine;
  check the cached `~/Library/Caches/ms-playwright` revisions and map them to a Playwright
  version via `unpkg.com/playwright-core@<v>/browsers.json`.
- **No skill was created, but one should be:** a `run-dashboard-e2e-local-changes` /
  offline-Playwright-pin procedure. (Note: the repo now ships a
  `run-dashboard-e2e-local-changes` skill — that's exactly the reusable shape this session
  proved out.)

## 7. Pitfalls & dead ends

- **Disk full mid-install.** First `npm install` failed with 1.6Gi free. Fix: the npm
  cache was 14G and safely recoverable — `npm cache clean --force` freed ~15Gi. If install
  dies on space, clear `~/.npm/_cacache` first.
- **Chromium CDN timeout.** `npx playwright install chromium` hung on
  `cdn.playwright.dev`. Don't retry the download in a blocked env — **pin to a cached
  revision** (1.57.0 → chromium 1200 here) and let `npm install` resolve the already-cached
  browser offline.
- **`^` range keeps the newer pin.** After setting `^1.57.0`, the lockfile still resolved
  1.61.0. Fix: `npm install -D @playwright/test@1.57.0` (exact) to force the downgrade.
- **BSD `find` lacks `-printf`.** The `~/.pi` snapshot command failed on macOS. Fix: use
  `stat -f '%z %m %N'` piped to `shasum` instead.
- **`openspec archive` blocked on a prompt.** `openspec archive <name>`, `echo y | …`, and
  `printf "y\ny\n" | …` all failed. Fix: `yes | openspec archive <name>`.
- **`gh pr create` needs the right base.** First attempt failed; the default branch is
  `develop` — pass `--base develop` explicitly.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change on disk (`add-playwright-e2e`), the Docker
`pi-dashboard:local` image built, chromium cached in `~/Library/Caches/ms-playwright`,
`gh` authenticated, a git worktree on `os/add-playwright-e2e`.

- [ ] `/skill:openspec-apply-change add-playwright-e2e`
- [ ] Read client shell selectors + `test-up.sh`/`test-down.sh` + site playwright config
- [ ] Implement §1 deps/scripts/gitignore → §2/§3 config+lifecycle → §4 helpers+smoke spec
- [ ] Cheap verify: `playwright test --list`, `tsc` lint, `vitest list | grep tests/e2e` (empty)
- [ ] Write README directly; delegate `file-index` rows to a subagent
- [ ] If chromium download times out → pin `@playwright/test` to a cached revision (exact version)
- [ ] Full managed run `npm run test:e2e` with `~/.pi` before/after shasum snapshot
- [ ] Fast path: `PW_E2E_USE_RUNNING=1` against a manually-booted container; then `test-down.sh`
- [ ] `yes | openspec archive add-playwright-e2e` → commit → push
- [ ] `gh pr create --base develop` → poll CI + CodeRabbit → apply fixes → re-push
- [ ] `gh pr merge <n> --squash --delete-branch` → `git worktree remove .worktrees/os-add-playwright-e2e`

**Artifacts produced:** `playwright.config.ts`, `tests/e2e/{lifecycle,global-setup,global-teardown}.ts`,
`tests/e2e/helpers/index.ts`, `tests/e2e/smoke.spec.ts`, `tests/e2e/README.md`, plus edits to
`package.json`, `.gitignore`, and `openspec/changes/add-playwright-e2e/tasks.md`. Landed as PR #154.

---

_Generated from session `019ef264-5d03-7759-9f33-536b7a10d564` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-23. Source extract: `/tmp/facts-10124-1784864105.md`._
