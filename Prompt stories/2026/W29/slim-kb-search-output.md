---
session: 019f756e
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [slim-kb-search-output]
proposal_excerpt: "`kb_search` disappoints on the result side, not the call side. The tool returns `JSON.stringify(hits, null, 2)` — a shape the reading LLM never parses, yet pays for in full:"
---

# How we did it: Slim the `kb_search` output — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a confused, three-word prompt: **"why kb_index not works here?"**
The user was reaching for a `kb_index` MCP tool that does not exist. The AI's first job
was diagnostic, not constructive: explain that indexing is never a manual agent tool
call, and hand back the correct CLI incantation.

Once that misconception was cleared, the *real* objective surfaced through the steering
turns: **ship the OpenSpec change `slim-kb-search-output`** — a refactor that stops
`kb_search` from returning `JSON.stringify(hits, null, 2)` (a fat, token-expensive shape
the reading LLM never parses) and instead emits a condensed, rank-led positional text by
default, with `format:"json"` as an opt-in. The change also narrows the `KbHit.parent`
public type from a recursive shape to display-only `{ headingPath } | null`. The full
job: implement it, author its 14 test-plan scenarios, verify, and land the PR.

## 2. TL;DR playbook

1. **Diagnose the tool confusion first.** There is no `kb_index` tool — only `kb_search`,
   `kb_neighbors`, `kb_get`. Indexing is automatic (a debounced `tool_result` reindex
   hook + read-path self-populate). Manual indexing is the *CLI*, not an agent tool.
2. **Build the CLI, then run it from repo root:**
   `cd packages/kb && npm run build` then
   `NODE_OPTIONS=--experimental-sqlite node packages/kb/dist/cli.js index`
   (the SQLite flag is mandatory; add `--force` to rebuild all chunks).
3. **Enter the worktree and orient before coding** — read the change artifacts,
   run a *filesystem reality check* (does `renderHits` exist? is `KbHit.parent`
   still recursive? how many commits behind `develop`?). Trust the tree, not the checkboxes.
4. **Implement in dependency order:** narrow the type → collapse the parent in
   `sqlite-store` → add the shared `renderHits` renderer → export it from the barrel →
   call it from `cli.ts` → wire the `format` param + condensed default into `extension.ts`.
5. **Bootstrap the worktree's `node_modules` before running extension tests.** The
   package-name import (`@blackbelt-technology/pi-dashboard-kb`) resolves *up to the main
   repo* until you run the `worktreeInit` hook (`npm install`) locally.
6. **Author all 14 scenarios (E1–E14)** across two files; run them targeted with the
   SQLite flag; then run the full suite + root `tsc --noEmit` for regressions.
7. **Prove your `@ts-expect-error` is not vacuous** — the *kb tsconfig excludes tests*,
   so the directive is only live under the **root** tsconfig that the quality gate runs.
8. **Ship inline via `ship-change`:** re-verify → archive+sync specs → commit (message
   from a file for backtick safety) → push → PR → watch CI + CodeRabbit → squash-merge →
   remove the worktree **last** (it strands your session CWD).

## 3. How the collaboration unfolded

**Phase 1 — Diagnosis (the misconception).** The AI ran `which kb`, inspected
`extension.ts`, and confirmed only three MCP tools exist. It explained the two automatic
indexing paths and distinguished them from the `kb index` *CLI* subcommand. When the user
said "index in shell", the AI built the CLI (`npm run build`) and ran it — `indexed 1582
files … 0 changed` confirmed the DB was already fresh. *Why it worked:* the AI resisted
the urge to invent a tool and instead corrected the mental model, then produced a
copy-pasteable one-liner.

**Phase 2 — Orient inside the worktree.** The `ship-it` skill (pasted as steering) set the
scope. The AI read the change artifacts, confirmed all 14 scenarios were L1 vitest
(no docker/manual), and ran a **filesystem reality check**: none of the work existed yet
(`renderHits` absent, `KbHit.parent` still recursive, 0 commits behind develop).
*Decision point:* trust the filesystem over the tasks.md checkboxes.

**Phase 3 — Implement in dependency order.** Type → store → renderer → barrel export →
CLI → extension. The AI batched context reads before editing and verified each edit landed.

**Phase 4 — The worktree resolution pitfall.** The extension test failed with
`renderHits is undefined` at import. The AI traced it: the worktree had *no
`node_modules`*, so the package-name import resolved up to the main repo (wrong branch).
Running the `worktreeInit` bootstrap (`npm install`) fixed resolution. *Why it worked:* the
AI recognized this as an environment artifact — the shipped code was correct.

**Phase 5 — Verify honestly.** Full suite: 10820 passed. Then the AI questioned its own
`@ts-expect-error`: discovered the **kb tsconfig excludes `__tests__`**, so the directive
was vacuous there — but the **root** tsconfig includes it. It proved the assertion live by
removing the directive and watching `TS2339` appear, then restoring it.

