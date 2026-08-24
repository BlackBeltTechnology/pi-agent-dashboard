---
session: 019f065a
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "large facts sheet (~11544 tok)"
upgrade_status: pending
openspec_changes: [add-authoring-skills]
proposal_excerpt: "The user maintains a personal skill library under `~/Documents` (mirrored across `.claude`/`.gemini`/`.opencode`/`.agents`/`.pi`). A scan found three families:"
---

# How we did it: Port personal authoring skills into the monorepo — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single slash command:

```
/skill:openspec-apply-change add-authoring-skills
```

That is the *whole* stated ask — "implement the already-planned OpenSpec change." The
real objective, once the proposal context loaded, was: **port three general-purpose
authoring skills** (`skill-creator`, `session-to-guideline`, `doc-summarizer`) out of the
operator's personal cross-agent skill library under `~/Documents` (mirrored across
`.claude`/`.gemini`/`.opencode`/`.agents`/`.pi`) **into the dashboard monorepo** — as a new
publishable `packages/authoring-toolkit` package plus a `doc-summarizer` skill folded into
`document-converter` — with all personal strings scrubbed, `bun` invocations swapped to the
repo's `npx tsx` convention, licenses tidied, and the whole thing shipped: apply → verify →
archive → PR → green CI → merge → cleanup. The single steering turn (`use ship-change
skill`) turned "implement the tasks" into "implement **and land it**."

## 2. TL;DR playbook

1. **Kick off with the apply skill on the named change:** `/skill:openspec-apply-change add-authoring-skills`. Let it read the proposal + tasks.md and inspect the source skills.
2. **Ground on a sibling package first.** Before scaffolding, read `packages/eng-disciplines` (package.json, NOTICE, `pi.skills[]` shape) and `packages/document-converter` — copy the proven pattern instead of inventing one.
3. **Scan every mirror for personal strings** (`grep -rniE '/Users/robson|<name>|…'` across all source copies) and treat `nav`-substring hits (`navigation`, `DOCKER_UNAVAILABLE`) as false positives — verify with word boundaries, don't blindly scrub.
4. **Copy skills verbatim as derived works**, tidy only the `license:` frontmatter, and swap `bun` → `npx tsx` in SKILL text (scripts had no `Bun.*` APIs — verify with grep before assuming).
5. **Verify scripts actually run** under `tsx` against a *real* session before marking tasks done — don't trust "it should work."
6. **Delegate all `docs/` writes to a subagent** with the caveman-style rule passed verbatim (Documentation Update Protocol); the main agent never edits `docs/` prose directly.
7. **Say `use ship-change skill`** to run the land pipeline: local gate (tests + build) → `openspec archive` (syncs spec) → commit via message-file → push → PR → watch CI.
8. **When CI is red, first prove pre-existing vs. caused-by-you** (`gh run list --branch develop`) before touching anything — then fix at the root.
9. **Validate lockfile fixes in CI's exact environment** (`npm ci` in a clean `node:22` Linux container) before pushing, not just on the mac host.
10. **Drain CodeRabbit threads** (apply safe fixes, re-push, resolve stale anchors), then squash-merge and remove the worktree manually (the auto `--delete-branch` fails when `develop` is checked out in the parent).

## 3. How the collaboration unfolded

### Phase 1 — Discovery & grounding (≈01:54–01:55)
- **What the AI did:** Loaded the change (16 tasks), located the three source skills across the `~/Documents/.claude|.gemini|.opencode|.agents|.pi` mirrors (`session-to-guideline` lived under `.pi/`, not `.claude/`), and read the `eng-disciplines` package as the reference pattern (package.json, NOTICE, `pi.skills[]`).
- **Why it worked:** Copying a *known-good sibling package* is the fastest way to a correct manifest. It also ran a personal-string scan up front instead of discovering coupling later.
- **Decision point:** Recognized the `nav` grep hits (`navigation`, `DOCKER_UNAVAILABLE`) as false positives and confirmed with precise checks — avoided scrubbing real content.

