---
session: 019f144d
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [configurable-pi-sessions-dir]
proposal_excerpt: "The dashboard scans pi's session JSONL from a **hardcoded** `~/.pi/agent/sessions` (`session-scanner.ts:15`, `session-discovery.ts:28`, `migrate-persistence.ts:78`), derived directly from `os.homedir()` with literal p…"
---

# How we did it: Make the pi sessions directory configurable — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single slash-command: `/skill:openspec-apply-change
configurable-pi-sessions-dir`. There was no prose — the whole intent lived in the
already-written OpenSpec change. The *real* objective, once implementation and one
steering turn clarified it: replace three hardcoded `~/.pi/agent/sessions` literals
in the server with a single resolver that respects a config key and pi's own env
vars, add tests, update docs, then **ship it** end-to-end (archive → PR → CI →
CodeRabbit → squash-merge → worktree cleanup). One prompt to build, one prompt to land.

## 2. TL;DR playbook

1. Run `/skill:openspec-apply-change <change>` to drive the tasks.md task-by-task.
2. **Read the exports before coding**: confirm which symbol the upstream package
   actually re-exports (`getAgentDir` was exported; `getSessionsDir` was **not**).
3. Build the resolver in `shared` first (`resolvePiSessionsDir(env?)`) with an
   explicit precedence chain + unit tests, verify tests fail then pass.
4. Wire the three server call sites to delegate to the resolver; grep to prove no
   literal remains in *production* source.
5. When a hard gate (tsc) blocks the *approved design mechanism*, **stop and ask**
   before deviating — then fold the simpler equivalent.
6. Run the full suite (`npm test`), quality gate (`biome check` on changed files),
   and separate pre-existing warnings from your own.
7. Delegate `docs/` edits to a subagent (per AGENTS.md); edit root `README.md` inline.
8. Say **`use ship-change`** to run archive → commit → PR → CI-watch →
   CodeRabbit-apply → squash-merge → worktree-remove as one flow.

## 3. How the collaboration unfolded

**Phase A — Discovery (grep the upstream package).** Before touching code the AI
inspected `@earendil-works/pi-coding-agent`'s `index.d.ts`/`index.js` and found
`getSessionsDir` is *not* re-exported — only `getAgentDir`. Since
`getSessionsDir() = join(getAgentDir(), "sessions")`, it planned to use `getAgentDir()`.
*Why it worked:* verifying the real export surface up front turned a later runtime
surprise into a design decision.

**Phase B — Build shared-first, test-first.** Added `resolvePiSessionsDir(env?)` to
`packages/shared/src/dashboard-paths.ts` with precedence
`config.piSessionsDir → PI_CODING_AGENT_SESSION_DIR → PI_CODING_AGENT_DIR/sessions →
~/.pi/agent/sessions` (trim-aware, blank-falls-through, `~/` expansion) plus 8 unit
cases, and an optional `piSessionsDir?` config field read trim-aware in `loadConfig`
(deliberately *not* seeded by `ensureConfig`, so absent means fall-through).

**Phase C — The design blocker (decision point).** Wiring the three server sites to
`import { getAgentDir } from "@earendil-works/pi-coding-agent"` failed `tsc`: the
pi-core barrel re-exports declarations via `./config.ts` specifiers that this repo's
`moduleResolution: bundler` (no `allowImportingTsExtensions`) refuses to follow.
Runtime via jiti would work, but tsc gates CI. The AI recognised this as a *design*
blocker (the approved Option A was unimplementable), not a code bug, and **paused to
ask the human** before choosing the strictly-simpler equivalent — read
`PI_CODING_AGENT_DIR` directly (behaviourally identical, honours the same env var).

**Phase D — Fold + verify.** Simplified all three call sites to delegate to the
resolver, updated the unit test that referenced the removed injection, ran tsc clean,
added 2 integration tests, and got the full suite green (8401 passed). Recorded the
approved deviation in `design.md` and re-worded the affected tasks.

**Phase E — Docs + quality gate.** Edited root `README.md` inline (added a
`piSessionsDir` config row + resolution-order note); delegated `docs/file-index-shared.md`
to a `general-purpose` subagent per AGENTS.md. Ran biome on the changed files,
carefully separating its own new-code warnings (1 fixable `useTemplate`) from the ~27
pre-existing `config.ts` complexity warnings, and reverted the incidental
`package-lock.json` churn from the worktree `npm install`.

**Phase F — Ship (second prompt).** `use ship-change` ran the verify gate again,
archived + synced specs (repairing a pre-existing malformed main spec so sync could
apply), opened PR #197 → `develop`, watched CI green, auto-applied both CodeRabbit
findings (mock `os.homedir()` in the integration test; add env-branch edge cases),
re-ran the gate, re-watched CI, then squash-merged (`91fbd69`) and removed the worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change configurable-pi-sessions-dir`.
  Effective *because the change was already fully specified*: the slash-command needs
  no prose when tasks.md, design.md and the delta spec carry the intent. The lesson is
  upstream — invest in the OpenSpec artifacts so the build prompt can be one line.
