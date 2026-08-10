---
session: 019dfaa4
week: 2026/W19
type: documentation
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: Release 0.5.0 — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a readiness question, not a command: *"Is it ready to release
new version?"* The real objective surfaced with the one-word-plus steering reply
**"yes and after release the page"** — cut a proper SemVer release of
`pi-agent-dashboard` (promote the `[Unreleased]` changelog, bump every workspace
version, commit, tag, push to trigger the Release workflow) **and** open the
GitHub Actions + Releases pages so the human can finish the draft-release publish.
In short: go from "is it ready?" to a pushed `v0.5.0` tag with CI running, in one
7-minute pass.

## 2. TL;DR playbook

1. Ask the AI: *"Is it ready to release a new version?"* — let it run the readiness audit.
2. It checks: clean tree, current branch/version, `git fetch`, and reads the
   `[Unreleased]` changelog block to size the bump.
3. It proposes a SemVer bump with reasoning (here: `0.5.0` minor — user-visible
   breaking changes but nothing API-incompatible) and offers the `release-cut` skill.
4. Reply **"yes and after release the page"** to authorize the cut *and* the browser open.
5. Gate on green: `npm test` (4550 passing) + `npm run build` clean before touching versions.
6. Bump: `npm version 0.5.0 --workspaces --include-workspace-root --no-git-tag-version`,
   then `node scripts/sync-versions.js`, then `npm install --package-lock-only`.
7. Verify the diff is **only** version + changelog (`git diff --stat`) before committing.
8. `git commit -m "chore(release): v0.5.0"` → `git tag v0.5.0` → `git push` (tag pushes trigger CI).
9. `open` the Actions + Releases URLs; hand the human the publish-the-draft steps.

## 3. How the collaboration unfolded

**Phase 1 — Readiness audit (Discovery).** The AI ran `git status`, `git log`,
`git fetch`, and `head`/`grep` over `CHANGELOG.md` and every `package.json`. It
established: working tree clean, on `develop`, up to date, currently `0.4.6`
everywhere, and a substantial `[Unreleased]` block. **Why it worked:** it treated
"is it ready?" as an evidence question, not a yes/no guess — it gathered the facts
that *justify* a version decision before proposing one.

**Phase 2 — Bump decision (Design).** It read the Added/Changed/Fixed entries,
flagged the user-visible breaking changes (NSIS dropped, `mode.json` migration,
`/terminal/:id` route removed, sessions snapshot protocol change), and reasoned to
`0.5.0` minor — *breaking to users but not API-incompatible → not a major.* It then
asked permission to invoke `release-cut`. **Decision point:** the human authorized
with "yes and after release the page," adding the browser-open scope.

**Phase 3 — Gate & bump (Generate).** `npm test` (4550 pass) and `npm run build`
clean were the go/no-go gate. Only then: `npm version … --workspaces`,
`sync-versions.js`, and `npm install --package-lock-only` to reconcile the lockfile.

**Phase 4 — Land & hand off (Verify).** It confirmed the diff was *only* version +
changelog before `commit` → `tag v0.5.0` → `push`, then `open`ed the Actions and
Releases pages and wrote the human's remaining steps (watch CI, verify the draft
release body/artifacts, click Publish).

## 4. Prompts that worked

- **The goal prompt — "Is it ready to release new version?"** Effective because it
  invites an *audit* rather than an action: the AI returns evidence + a recommended
  bump you can approve, instead of blindly cutting a release. A stronger explicit
  version: *"Audit whether we're ready to release; if so, recommend the SemVer bump
  with reasons and cut it with the release-cut skill, then open the CI pages."*
- **High-leverage follow-up — "yes and after release the page."** A tiny prompt that
  authorized the whole `release-cut` flow *and* expanded scope to open the release
  page. This is the pattern: approve the proposed plan + append the one extra thing
  you want in the same breath.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "is it ready?" and wait for a go | "yes and after release the page" | State up front: "if ready, cut it and open the CI pages" |
| Cut a release without the post-push follow-through | Adding "…and after release the page" | Make "open Actions + Releases + list publish steps" part of the release-cut definition of done |

There were **no course-corrections on the technical decisions** — the bump size,
gate order, and diff-verification were all accepted as-is. The only steering was
scope (approve + open the page), which is a sign the readiness-audit framing was solid.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session *consumed* the existing
`release-cut` skill (with `release-revoke` named as the rollback path). That skill
is exactly what made this reproducible: it encodes promote-changelog → bump all
workspaces → sync-versions → lockfile → commit → tag → push, so the AI only had to
supply the version number and the go/no-go gate. **Invoke `release-cut` next time**
the changelog has a real `[Unreleased]` block and tests are green; keep
`release-revoke` in your back pocket if the draft release looks wrong.

## 7. Pitfalls & dead ends

- **Zero failed commands this session** — but the safeguards are the lesson:
  - Don't skip the gate: `npm test` + `npm run build` **before** bumping versions,
    not after. A red build after a pushed tag means a `release-revoke`.
  - After `npm version --workspaces`, you *must* run `sync-versions.js` and
    `npm install --package-lock-only`, or the lockfile/derived versions drift.
  - Verify `git diff --stat` shows **only** version + changelog before committing —
    an accidental extra file in a `chore(release)` commit pollutes the tag.
  - Tag pushes trigger CI; the GitHub Release lands as a **draft** — a human still
    has to verify artifacts and click Publish. Don't assume "pushed" == "released".

## 8. Reproduce it faster — checklist

- [ ] Working tree clean, on the release branch, `git fetch` up to date.
- [ ] Read `[Unreleased]` in `CHANGELOG.md`; decide SemVer bump (breaking-to-users
      but API-compatible → minor).
- [ ] `npm test` green + `npm run build` clean (the go/no-go gate).
- [ ] `npm version <v> --workspaces --include-workspace-root --no-git-tag-version`.
- [ ] `node scripts/sync-versions.js` → `npm install --package-lock-only`.
- [ ] `git diff --stat` shows only version + changelog.
- [ ] `git commit -m "chore(release): v<v>"` → `git tag v<v>` → `git push` (+ tag).
- [ ] `open` Actions + Releases; verify draft release, then Publish.

**Inputs needed:** push rights to origin, a populated `[Unreleased]` changelog block,
the `release-cut` skill available. **Artifacts produced:** edited `CHANGELOG.md`,
bumped `package.json` (root + all workspaces) + `package-lock.json`, commit
`chore(release): v0.5.0`, tag `v0.5.0`, triggered Release workflow.

---

_Generated from session `019dfaa4-d5b6-76ea-a370-0fa4d50d207a` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-06. Source extract: session facts sheet._
