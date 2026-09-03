---
session: 019f1548
week: 2026/W27
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-bridge-server-start-diagnostics, distinguish-offline-from-network-denied, unify-error-retry-lifecycle, spawn-failure-diagnostics]
proposal_excerpt: "GitHub issue #99: \"fails to start, and there's no logfile as claimed.\""
---

# How we did it: Validate GitHub issue #99 and scaffold two OpenSpec proposals — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator entered **explore mode** (`openspec-explore`) on GitHub issue #99 —
a bug report that the dashboard *"fails to start, and there's no logfile as claimed."*
The real objective, once steering clarified it, was two-fold: (1) **validate the reported
symptoms against the actual code** rather than take the screenshots at face value, and
(2) **capture the fix as OpenSpec proposals** — deliberately staying in thinking/planning
mode, never implementing. A late scope addition folded a second, unrelated bug cluster
(remote access: telling "offline" apart from "network not allowed") into the work.

Kickoff prompt (verbatim): the `openspec-explore` skill stance — *"Enter explore mode.
Think deeply… you must NEVER write code or implement features… You MAY create OpenSpec
artifacts."*

## 2. TL;DR playbook

1. **Feed the AI the evidence, not just the title.** Fetch the issue *and its
   image attachments* (`gh issue view … --json body,title,comments`; `curl` the
   `user-attachments` PNGs) so the model reads the real error text, not a paraphrase.
2. **Ask it to validate root cause from the code before proposing anything.** It will
   `grep` for the exact strings in the error (`readiness timeout`, `server.log`,
   `stdio: "ignore"`, `networkGuard`) and point at the smoking-gun lines.
3. **Let it split the report into distinct bug clusters.** One screenshot ≠ one bug;
   here it correctly separated *"start fails / no log"* from *"remote access denied"*.
4. **Steer scope in one line** when a second concern matters: *"scaffold proposals …
   distinguish real offline from network-not-allowed."*
5. **Require the pre-scaffold coherence sweep** (project convention): make it check
   whether the fix is a **delta to an existing capability** vs a new one before writing
   any `proposal.md`. Here all four capabilities already existed.
6. **Match repo spec-delta convention** — have it read a recent `proposal.md` +
   `.openspec.yaml` first, then scaffold in the same style.
7. **Gate on `openspec validate`** for every change dir before declaring done.
8. **Commit surgically + update the issue.** `git add` only the proposal dirs (leave
   unrelated working-tree noise like `groups.json`), then post the validation findings
   as an issue comment.

## 3. How the collaboration unfolded

**Phase 1 · Evidence gathering (23:29).** The AI pulled issue #99's body, comments,
and both screenshot attachments (`fetch_content` + `curl`). It refused to reason from
the title alone — *"I need to see the screenshots to understand the actual errors."*
Why it worked: the images carried the literal terminal output (`cat server.log → No
such file or directory`, `server.pid → 1944674`), which anchored every later claim to
real strings.

**Phase 2 · Root-cause validation from code (23:29–23:31).** A tight sequence of
`grep`s over `packages/extension`, `packages/server`, `packages/client` chased the
exact error phrases. It found the smoking gun — the bridge auto-spawn uses
`stdio: "ignore"` (so the promised `server.log` is never written) and a 2 s
`healthTimeoutMs` (too short for a cold start on a slow host). It then separated a
**second** cluster: `/api/health` is ungated (200 even remotely) so the "Access denied"
was the `networkGuard` 403 on `/api/browse`, plus a phantom `localhost` server-selector
row. Decision point: the human's issue lumped both together; the AI un-lumped them.

**Phase 3 · Coherence sweep before writing (23:34–23:35).** Prompted to *"scaffold
proposals,"* the AI first ran the project's pre-scaffold coherence check — surveying
`openspec list`, the archive, and existing specs. It confirmed the fixes were **delta
modifications** to `server-launch`, `trusted-networks`, `server-selector`,
`connection-status-banner`, `filesystem-browser` (all pre-existing), not new
capabilities. It also read a recent `proposal.md` + `.openspec.yaml` to copy the repo's
delta format.

**Phase 4 · Scaffold + validate (23:37–23:39).** It wrote two full change dirs
(proposal, specs deltas, tasks, design, `.openspec.yaml`) and ran `openspec validate`
on both — clean.

