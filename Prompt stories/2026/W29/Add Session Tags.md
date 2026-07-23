---
session: 019f5db1
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-session-tags]
proposal_excerpt: "The session list has no way to group sessions by *kind of work*. A user juggling many sessions across folders cannot answer 'show me my bugfix sessions' or 'which sessions are feature work vs docs.' Folder + free-text…"
---

# How we did it: Add Session Tags — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user wanted to add **user-assignable tags** to pi dashboard sessions so sessions
can be grouped by *kind of work* — bugfix, feature, docs, research. The OpenSpec
proposal (pre-built before this session) defined a full spec: shared types → server
persistence → protocol message → client UI (chip primitives, editable editor, card
strip, sidebar filter) → E2E test.

First prompt: `/skill:openspec-apply-change add-session-tags` — kick off the
spec-driven implementation within an OpenSpec worktree.

The real objective: ship a full-stack tagging system (29 tasks) through a worktree,
verified by unit tests (shared, server, client), Biome quality gate, and a Playwright
E2E spec against the local Docker harness, then land via PR #314.

## 2. TL;DR playbook

1. **Open the change** — run `/skill:openspec-apply-change <change-name>` to load
   tasks.md and orient in the worktree.
2. **Read the spec + mockups first** — let the AI explore the full contract (types,
   mockups, existing server/client patterns) before writing any code.
3. **Implement spec sections sequentially** — the AI naturally phases work: shared
   types → unit tests → server handler → client primitives → client surfaces →
   sidebar filter → AGENTS.md docs.
4. **Run tests per section** — use `npx vitest run <path>` after each logical chunk;
   the AI drives red-green iteration automatically.
5. **Fix worktree symlinks early** — a worktree has no `node_modules`; `npm install`
   is needed so local `packages/*` resolve instead of the parent repo's published
   copies.
6. **Code quality gate** — `npx biome check --changed --error-on-warnings` catches
   import-ordering, `React` unused-import, and format issues; auto-fix via `--write`.
7. **Build E2E against the Docker harness** — build the image from local source
   (`docker compose build`), boot with a unique port, run the spec in attach mode
   (`PW_CHANNEL=chrome`), tear down.
8. **Ship the change** — `/skill:ship-it` or manual `archive → commit → push → PR
   → CI watch → CodeRabbit review → squash-merge → delete worktree`.
9. **Handle worktree deletion** — the ship step removes the worktree directory;
   if that was the shell's cwd, subsequent commands fail. Run final git cleanup
   (prune branches) from the parent repo before the deletion step, or accept the
   cosmetic failure.

## 3. How the collaboration unfolded

The session followed the OpenSpec apply-change pattern with three distinct phases:

### Phase 1 — Discovery + shared layer (§1–§2, ~15 min)

The AI opened the tasks.md, read all related sources (shared types, browser protocol,
server handlers, client components, mockups) in five parallel exploration batches,
then announced the plan. Implementation started at §1 (shared types): a `tags.ts`
module with `normalizeTags`, `tagColor` (FNV-1a 32-bit hash → 9-color palette),
`TAG_PALETTE`, caps (`MAX_TAGS=12`, `MAX_TAG_LEN=32`), and unit tests that proved
UTF-8 byte-source hashing (not UTF-16) with a `café` test case.

**Why it worked:** The OpenSpec spec gave the AI a clear dependency order. Reading
all source files before writing avoided mid-implementation surprises. The AI tested
every shared helper immediately — no assumptions about hash output.

### Phase 2 — Server + client implementation (§3–§6, ~80 min)

The AI moved through the stack in strict spec order:

- **Server (§3):** handler (mirrors `handleHideSession` pattern), persistence via
  `onChange`, gateway dispatch, scanner restore. The AI extracted `sessionToMeta()`
  as a tested pure function — turning the fragile full-overwrite enumeration into a
  regression guard that shares production code.
- **Client primitives (§4):** `TagChip`, `TagEditor`, `TagFilterGroup`, `TagStrip`,
  `all-tags.ts` — built from the mockups' visual contract, tested with Vitest
  (aria-label selectors).