### Phase 2 — Scaffold & adapt (≈01:55–01:59)
- **What the AI did:** Created `packages/authoring-toolkit` (package.json, README, NOTICE), copied `skill-creator` verbatim with only the license tidied, copied the full `session-to-guideline` tree, and swapped every `bun` reference to `npx tsx`. Then wrote the `doc-summarizer` SKILL as **orchestrate-only** (extraction via the existing `dc.convertToMarkdown()` facade — no new host-side python, per the proposal's Impact line).
- **Why it worked:** It respected the proposal's constraints ("No new host-side python") rather than porting the original's scripts, keeping the surface minimal.
- **Decision point:** Verified `list_sessions.ts` and `extract_session.ts` actually run under `tsx` and produce a real facts sheet **before** checking off task 3.4.

### Phase 3 — Docs & validate (≈01:59–02:02)
- **What the AI did:** Mapped the `docs/file-index-*.md` splits, **delegated the doc-index rows to a `general-purpose` subagent** with the caveman-style rule verbatim, then ran `openspec validate --strict`, confirmed discoverability of all three skills, and marked all 16 tasks complete.
- **Why it worked:** Honored the repo's Documentation Update Protocol (main agent orchestrates docs, never writes prose directly).

### Phase 4 — Ship: local gate + archive + PR (≈02:04–02:13)
- **What the AI did:** On `use ship-change skill`, ran tests + build, caught **its own** failure (the new package missing from `publish.yml` PACKAGES allowlist — a guard test), fixed it, distinguished a flaky perf smoke from a real failure, archived the change (spec synced), committed via a message-file (to dodge backtick substitution), pushed, and opened PR #168.
- **Decision point:** Correctly separated "my bug" (allowlist) from "flaky under load" (perf smoke passes in isolation).

### Phase 5 — The CI rabbit hole: lockfile forensics (≈02:22–09:34)
- **What the AI did:** CI crashed at `npm ci` in ~1min with `Cannot find module @rollup/rollup-linux-x64-gnu`. It first **proved `develop` was already red on the last 4 pushes** with the identical error (pre-existing, not caused by this PR), surfaced the decision to the operator via `ask_user`, and — once told to fix it in-PR — spent hours root-causing two intertwined npm bugs:
  - **npm #4828:** the committed lockfile recorded **host-only** native binaries (no Linux rollup entry), so `npm ci` on Linux had nothing to install. A `prepare` script in `packages/client` runs the vite/rollup build during install, tripping it.
  - **npm hoisting bug:** a full destructive regen *fixed* the rollup matrix but **broke the jimp 1.6.x subtree** — `electron-icon-builder` pulls `jimp@0.16` into the root `@jimp/*` scope, causing npm (10.x AND 11) to drop `@jimp/js-bmp` install entries for `image-fit`'s `jimp@1.6.1`.
- **Why it worked:** It refused to guess. It reproduced each hypothesis (node 22 vs 24, npm 10 vs 11, `--package-lock-only`, `--os/--cpu` filters, Linux container) and discarded dead ends with evidence.
- **The winning fix:** Keep the full-regen lockfile (complete 25-platform rollup matrix) and **graft develop's correct jimp 1.6.x subtree** into it. A proper transitive-BFS closure found **74 missing keys** (including 7 non-`@jimp` packages like `bmp-ts`, `utif2` a regex would have missed), grafted with **0 conflicts**.

### Phase 6 — Validate-in-CI-env + merge (≈09:34–10:09)
- **What the AI did:** Validated the grafted lockfile by running **exactly what CI runs** — `npm ci` in a clean `node:22` Linux container, plus jimp import, rollup build, and the two previously-failing `image-fit` test files (42/42) — *and* the mac host `npm ci` + full suite (8066 tests). Pushed, CI passed (8m3s), then drained 6 CodeRabbit threads (1 Critical: `outputPath` vs the facade's real `{ output }` field), re-pushed, resolved a stale anchor, squash-merged PR #168, and removed the worktree manually.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-authoring-skills`. Effective because the *planning* was already done (a proposal + tasks.md existed); the apply skill just needed the change name. **Lesson:** front-load the plan into an OpenSpec change, then the kickoff is one line.
- **The high-leverage follow-up** — `use ship-change skill`. Two words that converted "implement" into a full land pipeline (gate → archive → PR → CI → merge → cleanup). This is the single most leveraged turn in the session.
- **The mid-flight unlock** — the operator's `ask_user` answer *"investigate & fix the develop CI rollup regression in this PR"* authorized the deep lockfile work. **Rewrite for next time:** state the scope boundary up front — e.g. "apply the change AND ship it; if CI is red for a pre-existing reason, fix it in this PR" — to avoid the mid-session stall.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after "implementation complete" (16/16 tasks) | `use ship-change skill` | Stating "apply **and** ship" in the kickoff prompt |
| Pause and ask when CI went red (pre-existing infra breakage) | Answering the `ask_user`: "fix it in this PR" | Pre-authorizing: "if CI is red for a pre-existing reason, fix it in-PR" |
| (self-corrected) treat a `nav` grep hit as a real personal string | — (AI caught it) | Using word-boundary greps for personal-string scrubbing |
| (self-corrected) trust a full lockfile regen | — (AI caught the jimp breakage in CI) | Always validating lockfile changes with `npm ci` in a CI-matching Linux container |

The dominant pattern: **only two operator turns**, both scope-expanders. The AI did the
heavy technical lifting autonomously but needed the human to (a) tell it to *ship*, and (b)
authorize *fixing pre-existing infra* inside the feature PR.

## 6. Skills, tools & memory created — and why they're effective

No new *pi skill/memory* was created in this session — the session **ports** three skills as
package artifacts:

- **`skill-creator`** (copied verbatim) — captures the meta-workflow of authoring new skills; effective because it removes the "how do I structure a SKILL.md" guesswork. Invoke when creating any new skill.
- **`session-to-guideline`** (copied + `bun`→`tsx`) — turns a session JSONL into a playbook (this very document is its output). Effective because it separates goal from steering deterministically. Invoke to document any finished session.
- **`doc-summarizer`** (rewritten orchestrate-only) — summarizes large docs via the `document-converter` engine facade with no new host-side extractors. Effective because it reuses an existing conversion surface instead of shipping parallel python.

The session *itself* demonstrates two workflows worth their own skills (and the repo already
has them): **`ship-change`** (the land pipeline) and a **lockfile-native-deps repair** recipe
— the npm #4828 + jimp-hoisting fix is subtle enough that the graft-from-develop procedure
should be captured as a project skill.

## 7. Pitfalls & dead ends

- **`npm install` on macOS rewrites the lockfile host-only** → Linux `npm ci` fails (`Cannot find module @rollup/rollup-linux-x64-gnu`). If you hit this, regenerate with the full platform matrix and validate in a Linux container.
- **A full lockfile regen fixes rollup but silently breaks jimp** — `electron-icon-builder`'s `jimp@0.16` collides with `image-fit`'s `jimp@1.6.1`, dropping `@jimp/js-bmp`. Dead end: node-version swaps (22 vs 24), npm-version swaps (10 vs 11), `--package-lock-only`, `--os/--cpu` filters — *none* fix it. **Winning move:** graft develop's correct jimp 1.6.x subtree (compute the full transitive closure — ~74 keys, not a regex guess).
- **CI won't fire on a `DIRTY` PR** — a merge conflict with `develop` silently blocks the run. If CI never queues after a push, check `gh pr view` mergeability; merge develop and **regenerate** (don't hand-merge) the lockfile.
- **Don't trust local `import('jimp')` success** — leftover `npm install` artifacts not in the lockfile can mask a broken `npm ci`. Validate against the lockfile, in a container.
- **`gh pr merge --delete-branch` fails** when `develop` is checked out in the parent worktree — verify the remote merge landed, then delete branches + remove the worktree manually.
- **Stale CodeRabbit thread anchors** flag already-fixed lines — confirm the fix is in place, then resolve the thread manually.
- **The perf/BFS/doctor smoke tests are load-sensitive flakes** — they pass in isolation; don't chase them as real regressions during a heavy suite run.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- An OpenSpec change already planned (proposal + tasks.md) at `openspec/changes/<name>/`.
- The source skills accessible (here: `~/Documents/.{claude,gemini,opencode,agents,pi}/skills/`).
- `gh` authed; Docker available (for CI-env lockfile validation); `nvm` with node 22.

**Steps:**
1. `/skill:openspec-apply-change <name>` — and state up front "apply **and** ship; fix pre-existing CI in-PR if red."
2. Read a sibling package (`eng-disciplines`) before scaffolding; copy its manifest shape.
3. Scan all skill mirrors for personal strings with **word-boundary** greps.
4. Copy skills verbatim (derived works), tidy `license:`, swap `bun` → `npx tsx`; verify scripts run against a real session.
5. Write orchestrate-only skills against existing engine facades (no new host-side extractors).
6. Delegate `docs/` rows to a subagent with the caveman-style rule verbatim.
7. `openspec validate --strict`; check all tasks; then `use ship-change skill`.
8. Add the new package to `publish.yml` PACKAGES allowlist (a guard test enforces it).
9. If CI red: prove pre-existing with `gh run list --branch develop`; if it's a native-deps lockfile issue, full-regen for the platform matrix, then **graft the jimp subtree** from develop, and validate with `npm ci` in a `node:22` Linux container.
10. Drain CodeRabbit threads, squash-merge, remove the worktree manually.

**Artifacts produced:**
- `packages/authoring-toolkit/` (package.json, README, NOTICE, `skill-creator/`, `session-to-guideline/`)
- `packages/document-converter/.pi/skills/doc-summarizer/SKILL.md`
- `.github/workflows/publish.yml` (allowlist entry), synced `openspec/specs/authoring-skills/spec.md`
- Repaired `package-lock.json` (full native matrix + grafted jimp subtree)
- PR #168, squash-merged to `develop` (SHA `bfb1985a`)

---

_Generated from session `019f065a-08f0-7693-9c91-d5e6b1ff68b4` · `pi-agent-dashboard` · 2026-06-27. Source extract: `/tmp/session_facts_gO1pUG.md`._
