---
session: 019da895
week: 2026/W17
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [dashboard-ux-fixes-batch]
proposal_excerpt: "The dashboard has accumulated a batch of UX bugs and missing features that hurt daily usability: terminal tab close buttons are invisible, saving providers doesn't refresh the model list until restart, package install…"
---

# How we did it: Verify → archive → commit an OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user kicked off with the `/opsx:verify` command against the `dashboard-ux-fixes-batch`
OpenSpec change — a batch of accumulated dashboard UX fixes (invisible terminal tab close
buttons, provider save not refreshing models, package-install state lag, device-code
auto-open, model selector search/filter). The literal ask was *"verify that the
implementation matches the change artifacts (specs, tasks, design)."*

Once the steering turns landed, the **real objective** was the full close-out sequence:
**verify the change is done → fix the one stale artifact → archive it with delta specs
synced into the main specs → commit only the archive-related changes** without touching
unrelated working-tree noise. Three slash-commands, one clean commit, ~10 minutes.

## 2. TL;DR playbook

1. `/opsx:verify dashboard-ux-fixes-batch` — read `tasks.md` + delta specs, cross-check each
   requirement against real source files, emit a Completeness/Correctness/Coherence report.
2. When verify flags a stale task description, prompt `fix` — patch `tasks.md` to describe
   **what was actually built**, not the abandoned design (here: reuse `ModelSelector`
   directly, not a never-created `DefaultModelSelector` wrapper).
3. `/opsx:archive dashboard-ux-fixes-batch` — check all artifacts `done`, then **sync each
   delta spec into `openspec/specs/<capability>/spec.md`** before moving to `archive/`.
4. Confirm the sync summary lists every capability touched (bridge-extension, event-reducer,
   model-selector, package-install, provider-auth-ui, settings-panel, terminals-view).
5. `openspec validate <change>` → move to `openspec/changes/archive/<date>-<change>/`.
6. Prompt `commit changes` — but **`git add` only the archive + spec-sync paths explicitly**,
   never `git add -A`, because the tree has unrelated pre-existing edits.
7. Verify the staged diff (`git diff --cached --stat`) shows only archive/spec files, then
   commit with an `openspec: archive … and sync specs` message.

## 3. How the collaboration unfolded

**Phase 1 — Verify (Discovery).** The AI ran `openspec status --change … --json` and
`openspec instructions apply --change … --json` to load the schema (`spec-driven`) and
context files, then read `tasks.md` and every delta `spec.md`. Instead of trusting the
checkboxes, it grep'd the actual source (`TerminalsView.tsx`, `useMessageHandler.ts`,
`provider-routes.ts`, `useInstalledPackages.ts`, `ProviderAuthSection.tsx`, `SettingsPanel.tsx`)
to prove each requirement was really implemented. Result: 22/22 tasks, 9/9 requirements, a
clean report. *Why it worked:* evidence-by-file-line, not checkbox-trust.

**Phase 2 — Fix the stale artifact.** Verify surfaced that task 5.5 described a
`DefaultModelSelector` wrapper that was never built (the team reused `ModelSelector`
directly). The human's one-word `fix` prompt triggered a surgical `tasks.md` edit to match
reality. *Decision point:* keep the artifact honest before archiving, so the archived record
matches the code.

**Phase 3 — Archive + sync specs.** On `/opsx:archive`, the AI paused to confirm sync
preference, then merged each delta requirement into the main capability specs (7 capabilities),
ran `openspec validate`, and moved the change to `archive/2026-04-20-dashboard-ux-fixes-batch/`.
*Why it worked:* the delta→main-spec merge is the step that keeps `openspec/specs/` the living
source of truth; skipping it leaves the main specs stale.

**Phase 4 — Scoped commit.** `git status` revealed unrelated pre-existing edits (CHANGELOG,
README, package.json, source, other archives). The AI explicitly `git add`-ed only the archive
and synced-spec paths, verified the cached diff, and committed. *Decision point:* isolate this
session's work from unrelated tree noise.