- **Client surfaces (§5):** wired `onSetTags`/`allTags` through `useSessionActions`
  → `SessionList` → `SessionHeader` (editable strip) + `SessionCard` (compact
  read-only strip).
- **Sidebar filter (§6):** audited every filter gate in `SessionList.tsx` (7 min),
  then added tag predicates + folder-filter wiring + sidebar filter UI + 9 tests
  covering tier-coverage and edge cases.

**Decision point:** When `tsc` reported errors about `@blackbelt-technology/pi-dashboard-shared` resolving to a published copy, the AI diagnosed the worktree's missing `node_modules` and ran `npm install` to fix symlinks — a 90-second detour that prevented cascading type errors.

### Phase 3 — Quality + E2E + ship (§7–ship, ~50 min)

- Full test suite: **10,082 passed, 0 failed**.
- Biome on changed files: 3 rounds of auto-fix (import ordering, unused React imports).
- AGENTS.md rows added for every new file.
- **E2E spec** (`tests/e2e/session-tags.spec.ts`): built Docker image from local
  source (first build ~4 min), booted harness, ran spec in attach mode → **passed
  8.9s** covering add/colorize/persist-across-reload/sidebar-filter/remove with
  semantic `aria-label` selectors.
- **Steering #2** (`ship-it`): drove the full ship pipeline — archive specs, commit,
  push PR #314, watch CI (pass, 10m8s), CodeRabbit (0 actionable threads),
  squash-merge, delete remote branch, remove worktree.

## 4. Prompts that worked

| Prompt | Why it worked |
|--------|---------------|
| `/skill:openspec-apply-change add-session-tags` | Loaded the full spec + task context into the AI. The OpenSpec skill provides the structured plan, phase mapping, and quality gates automatically — the single best way to start. |
| `Make e2e tests with playwright with local docker for uncheked task` | Directed the AI to automate the one remaining manual task (7.2 — live browser check). Specific about tool (Playwright), environment (local Docker harness), and scope (the unchecked task). Good steering: precise about what to do and how to do it. |
| `ship-it` | Single-word command that triggered the entire ship pipeline: archive, commit, PR, CI watch, CodeRabbit, merge, cleanup. The OpenSpec ship skill knows all the steps — the operator only needs to confirm each gate passes. |

**If doing it again:** Use the same prompts. For the E2E steering, consider adding
`— use the run-dashboard-e2e-local-changes skill` to skip the user explaining which
skill to load.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Leave the last manual task (7.2 — browser verification) uncleared | "Make e2e tests with playwright with local docker for uncheked task" — automating the manual step | Including a "how to verify" note in the tasks.md for every TBD check, so auto-E2E is the default |
| Worktree resolution of `@blackbelt-technology/*` packages | The AI self-diagnosed: worktree has no `node_modules`, so `tsc` resolved to the parent repo's published copies. Ran `npm install` independently. | Add a checklist item to every worktree-based implement task: "`npm install` in worktree" before type checking |
| BIOME warnings on new files (import ordering, unused React imports with automatic JSX runtime) | Ran `npx biome check --write` after implementation, then narrowed to changed files | Configure biome to run as a pre-commit hook so these are caught before the PR |
| Worktree directory removal as cwd | The `ship-change` skill's final step removes the `.worktrees/` directory. If the shell's cwd was inside that directory, the next command fails because the directory is gone | Run git branch/remote cleanup from the parent repo **before** the removal step, or set cwd to `$HOME` before the final delete |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created in this session — the AI operated within the
existing OpenSpec apply-change + ship-it skill framework.

**Skills that were essential (pre-existing):**