**Phase 5 · Commit + report (23:40–23:41).** `git status` first; it noticed an
unrelated `groups.json` board-state change, diffed it, and **deliberately excluded it**
from the commit. It committed only the two proposal dirs (`130c65dc` on `develop`) and
posted a validation comment on issue #99 laying out both root causes, then flagged the
open auth question and the stray `groups.json` back to the human.

## 4. Prompts that worked

- **The goal prompt (`openspec-explore` stance).** Effective because it fixed the
  *mode* up front: think + investigate + may-create-artifacts, but **never implement**.
  That kept the whole session as validated planning, not a premature code change.
- **High-leverage follow-up: "scaffold proposals … distinguish real offline from
  network not allowed."** One sentence that both authorized artifact creation and added
  the second bug cluster's core insight (offline ≠ denied). Short, high scope.
- **"commit and update issue."** Terminal instruction that turned validated thinking
  into durable outputs (commit + issue comment) in one move.

Stronger rewrite of prompt 2 (it had typos and was terse): *"Scaffold OpenSpec
proposals for both clusters. For the remote one, the key requirement is distinguishing
a real offline server from a reachable-but-network-denied one — surface that difference
in the UI."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stay in pure-explore mode indefinitely | "scaffold proposals" — explicitly authorize artifact creation | State up front: "validate, then scaffold OpenSpec proposals if root cause is confirmed." |
| Treat issue #99 as one bug | (AI self-corrected here) — but reinforce the split | Ask "is this one bug or several?" whenever a report bundles multiple screenshots. |
| Risk missing the deeper UX ask | "distinguish real offline from network not allowed" | Name the *distinction* you care about, not just "fix remote access." |
| Potentially commit unrelated working-tree changes | (AI flagged `groups.json` and excluded it) | Say "commit only the proposal dirs" to make the surgical scope explicit. |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the reusable asset is the **OpenSpec
proposal pair** plus the *method*. The repeatable pattern worth capturing as a skill:
**"validate a bug report from code → split into clusters → coherence-sweep for existing
capabilities → scaffold delta proposals → validate → commit + comment."**

- **What it would capture:** the disciplined path from a fuzzy issue to
  `openspec validate`-clean, correctly-scoped delta proposals.
- **Why effective:** it removes two recurring failure modes — proposing new capabilities
  that already exist (the coherence sweep catches this), and proposing fixes for
  symptoms the code doesn't actually exhibit (the grep-the-error-string validation
  catches this).
- **When to invoke:** any GitHub issue where you must confirm root cause before writing
  a proposal, especially in a repo with an OpenSpec capability registry.

## 7. Pitfalls & dead ends

- **No failed commands this session** — but the near-miss was the unrelated
  `groups.json` working-tree change. *If you see stray uncommitted files that aren't
  yours, diff them, exclude them from `git add`, and flag them to the human* — don't
  blanket-commit.
- **Don't trust "no logfile" at face value.** The report's core complaint ("no logfile
  as claimed") was *correct but its cause was subtle* — `stdio: "ignore"` means the log
  is never created, not that logging is broken. Grep the spawn path, don't guess.
- **`/api/health` being ungated is a trap** when diagnosing "Access denied" — the 403
  came from `networkGuard` on `/api/browse`, not the health probe. Check *which*
  endpoint returns the error before blaming the obvious one.

## 8. Reproduce it faster — checklist

- [ ] `gh issue view <n> --json body,title,comments` + `curl` the image attachments.
- [ ] `grep` the codebase for the **exact** error strings in the screenshots.
- [ ] Split the report into independent bug clusters; validate each from code.
- [ ] Run the pre-scaffold coherence sweep (`openspec list`, archive, existing specs) —
      is this a delta to an existing capability or a new one?
- [ ] Read one recent `proposal.md` + `.openspec.yaml` to match delta format.
- [ ] Scaffold each change dir (proposal / specs / tasks / design / `.openspec.yaml`).
- [ ] `openspec validate <change>` — clean for every dir.
- [ ] `git add` **only** the proposal dirs; commit; post validation findings as an
      issue comment.

**Inputs to have ready:** repo checkout on `develop`, `gh` auth, issue number + image
attachment URLs.
**Artifacts produced:** `openspec/changes/fix-bridge-server-start-diagnostics/` and
`openspec/changes/distinguish-offline-from-network-denied/` (proposal, specs deltas,
tasks, design, `.openspec.yaml` each); commit `130c65dc` on `develop`; validation
comment on issue #99.

---

_Generated from session `019f1548-95de-7295-89d8-d07228983b66` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-29. Source extract: `/tmp/facts-ZT4i8X.md`._