- **High-leverage follow-up** — `use ship-change`. Two words that unlocked the entire
  land-it pipeline (archive → PR → CI → review → merge → cleanup) as a single
  disciplined flow instead of a dozen manual git/gh steps.

Weak-prompt rewrite: neither prompt was weak. If anything, a stronger *first* prompt
would pre-empt the Phase-C stall: "apply the change; if the approved import mechanism
fails tsc, fall back to reading `PI_CODING_AGENT_DIR` directly and note the deviation."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Finish the build and stop, awaiting the next instruction | `use ship-change` | State "apply **and ship**" in the goal prompt, or chain the skills |
| Follow the approved design's exact import mechanism even when it hit a hard gate | (AI self-paused and asked) — human approved the simpler fallback | Pre-authorise "prefer the simpler behaviourally-equivalent path when a gate blocks the specced mechanism" |

The AI handled most self-correction well: it paused at the tsc blocker rather than
forcing an unimplementable design, and it distinguished its own warnings from
pre-existing ones instead of "fixing" unrelated code.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — this session *consumed* existing skills
rather than producing them:

- **`openspec-apply-change`** — drove the tasks.md task-by-task with verify-as-you-go.
  Invoke it whenever a change has a written tasks.md ready to implement.
- **`ship-change`** — the land-it pipeline (archive → commit → PR → CI-watch →
  CodeRabbit-apply-loop → squash-merge → worktree-remove). Invoke it the moment
  implementation is verified and you want the change on `develop`.
- **`general-purpose` subagent** — used to edit `docs/file-index-shared.md` in
  isolation, honouring the AGENTS.md rule that `docs/` writes are delegated.

Recommended memory to save for next time: *"pi-core (`@earendil-works/pi-coding-agent`)
re-exports `getAgentDir` but NOT `getSessionsDir`; value-importing it fails tsc under
this repo's `moduleResolution: bundler`. Read `PI_CODING_AGENT_DIR` directly instead."*

## 7. Pitfalls & dead ends

- **Empty worktree `node_modules`.** Cross-package imports resolved up to the parent
  repo's unmodified `packages/shared`, so tsc couldn't see the new resolver. Fix: run
  `npm install` inside the worktree for isolated workspace resolution — then revert the
  incidental `package-lock.json` churn before committing.
- **Value-importing a pi-core symbol fails tsc.** The barrel's `./config.ts` specifiers
  are unfollowable under `moduleResolution: bundler` without `allowImportingTsExtensions`.
  Only `import type` works. If you need the *value*, read the underlying env var directly.
- **`biome check --changed` reported 0 in the worktree** (VCS-base quirk). Run biome
  directly on the explicit changed file paths instead of relying on `--changed`.
- **Pre-existing warnings masquerade as regressions.** `config.ts` carries ~27 Tier B/C
  complexity warnings. Grep your own touched files specifically to confirm none are new.
- **Malformed main spec aborted the archive.** `openspec/specs/session-persistence/spec.md`
  had a delta-only `## ADDED Requirements` header (no `## Requirements`, no `## Purpose`),
  invisible to the parser. Minimal repair (fix the header + add Purpose) let sync apply.
- **`gh` squash-merge failed to switch to `develop`** (the parent worktree holds it) and
  removing the worktree killed the shell's CWD. The merge itself *did* land (`91fbd69`);
  delete the remote branch explicitly and run remaining cleanup from the parent repo.

## 8. Reproduce it faster — checklist

- [ ] Change fully specified in `openspec/changes/<name>/` (tasks.md, design.md, delta spec).
- [ ] `/skill:openspec-apply-change <name>` — implement task-by-task.
- [ ] Verify the upstream export surface before importing (`getAgentDir` yes, `getSessionsDir` no).
- [ ] Build the resolver + unit tests in `shared` first; wire call sites; grep for leftover literals.
- [ ] If the approved mechanism fails a hard gate, fall back to the simpler equivalent and record it in `design.md`.
- [ ] `npm test` green + `biome check` on the explicit changed files (separate pre-existing warnings).
- [ ] Delegate `docs/` edits to a subagent; edit `README.md` inline.
- [ ] `use ship-change` → archive → PR → CI → CodeRabbit → squash-merge → worktree cleanup.

Key inputs: a written OpenSpec change; `gh` authenticated; the worktree needs its own
`npm install`. Final artifacts: PR #197 merged as `91fbd69`; resolver in
`packages/shared/src/dashboard-paths.ts`; config field in `packages/shared/src/config.ts`;
three server call sites delegating to it; 8 unit + 2 integration tests.

---

_Generated from session `019f144d-6328-7328-8b17-c5fb619dcfc0` · `pi-agent-dashboard` · 2026-06-29. Source extract: session facts sheet (mktemp)._