| Skill | Role | Why effective |
|-------|------|---------------|
| `openspec-apply-change` | Drove the entire implementation: tasks.md parsing, phase mapping, per-section test-verify loop | Turns a spec into a replayable checklist the AI follows autonomously. Without it, each prompt would need to re-explain the plan. |
| `ship-it` | Automated the landing pipeline: archive → commit → PR → CI → CodeRabbit → merge → cleanup | Eliminates 6+ manual steps and the risk of forgetting any (AGENTS.md, lockfile revert, branch cleanup). |
| `run-dashboard-e2e-local-changes` | Guided the E2E against a local-source Docker image | Essential for worktree E2E — the off-the-shelf harness uses a stale image; this skill teaches building fresh from your checkout. |

**Recommendation:** Create a skill capturing the worktree-npm-install fix so future
sessions don't waste time diagnosing `tsc` resolution errors. Something like
_"resolve worktree node_modules"_ that runs `npm install` + verifies symlinks point
at the worktree's own `packages/`.

## 7. Pitfalls & dead ends

| Pitfall | How to avoid |
|---------|--------------|
| `tsc` type errors in worktree because `@blackbelt-technology/*` resolves to parent repo published copies | Run `npm install` inside the worktree. This creates local `node_modules` whose symlinks point at the worktree's own `packages/*`. Happens exactly once per fresh checkout. |
| First Docker build from local source exceeds health check timeout (~180s) | Use the manual "build + attach" flow (no health cap). The `run-dashboard-e2e-local-changes` skill documents this. First build is ~4–6 min. |
| Biome finding "unused React import" on files using automatic JSX runtime | Add `"jsx": "react-jsx"` to the project's `tsconfig.json`, or switch the file to not import `React` directly. Auto-fix with `biome check --write` removes the import. |
| Worktree removal makes cwd invalid → subsequent bash commands fail | Set `cwd` to a surviving directory before the removal, or defer worktree deletion to the last step of the session. Accept the cosmetic exit-0 error and move on. |
| E2E spec runs full suite instead of one file | Pass the exact test file path to playwright: `npx playwright test tests/e2e/session-tags.spec.ts`. The initial `npm test` runs everything. |

## 8. Reproduce it faster — checklist

**Prerequisites:**
- OpenSpec change with proposal + design + tasks.md (the spec-driven foundation)
- Git worktree checked out (`git worktree add .worktrees/<name> <branch>`)
- `npm install` run inside the worktree (resolves local dependencies)
- Docker installed and running (for E2E)
- System Chrome installed (bundled Chromium is absent in this harness)

**The tight sequence:**
1. `cd .worktrees/<name>` and run `/skill:openspec-apply-change <change-name>`
2. Let the AI read all sources first, then implement spec sections sequentially
3. `npx vitest run <path>` after each section — fix failures immediately
4. `npx tsc --noEmit 2>&1 | grep -E 'error TS'` to catch type drift
5. `npx biome check --changed --error-on-warnings` and auto-fix
6. Build Docker image: `docker compose build` in the worktree (manual flow, no health cap)
7. Boot harness, run E2E spec: `PW_CHANNEL=chrome npx playwright test tests/e2e/<spec>.spec.ts`
8. Tear down harness: `docker compose down -v --rmi all`
9. Run `/skill:ship-it` — this archives, commits, PRs, merges, and cleans up
10. Set cwd to parent repo before worktree removal, then: `git worktree remove .worktrees/<name>` and `git branch -d <branch>` if local still exists

**Artifacts produced:**
- `packages/shared/src/tags.ts` — normalized tag helpers + palette + test
- `packages/shared/src/session-meta.ts` — `SessionMeta.tags` field
- `packages/shared/src/types.ts` — `DashboardSession.tags` + `SetSessionTagsBrowserMessage`
- `packages/server/src/session-to-meta.ts` — tested enumeration function
- `packages/client/src/components/tags/` — `TagChip`, `TagEditor`, `TagFilterGroup`, `TagStrip`, `all-tags.ts`
- `tests/e2e/session-tags.spec.ts` — full round-trip E2E spec
- PR #314 squash-merged into `develop` at `797201ba`

---

_Generated from session `019f5db1` · `pi-agent-dashboard` worktree `os-add-session-tags` · 2026-07-14. Source extract: `session_facts.bbSn0yE6mb.md`._