**Phase 6 — Ship inline.** `ship-change` drove re-verify → archive+sync → commit → PR #365
→ CI green (8m48s) + CodeRabbit clean → squash-merge. A lone `faux-session` integration
failure was proven *pre-existing* by stashing all changes and reproducing it on pristine
develop. The worktree was removed last — which stranded the session CWD.

## 4. Prompts that worked

- **The goal prompt** ("why kb_index not works here?") was *weak* — three words, wrong
  premise. A stronger kickoff: *"There's no `kb_index` tool — what's the correct way to
  index the kb from the shell, and is the DB already fresh here?"* It states the real need
  (shell indexing + freshness check) instead of a phantom tool.
- **"index in shell"** — a high-leverage two-word follow-up. It redirected from *explain*
  to *do*, and the AI produced the build+run sequence.
- **Pasting the `ship-it` skill** as a steering turn was the pivotal move: it handed the
  AI the entire implementation-phase contract (orient → apply → merge → test → ship) so it
  could run the change end-to-end without further hand-holding.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| stay in *explain* mode after diagnosing | "index in shell" | state the verb up front — "diagnose **then run** the fix" |
| treat the task as advisory | pasting the `ship-it` skill | invoke `ship-it` explicitly at the start of an implementation session |
| trust tasks.md checkboxes | (self-corrected) filesystem reality check | always grep for the new symbols before assuming state |
| accept a passing `@ts-expect-error` at face value | (self-corrected) prove it under root tsconfig | know that per-package tsconfigs may exclude `__tests__` |
| blame its own change for a test failure | (self-corrected) stash + repro on develop | isolate suspected flakes against a pristine baseline |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session was a *consumer* of existing ones
(`ship-it`, `openspec-apply-change`, `ship-change`, `openspec-archive-change`,
`review-code`). Their composition is the reusable asset.

**Recommended skill to capture:** *"worktree package-name resolution pitfall."* When a
worktree has no `node_modules`, any `@scope/pkg` import resolves *up to the main repo* on a
different branch — silently masking your local edits. The fix is running the `worktreeInit`
bootstrap (`npm install`) inside the worktree. This bit others every time a workspace
package is imported by name (not relative path) from extension tests.

## 7. Pitfalls & dead ends

- **`kb index` fails without the SQLite flag.** Always prefix
  `NODE_OPTIONS=--experimental-sqlite`, and build `packages/kb` first (`dist/cli.js`).
- **Worktree has no `node_modules`** → package-name imports resolve to the main repo /
  wrong branch → `renderHits is undefined`. Run the `worktreeInit` hook (`npm install`).
- **`@ts-expect-error` in a test can be vacuous** — the kb tsconfig *excludes*
  `__tests__`; only the root `tsc --noEmit` (the quality gate) type-checks it. Verify by
  removing the directive and confirming the expected error appears.
- **`renderHits([])` printed a blank line** where the legacy CLI printed nothing — a
  byte-identity regression caught in review; guarded with an empty-case check in `cli.ts`.
- **Removing the worktree strands the session CWD.** After `git worktree remove`, the
  session's shell can't `chdir` into the dead path — `Bash` fails on every command. Do
  cleanup last, and know you must relaunch pi from the parent repo afterward. Verify final
  state via the sandbox executor (`ctx_execute`), which runs in its own temp dir.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name (`slim-kb-search-output`), its worktree
(`.worktrees/os-<change>`), `gh` auth, the SQLite Node flag.

- [ ] Correct any `kb_index` confusion → indexing is automatic; manual = CLI only.
- [ ] `cd packages/kb && npm run build`, then
      `NODE_OPTIONS=--experimental-sqlite node packages/kb/dist/cli.js index`.
- [ ] Enter the worktree; read change artifacts; run the filesystem reality check.
- [ ] Implement in dependency order (type → store → renderer → barrel → CLI → extension).
- [ ] Run the `worktreeInit` bootstrap (`npm install`) *before* extension tests.
- [ ] Author E1–E14; run targeted with the SQLite flag; then full suite + root `tsc --noEmit`.
- [ ] Prove `@ts-expect-error` is live under the **root** tsconfig, not vacuous.
- [ ] `ship-change`: re-verify → archive+sync → commit (msg from file) → PR → CI+CodeRabbit
      → squash-merge → remove worktree **last**.

**Final artifacts (18 files, +373/−43):** `packages/kb/src/{types,sqlite-store,index,cli}.ts`,
`packages/kb/src/render.ts` (new), `packages/kb-extension/src/extension.ts`, two test files
(`render.test.ts`, `kb-search-tool.test.ts`), AGENTS.md rows, CHANGELOG breaking note —
merged as PR #365 (sha `0bfdb9e5`), archived to
`openspec/changes/archive/2026-07-19-slim-kb-search-output/`.

---

_Generated from session `019f756e-8031-774c-8fff-30048eefd4c2` · `pi-agent-dashboard` · 2026-07-20. Source extract: session facts sheet (slim-kb-search-output)._
