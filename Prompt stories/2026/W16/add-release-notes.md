---
session: 019da6db
week: 2026/W16
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [add-release-notes, add-editor-pid-registry]
proposal_excerpt: "The project has shipped 10 tagged releases (v0.2.0 → v0.2.9) with no CHANGELOG.md, no release notes in GitHub Releases, and no convention for writing them. Tag messages are one-line commit summaries, most of which a…"
---

# How we did it: Add CHANGELOG + release-notes convention — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** — a thinking-partner stance, not an implementation
run: *"Enter explore mode. Think deeply… You may read files, search code, and investigate…
but you must NEVER write code or implement features… You MAY create OpenSpec artifacts."*
No concrete task was stated up front; the operator wanted to *think through* a gap first.

The real objective emerged in the first exchange: the repo had shipped **10 tagged releases
(v0.2.0 → v0.2.9) with no `CHANGELOG.md`, no GitHub Release notes, and no convention** for
writing them. The goal became: **establish a release-notes system** — a Keep-a-Changelog
`CHANGELOG.md`, a `docs/release-process.md` convention, and a CI tweak so `publish.yml`
derives the GitHub Release body from the changelog — captured as a full OpenSpec change and
implemented in one session.

## 2. TL;DR playbook

1. **Start in explore mode** to map the landscape before deciding shape: `git tag --sort=-version:refname`, `git log v0.2.9..HEAD` (count + subjects), check for any existing `CHANGELOG*`/`RELEASE*`.
2. Let the AI **present forks** (Scope: backfill vs forward-only vs both · Format: Keep-a-Changelog vs Conventional Commits) and **pick explicitly** — here: *both* (collapsed v0.2.x backfill + rich next-release entry), Keep-a-Changelog style.
3. `create proposal` → then **fast-forward the artifacts**: `openspec new change add-release-notes`, then proposal → design → specs → tasks until `validate --strict` is clean.
4. **Apply the tasks in one pass**: write `CHANGELOG.md` (Unreleased + `[0.3.0]` grouped from the 33 unreleased commits + collapsed `[0.2.0 – 0.2.9]` backfill), `docs/release-process.md`, the `publish.yml` awk-extraction step, and README/AGENTS links.
5. **Smoke-test the extraction locally** before trusting CI: run the awk with a real version (captures content) and a bogus version (0 bytes → triggers graceful fallback).
6. `verify` (requirement → evidence map), then `archive` (syncs the delta spec into `openspec/specs/release-notes/`; fix the auto-inserted `TBD` purpose line).
7. **Commit surgically**: the working tree had unrelated WIP — stage only your hunks from mixed files, unstage pre-staged foreign files, commit with `--no-verify`, and restore the other WIP.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI refused to implement and instead *mapped the
landscape*: enumerated all 10 tags with one-line messages, counted 33 commits since v0.2.9,
confirmed no changelog existed. It rendered the state as an ASCII diagram and then **stopped
to offer forks** (scope × format) rather than silently choosing. *Why it worked:* the
explore stance forced a shared mental model before any file was touched, and the fork menu
made the human's decision explicit and cheap.

**Phase 2 — Proposal + fast-forward.** On `create proposal` the AI scaffolded the change
(`openspec new change`) and authored proposal → design → specs → tasks in sequence, keeping
scope **deliberately narrow** (explicitly out: release-please/changesets, in-app "What's
New", per-version v0.2.x backfill). It drove to `validate --strict` clean (5 groups, 19–21
tasks, 7 requirements with scenarios). *Decision point:* the human chose "both" scope and
Keep-a-Changelog format, which the design then encoded.

**Phase 3 — Apply (implement).** Six hours later the human ran the apply prompt. The AI swept
the 33 commits, grouped them into `Added/Changed/Fixed/Docs`, wrote `CHANGELOG.md`, the
release-process doc (with an ASCII overview), and the `publish.yml` awk extraction step —
then **smoke-tested the awk locally** (real version → content, bogus → 0 bytes → fallback).

**Phase 4 — Verify + archive.** The AI produced a requirement→evidence map (21/21 tasks,
12/12 scenarios), archived the change (delta spec synced to a new `release-notes` capability),
and hand-fixed the `TBD` purpose line `openspec archive` auto-inserts.

**Phase 5 — Surgical commit.** The working tree was full of unrelated WIP (site/, other
OpenSpec changes). The AI copied the mixed files (`README.md`, `AGENTS.md`) aside, reverted
them to HEAD, staged only its own files, restored the WIP, unstaged pre-staged foreign files,
and committed 11 files scoped to release-notes only (`f2ec691`), preserving 78 other files.

## 4. Prompts that worked

- **The goal prompt (explore mode preamble).** Effective because it set a *stance* — "think,
  don't implement, but you MAY create OpenSpec artifacts" — which produced landscape-mapping
  and a fork menu instead of premature code. Reuse it whenever the problem shape is unclear.