## 4. Prompts that worked

- **The goal prompt** — the `/opsx:verify` slash-command. Effective because it carries the full
  procedure (list → status → load artifacts → cross-check) so the AI has an unambiguous rubric.
  A stronger kickoff names the change up front (`/opsx:verify dashboard-ux-fixes-batch`) to skip
  the selection prompt.
- **`fix`** — one word, high leverage. In the verify context it unambiguously meant "patch the
  one stale artifact you just flagged." Works only because verify had already localized the
  single defect.
- **`/opsx:archive`** — carries its own guardrails (check artifacts `done`, sync specs, confirm).
- **`commit changes`** — short, but the AI correctly inferred *scope only this session's files*
  from the surrounding archive context. A stronger version states it: *"commit only the archive
  and spec-sync changes; leave unrelated working-tree edits untouched."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Report verify results and stop | `fix` | Let verify auto-offer to patch the single stale artifact it flagged |
| Treat "commit" as commit-everything | `commit changes` (in archive context) | State scope in the prompt: "only archive + spec-sync paths" |
| Pause for sync preference before archiving | (implicit approval via `/opsx:archive`) | Default to syncing delta specs into main specs; it's the point of archive |

The quality bar the user imposed: the archived record must match the **real code** (task 5.5
fix), and the commit must be **surgically scoped** to this session's files despite a dirty tree.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the whole flow rode on existing OpenSpec slash-commands
(`/opsx:verify`, `/opsx:archive`) plus `git`. That's the signal that this workflow is already
well-captured by tooling.

**Recommended reusable capture:** a `openspec-close-out` skill that chains
*verify → fix-stale-artifact → archive (with spec sync) → scoped commit* as one procedure,
including the **explicit-`git add` guardrail** (never `git add -A` on a dirty tree). This repo
already ships `openspec-verify-change`, `openspec-archive-change`, and `openspec-sync-specs`
skills; the missing piece is the orchestration + the scoped-commit discipline.

## 7. Pitfalls & dead ends

- **Stale task artifact.** `tasks.md` described a `DefaultModelSelector` component that was never
  built. If you hit a verify mismatch, patch the artifact to match the shipped code before
  archiving — don't archive the fiction.
- **Dirty working tree at commit time.** The tree had unrelated edits (CHANGELOG, README,
  package.json, source, other archives). If you `git add -A` here you'd bundle unrelated work
  into the archive commit. Instead, `git add` the exact archive + spec paths and verify with
  `git diff --cached --stat` before committing.
- **Skipping the delta→main-spec sync.** Archiving without syncing leaves `openspec/specs/` stale.
  The archive step must merge each delta requirement into its capability spec first.

## 8. Reproduce it faster — checklist

- [ ] `openspec status --change <name> --json` — confirm schema + artifacts.
- [ ] `/opsx:verify <name>` — cross-check each requirement against real source files, not checkboxes.
- [ ] Patch any stale `tasks.md` entry to match the shipped code.
- [ ] `/opsx:archive <name>` — sync every delta spec into `openspec/specs/<capability>/spec.md`.
- [ ] `openspec validate <name>`; move to `openspec/changes/archive/<date>-<name>/`.
- [ ] `git status` to see the tree; `git add` **only** the archive + synced-spec paths.
- [ ] `git diff --cached --stat` — confirm no unrelated files staged; commit.

**Inputs to have ready:** the OpenSpec change name, a clean understanding of which capabilities
its deltas touch, and awareness of any unrelated working-tree edits.

**Final artifacts produced:** `openspec/changes/archive/2026-04-20-dashboard-ux-fixes-batch/`,
updated `openspec/specs/{bridge-extension,event-reducer,model-selector,package-install,provider-auth-ui,settings-panel,terminals-view}/spec.md`, and one scoped `openspec: archive …` commit.

---

_Generated from session `019da895` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-20. Source extract: `facts.NeBpUNZZiY.md`._
