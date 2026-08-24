---
session: 019e1309
week: 2026/W19
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-electron-auto-update-pipeline]
proposal_excerpt: "The Electron app wires up `electron-updater` end-to-end (`packages/electron/src/lib/app-updater.ts`, dialog UI in `main.ts:377-403`), but no user has ever seen an update prompt. The publish pipeline does not produce t…"
---

# How we did it: Fix the Electron auto-update pipeline — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a thinking-partner stance,
not an implementation task. The operator's real trigger was a one-line observation the
turn after: *"I've never seen [the] updater."* The genuine objective: **understand why the
Electron app's `electron-updater` machinery never surfaces an update prompt, then capture
the fix as a complete OpenSpec change** — proposal, design, delta specs, and tasks — ready
to hand to an implementer. No code was written; the deliverable is a validated planning
artifact set for the `fix-electron-auto-update-pipeline` change.

## 2. TL;DR playbook

1. Enter explore mode (`/skill:openspec-explore`) — investigate, don't implement.
2. State the symptom in one line: *"I've never seen the updater fire."* Let the AI trace
   the mechanism end-to-end (`app-updater.ts` → `main.ts` dialog wiring → publish workflow).
3. Let it grep the *whole* chain — runtime code **and** `.github/workflows/publish.yml`
   **and** the `release-cut` skill — before concluding. The root cause is split across all three.
4. Confirm the three-part diagnosis (drafts / no `latest*.yml` / unsigned macOS) before
   moving on. Each is independently fatal.
5. Say **"create proposal"** — the AI writes `proposal.md` with Why / What-changes /
   New-capability / Modified-capabilities / Out-of-scope.
6. Fast-forward the rest (`/opsx-ff`) — generate `design.md`, delta `spec.md` files, and
   `tasks.md` in dependency order, running `openspec validate` between artifacts.
7. Verify with `openspec validate <change>` and `openspec status --change <change> --json`;
   stop when apply-ready.

## 3. How the collaboration unfolded

**Phase 1 · Discovery (trace the mechanism).** From the "I've never seen it" nudge, the AI
grepped `packages/electron/src` + docs for `electron-updater` / `autoUpdater`, then narrated
the *intended* flow: 60s-after-launch check, `update-available` dialog, `update-downloaded`
dialog, `quitAndInstall()`, silent install on quit. **Why it worked:** establishing the
happy-path first gives a baseline to contrast the failure against.