- **`create proposal`** — a 2-word high-leverage unlock: once the fork was chosen, this
  converted exploration into a scaffolded, validatable artifact set with no further prompting.
- **The `/opsx:ff` fast-forward prompt** — "generate everything needed to start
  implementation" drove all four artifacts to strict-clean in one shot.
- **The `/opsx:apply` → `/opsx:verify` → `/opsx:archive` → `commit changes` chain** — each a
  single directive that advanced a full workflow stage. The verify step before archive is what
  caught completeness/coherence.

*Weak → stronger:* the final `commit changes` was under-specified given a dirty tree. Stronger:
*"commit ONLY the release-notes files; the working tree has unrelated WIP — stage my hunks
only and leave everything else untouched."* (The AI figured this out, but stating it avoids risk.)

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to jump to implementing | Explore-mode preamble ("NEVER write code; you MAY create OpenSpec artifacts") | Open thinking/spec work in explore mode by default |
| Need a scope/format decision | Choosing "both + Keep-a-Changelog" from the fork menu | State scope + format in the goal prompt when known |
| Risk committing unrelated WIP in a dirty tree | (implicitly) requiring a scoped, surgical commit | Say "commit only my files; preserve other WIP" explicitly |
| Leave `openspec archive`'s auto `TBD` purpose line | — (AI self-corrected) | Grep the synced spec for `TBD` after every archive |
| Trust CI extraction blindly | — (AI smoke-tested locally) | Always dry-run the awk with a bogus version to prove fallback |

## 6. Skills, tools & memory created — and why they're effective

**No new skill or memory was created** in this session — it ran on the existing OpenSpec
workflow skills (`openspec-new-change`/`-ff`/`-apply`/`-verify`/`-archive`).

**The reusable asset it *should* leave behind is `docs/release-process.md` itself** — it
captures commit conventions, the `[Unreleased]` → promote → bump → tag flow, what CI does,
and the manual fallback. Invoke/point to it whenever cutting a release. If this dance recurs
(establishing a docs+CI convention as an OpenSpec change), consider a small project skill:
*"draft a docs-convention change: explore → fork menu → ff artifacts → apply → surgical
commit."* The single most reusable move worth memorializing is the **CHANGELOG→Release-body
awk extraction with a 0-byte fallback**, now living in `publish.yml`.

## 7. Pitfalls & dead ends

- **Dirty working tree at commit time.** 78 unrelated WIP files; 3 of the AI's target files
  (`README.md`, `AGENTS.md`, `publish.yml`) had entangled prior edits, and foreign files were
  already staged. *If you hit this:* copy mixed files aside → `git checkout HEAD --` them →
  reapply only your hunks → stage your clean files → restore the WIP copies → `git reset HEAD`
  the pre-staged foreign files → commit `--no-verify`.
- **`openspec archive` inserts a `TBD` purpose line** into the synced main spec. *Fix:* after
  archiving, edit `openspec/specs/<cap>/spec.md` to match the proposal's real purpose.
- **CI extraction can silently emit an empty body.** *Guard:* smoke-test the awk with both a
  real and a bogus version locally — bogus must return 0 bytes so the graceful fallback fires.
- **3 failed bash commands** during discovery (harmless probes: a `grep` combo and a couple of
  `openspec status --json` calls). *Lesson:* don't chain `grep` with `&&` on probes where an
  empty match aborts the rest — separate them or use `; true`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** repo with git tags, an OpenSpec setup (`openspec` CLI), and knowledge
of the last released tag (`git describe --tags --abbrev=0`).

- [ ] Explore mode: map tags + unreleased commits; confirm no existing changelog.
- [ ] Pick **scope** (backfill / forward / both) and **format** (Keep-a-Changelog) up front.
- [ ] `openspec new change add-release-notes` → ff proposal → design → specs → tasks; `validate --strict` clean.
- [ ] Apply: write `CHANGELOG.md` (Unreleased + rich `[x.y.z]` grouped from `git log <lasttag>..HEAD` + collapsed backfill), `docs/release-process.md`, `publish.yml` awk extraction, README/AGENTS links.
- [ ] Smoke-test the awk: real version → content, bogus version → 0 bytes → fallback.
- [ ] `verify` (requirement→evidence), then `archive`; grep the synced spec for `TBD` and fix.
- [ ] Surgical commit scoped to release-notes only; preserve unrelated WIP.

**Artifacts produced:** `CHANGELOG.md`, `docs/release-process.md`, `.github/workflows/publish.yml`
(+extraction step), README.md/AGENTS.md links, `openspec/specs/release-notes/spec.md`,
archived change `openspec/changes/archive/2026-04-19-add-release-notes/`. Commit `f2ec691` on `develop` (11 files, +744 / −2).

---

_Generated from session `019da6db` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-19. Source extract: session facts sheet (mktemp)._
