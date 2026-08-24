---
session: 019e0d26
week: 2026/W19
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [unify-opsx-colon-hyphen-aliases]
proposal_excerpt: "The dashboard's bridge prompt-expander treats `/foo:bar` and `/foo-bar` asymmetrically. Today only one direction is aliased (colon → hyphen), and only against the local `.pi/prompts/` + `.pi/skills/` scan — not against…"
---

# How we did it: unify `:` ↔ `-` slash-command aliases — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with the `/opsx:apply` skill body: *"Implement tasks from an
OpenSpec change… select the change, check status, get apply instructions, implement
the tasks."* The concrete change was `unify-opsx-colon-hyphen-aliases`: the dashboard's
bridge prompt-expander treated `/foo:bar` and `/foo-bar` asymmetrically — only colon→hyphen
was aliased, and only against the local `.pi/prompts/` + `.pi/skills/` scan, not the
`pi.getCommands()` registry. The **real objective** that emerged through steering: make
the expander resolve `:` ↔ `-` punctuation aliases **symmetrically** across local
templates, local skills, and the command registry — then verify, archive, and land a
focused commit.

## 2. TL;DR playbook

1. Run `/opsx:apply unify-opsx-colon-hyphen-aliases` — let the model read `tasks.md`
   and implement `packages/extension/src/prompt-expander.ts`.
2. Rewrite the resolver as `candidateNames()` (yields `:`↔`-` variants) + `resolveTemplate()`
   (outer loop over variants, inner probe of local key → `skill:` key → `pi.getCommands()`),
   returning a tagged `{filePath, source, resolvedName}` instead of re-querying `isSkillResolution`.
3. Add unit scenarios to `__tests__/prompt-expander.test.ts` covering both alias directions,
   both local dirs, original-form precedence, registry-beats-remapped-local, and misspelled input.
4. Run tests **hermetically**: `HOME=$(mktemp -d) npx vitest run …/prompt-expander.test.ts`
   (isolates the resolver from your real `~/.pi`).
5. To smoke-test expansion **without any side effects**, import the live TS source with `tsx`
   in a throwaway probe (`npx tsx /tmp/expand-probe.mts "/opsx:verify foo"`) — never trust
   `dist/`, it's stale.
6. `openspec validate <change>` → `npm test` → `npm run reload:check`, then mark tasks `[x]`.
7. `/opsx:verify <change>` for the completeness/correctness/coherence report, then
   `/opsx:archive <change>` (syncs the delta spec into main).
8. Commit **only** the change's files (resolver, test, archived change, synced spec) —
   explicitly leave unrelated working-tree churn untouched.

## 3. How the collaboration unfolded

**Phase 1 — Implement (apply).** The AI read the change tasks and rewrote the resolver:
`candidateNames()` + `resolveTemplate()` with an outer loop over `:`↔`-` variants and an
inner probe of (local key, `skill:` key, registry). It added 8 new test scenarios (10→18),
ran the file green, then `npm test` (5204 passed) and `npm run reload:check`. *Why it worked:*
turning the ad-hoc `isSkillResolution` re-query into a single tagged return made the wrap
site read `resolution.resolvedName` directly — one source of truth for "what did this resolve to".

**Phase 2 — The "verify doesn't show the card" detour.** The operator reported `/opsx:verify`
didn't render as a `SkillInvocationCard`. The AI correctly diagnosed this as **not a bug**:
`opsx-verify` lives in `.pi/prompts/` (a prompt template, un-wrapped body), while the skill is
`openspec-verify-change` in `.pi/skills/`. Different names, by design. *Decision point:* the
human accepted the explanation rather than forcing a wrapper fix.

**Phase 3 — Side-effect-free testing.** Asked "can I test without an actual archive call?", the
AI built a `tsx` probe importing the live source and ran it over five inputs. The first attempt
used `dist/prompt-expander.js` — **stale (built May 2)**; the package ships `src/` directly via
pi's jiti, so the fix was to import the `.ts` with `tsx`. This produced a clean truth table of
which inputs wrap and why.

**Phase 4 — Verify → sync → archive.** Two `/opsx:verify` runs produced identical all-green
reports (Completeness 20/20, Correctness 9+5 scenarios, Coherence 5/5). A `general-purpose`
subagent synced the delta spec. `/opsx:archive` moved the change to
`openspec/changes/archive/2026-05-09-…` and merged the delta into
`openspec/specs/skill-invocation-rendering/spec.md`.

**Phase 5 — Focused commit.** The working tree had lots of unrelated staged/modified files.
The AI paused to ask commit-only-these vs stage-everything, then surgically reset unrelated
files (`vitest.config.ts`, `viewed-session-tracker.ts`, `wsl-tmux-probe-cache.test.ts`) and
committed only the 8 change files (`c5dc235a`, 626+/66−).