**Phase 2 · Root-cause (why the path is dead).** The AI widened the grep to the *delivery*
layer — `publish.yml`, Forge config, the `release-cut` skill — and produced a crisp
three-fault diagnosis: (1) releases are `draft: true`, which `electron-updater` ignores;
(2) no `latest*.yml` / `latest-mac.yml` metadata is ever generated (repo uses Forge makers +
hand-rolled `action-gh-release`, not electron-builder's publish step); (3) macOS refuses
unsigned updates. **Decision point:** the human implicitly accepted the diagnosis by asking
to "create proposal" — no push-back needed because the evidence was file-cited.

**Phase 3 · Proposal.** On "create proposal" the AI ran `openspec new change` (after a
couple of `--help` probes to find the right subcommand) and wrote `proposal.md`: Why, the
five fixes, one NEW capability (`electron-auto-update`), two MODIFIED (`electron-build-pipeline`,
`ci-cd-pipeline`), and explicit Out-of-scope (delta updates, Windows signing).

**Phase 4 · Fast-forward the artifacts.** The `/opsx-ff` prompt drove the remaining
artifacts to apply-ready: `design.md` (7 decisions D1–D7), three delta specs, and a
`tasks.md` of 8 groups / 40 tasks. **Why it worked:** the AI used `openspec instructions
<artifact> --json` + `openspec status --json` to build in dependency order and
`openspec validate` between steps, ending green.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-explore`** followed by the terse symptom *"I've never
  seen [the] updater."* Effective because it framed a **read-only investigation** and let
  the model own the tracing. A stronger single kickoff: *"Explore why the Electron
  auto-updater never prompts — trace `app-updater.ts` through the publish workflow, then
  propose a fix as an OpenSpec change."*
- **High-leverage follow-up — "create proposal."** Two words converted a diagnosis into a
  structured artifact. It worked *because* the diagnosis was already file-cited and
  three-part; the model had everything it needed.
- **High-leverage follow-up — `/opsx-ff`.** One command generated design + specs + tasks in
  the correct dependency order with validation between each. Reach for it once the proposal
  is agreed and you want everything to apply-ready in one pass.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Explain only the *runtime* updater flow and stop | "I've never seen [the] updater" — nudging it to explain why the wired code is inert | Ask up front: "why does the wired path never fire in production?" so it greps the delivery layer too |
| Look for the updater fault in application code alone | (implicit) the fix lives in `publish.yml` + `release-cut` skill, not `app-updater.ts` | State that the diagnosis must cover build + publish + signing, not just the Electron main process |
| Probe `openspec` subcommands by trial (`change new` vs `new change`) | let it self-correct via `--help` | Note the correct invocation is `openspec new change <name>` |
| Pause for review after the proposal ("continue or pause?") | `/opsx-ff` to authorize generating the rest | If you want all artifacts, lead with `/opsx-ff` instead of stopping at the proposal |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this session was pure *consumption* of the existing
OpenSpec toolchain. The reusable assets it exercised:

- **`openspec-explore`** — the read-only stance that keeps investigation from sliding into
  premature implementation. Invoke it whenever the ask is "why does X behave this way" and
  you want a captured proposal, not a patch.
- **`/opsx-ff` (openspec fast-forward)** — generates design → specs → tasks in dependency
  order with validation gates. Invoke once a proposal is agreed and you want an apply-ready
  change in one pass.

**Recommendation:** the three-fault Electron auto-update diagnosis (drafts / missing
`latest*.yml` / unsigned macOS) is a recurring, non-obvious failure signature. It would be
worth a small project skill — *"why electron-updater never prompts"* — so the next operator
gets the checklist instead of re-deriving it.

## 7. Pitfalls & dead ends

- **`openspec change new` is wrong** — the working form is `openspec new change <name>`. The
  session burned two `--help` probes finding it. If `change new` errors, flip the word order.
- **One failed `ls`/`head` on the change dir** before it existed — harmless; the scaffold
  hadn't been created yet. Create the change *before* trying to read its files.
- **Validator flags "no deltas" at the proposal stage** — this is *expected*, not a failure.
  The delta specs are added in the later `/opsx-ff` pass; don't chase this warning early.
- **Diagnosing only the runtime code is a dead end** — the updater looks *correctly wired*.
  The fault is entirely in delivery (draft releases, missing metadata, no signing). Always
  grep the publish workflow and release skill before concluding "the code is fine."

## 8. Reproduce it faster — checklist

**Inputs to have ready:** repo with `openspec` CLI on PATH; the Electron package
(`packages/electron/`), `.github/workflows/publish.yml`, and the `release-cut` skill accessible.

1. `/skill:openspec-explore` — read-only stance.
2. Trace `electron-updater` from `app-updater.ts` → `main.ts` dialog wiring → `publish.yml`
   → `release-cut`. Confirm the three faults: drafts, no `latest*.yml`, unsigned macOS.
3. `create proposal` → writes `proposal.md` (Why / fixes / 1 NEW + 2 MODIFIED caps / out-of-scope).
4. `/opsx-ff` → generates `design.md`, delta `specs/*/spec.md`, `tasks.md` in order.
5. `openspec validate fix-electron-auto-update-pipeline` and
   `openspec status --change … --json` — stop when apply-ready.

**Artifacts produced (paths):**
- `openspec/changes/fix-electron-auto-update-pipeline/proposal.md`
- `openspec/changes/fix-electron-auto-update-pipeline/design.md`
- `openspec/changes/fix-electron-auto-update-pipeline/specs/electron-auto-update/spec.md`
- `openspec/changes/fix-electron-auto-update-pipeline/specs/electron-build-pipeline/spec.md`
- `openspec/changes/fix-electron-auto-update-pipeline/specs/ci-cd-pipeline/spec.md`
- `openspec/changes/fix-electron-auto-update-pipeline/tasks.md`

---

_Generated from session `019e1309` · `pi-agent-dashboard` · 2026-05-10. Source extract: deterministic facts sheet._