## 4. Prompts that worked

- **Goal prompt** (`/opsx:apply …`): effective because the skill body carries the full
  select→status→instructions→implement→verify contract — the AI never had to guess the workflow.
- **"Is there a way to test without actual archive call?"** — high-leverage. It unlocked the
  `tsx` probe pattern (pure-function expansion, zero side effects) that beat spinning up a
  live session.
- **"commit"** — trusting the AI to scope the commit, but it paid off *because* the AI asked
  the confirm question first (only-these vs everything). Stronger version to bake in:
  *"commit ONLY the files this change touched; leave unrelated working-tree changes alone."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| treat `/opsx:verify` not rendering a card as a resolver bug | reporting "opsx verify does not show that tool form" | State up front: prompt templates (`.pi/prompts/`) are un-wrapped by design; only `.pi/skills/` wrap as cards |
| reach for a live dashboard session to test expansion | "test without actual archive call?" | Default to a `tsx` standalone probe importing the live `src/` — never a destructive command |
| import `dist/prompt-expander.js` (stale build) | (self-corrected after a stat check) | Remember: extension ships `src/` via jiti; always `tsx` the `.ts`, treat `dist/` as untrusted |
| re-run an already-green verify | AI offered re-run vs skip; operator re-ran | Note that identical verify reports are idempotent — skip unless artifacts changed |
| leave a broad, mixed staging area | "commit" (after AI proposed only-these) | Always ask only-these-files vs stage-all before committing in a dirty tree |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session — the reusable assets are the
**existing openspec skills** (`/opsx:apply`, `/opsx:verify`, `/opsx:archive`) working
end-to-end, and one pattern worth capturing:

- **`tsx` expander probe** — import `packages/extension/src/prompt-expander.ts` directly and
  call `expandPromptTemplateFromDisk(input, cwd)` over a list of inputs. Removes it takes to
  verify slash-command resolution from "boot a live session + run a destructive command" to a
  one-line pure-function call. Invoke it whenever you touch the expander or want to know how a
  `/foo:bar` string resolves. *This is a strong candidate to save as a project skill.*

## 7. Pitfalls & dead ends

- **Stale `dist/`.** `node /tmp/expand-probe.mjs` against `dist/prompt-expander.js` gave old
  behavior (build was from May 2). Fix: the package loads `src/` via jiti — import the `.ts`
  with `tsx`, don't build/`node` the `dist`.
- **`.pi/prompts/` vs `.pi/skills/` confusion.** `/opsx:verify` never renders a card because
  `opsx-verify` is a prompt template, not a skill. Not a bug — check which directory owns the name.
- **Dirty working tree at commit.** Unrelated files (`vitest.config.ts`,
  `viewed-session-tracker.ts`, `wsl-tmux-probe-cache.test.ts`) were staged; required several
  `git restore --staged` / `git rm --cached` rounds. Ask the scope question *before* staging.
- **Non-hermetic tests.** Run the resolver test with `HOME=$(mktemp -d)` so it doesn't read
  your real `~/.pi/skills` / `~/.pi/prompts`.

## 8. Reproduce it faster — checklist

- [ ] `/opsx:apply unify-opsx-colon-hyphen-aliases` — implement `prompt-expander.ts`
      (`candidateNames()` + `resolveTemplate()`, tagged `{filePath, source, resolvedName}`).
- [ ] Add both-direction alias tests to `__tests__/prompt-expander.test.ts`.
- [ ] `HOME=$(mktemp -d) npx vitest run packages/extension/src/__tests__/prompt-expander.test.ts`
- [ ] Side-effect-free check: `npx tsx /tmp/expand-probe.mts "/opsx:verify foo"` (import the `.ts`, not `dist/`).
- [ ] `openspec validate <change>` → `npm test` → `npm run reload:check`; mark tasks `[x]`.
- [ ] `/opsx:verify <change>` → `/opsx:archive <change>` (delta syncs into `specs/…/spec.md`).
- [ ] Commit ONLY the change's files; `git restore --staged` any unrelated churn first.

**Inputs to have ready:** an active OpenSpec change with `tasks.md`; the extension source
(`packages/extension/src/prompt-expander.ts`) and its test file.

**Artifacts produced:** `prompt-expander.ts` (resolver rewrite), 8 new tests, archived change
at `openspec/changes/archive/2026-05-09-unify-opsx-colon-hyphen-aliases/`, synced
`openspec/specs/skill-invocation-rendering/spec.md`, commit `c5dc235a` (8 files, 626+/66−).

---

_Generated from session `019e0d26` · `pi-agent-dashboard` · 2026-05-09. Source extract: session-to-guideline facts sheet._
