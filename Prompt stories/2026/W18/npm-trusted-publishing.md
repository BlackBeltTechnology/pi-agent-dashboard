---
session: 019de830
week: 2026/W18
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [npm-trusted-publishing]
proposal_excerpt: "The current publish workflow uses a long-lived `NPM_TOKEN` secret for npm authentication, doesn't extract the version from the git tag (relying on whatever is in `package.json`), and doesn't create a GitHub Release. T…"
---

# How we did it: Validating & archiving a drifted OpenSpec proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with *"Validate that recent codebase changes how effect this
proposal"* — a request to reconcile a still-open OpenSpec change
(`npm-trusted-publishing`) against a codebase that had shipped the feature and then
drifted well past the original spec. The *real* objective, once the two follow-up
turns clarified it: **prove which requirements the shipped code still satisfies,
rewrite the delta spec + tasks to match reality, then archive the change** —
deciding along the way whether to sync the reconciled delta back into the main spec.
The answer landed on: reconcile, tick everything, archive **without** syncing
(the main spec had already evolved past the delta via later changes).

## 2. TL;DR playbook

1. Ask the AI to **validate a proposal against current code** — name the change and
   say "which requirements are still satisfied vs. stale/violated, with evidence."
2. Let it inventory the change dir (`ls`/`wc`/`find` on `openspec/changes/<name>/`)
   and cross-read the shipped artifacts (`.github/workflows/publish.yml`, `LICENSE`,
   `package.json`) plus `git log --oneline` on those paths for the drift trail.
3. Have it produce a **✅ satisfied / ❌ stale-or-violated** table, each row backed by
   a concrete file+commit citation (not prose).
4. Say **"ok"** to approve reconciliation — it rewrites `specs/.../spec.md` to reality
   (MODIFIED/ADDED/REMOVED requirements) and ticks `tasks.md`, adding a new section
   that documents the reconciliation itself.
5. Run `openspec validate <name> --strict` and `openspec status --change <name> --json`
   to confirm all artifacts `done`.
6. Before archiving, make it surface the **sync decision explicitly**: diff the
   reconciled delta vs. the current main spec and recommend sync-or-skip with reasons.
7. Trigger `/opsx:archive`; when the main spec has moved past the delta, **archive
   without syncing** and keep the delta as a historical reconciliation doc.
8. Have it call out the residual stale items in the main spec as a **future spec-only
   cleanup**, rather than force-fixing them retroactively through the archive.

## 3. How the collaboration unfolded

Four fast phases (whole session ~4½ minutes, Opus, medium thinking):

- **Discovery.** The AI located the change dir and measured it (`ls`, `wc -l *.md`,
  `find specs -type f`). *Why it worked:* it grounded itself in the actual artifact
  set before making any claim.
- **Evidence gather.** It read `LICENSE` + `package.json`, then ran
  `git log --oneline` scoped to the proposal dir, `publish.yml`, and `LICENSE`. *Why
  it worked:* the commit trail (`c9e9926`, `46a4aa7`, `401fda7` "use node 24"…) is
  what exposed the drift — the spec said Node 22, the code had moved to Node 24.
- **Reconcile & design.** The human said **"ok"**; the AI rewrote the delta spec to
  reality (4-job pipeline, ordered workspace publish, Node 24 publish / 22 elsewhere,
  Electron matrix gated on publish) and ticked all of `tasks.md`, adding a Section 6
  that records the reconciliation. Then `openspec validate --strict` + `status --json`
  confirmed green. *Decision point:* the human accepted the reality-aligned spec over
  the original aspirational one.
- **Sync decision & archive.** The AI stopped **before** archiving to force a sync
  choice — diffing delta vs. main and recommending "archive without syncing" because
  main had already been superseded by later changes. The `/opsx:archive` command moved
  the change to `archive/2026-05-02-npm-trusted-publishing/`, sync skipped.

## 4. Prompts that worked

- **The goal prompt** — *"Validate that recent codebase changes how effect this
  proposal."* Rough grammar, but it carried the one thing that matters: *validate a
  spec against shipped code*. Stronger version to reuse:
  > "Validate the `<change>` OpenSpec proposal against the current codebase. For each
  > requirement, tell me satisfied vs. stale/violated with a file+commit citation,
  > then reconcile the delta spec + tasks to reality and tell me whether to sync
  > before archiving."
- **High-leverage follow-up: "ok"** — a one-word unlock that approved the whole
  reconcile-and-tick pass after the evidence table made the changes obvious. This only
  works *because* phase 2 produced a citation-backed table first; approve fast when the
  evidence is already on the table.
- **The `/opsx:archive` command** — invoking the archive skill directly kept the
  finalization on rails (status check → task check → sync decision → move).

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the proposal as the source of truth | Framing the ask as *validate code → reconcile spec* | Say up front "the code is reality; rewrite the spec to match, not vice versa" |
| Potentially rush from reconcile straight to archive | Letting it pause and present the sync decision explicitly | Ask for "a sync-or-skip recommendation with reasons before you archive" |
| Want to fix everything in one pass | Accepting a scoped archive + deferring residual stale main-spec items | Say "archive the delta as historical; list leftover cleanups as a future spec-only change" |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session *used* two existing OpenSpec skills
well: **validate/status** (`openspec validate --strict`, `openspec status --json`) as
the objective gate, and **`/opsx:archive`** as the finalize-on-rails command.

Recommended skill to create if this recurs: a **"reconcile-drifted-openspec-change"**
procedure — inventory change dir → cross-read shipped artifacts + `git log` on the same
paths → emit satisfied/stale table with citations → rewrite delta to reality + tick
tasks → force an explicit sync decision → archive. It's effective because it removes
the judgment-heavy "is this proposal still true?" step and makes the sync-or-skip call
a deliberate checkpoint instead of an afterthought.

## 7. Pitfalls & dead ends

- **Blindly syncing a stale delta back to main is a trap.** Here the main spec had
  already evolved past the delta (prerelease, no-bash-on-Windows, contract tests), so
  syncing would have *reintroduced* superseded requirements. If the main spec is
  newer than the delta → archive without syncing, keep the delta as history.
- **A rename in a delta = remove + add in OpenSpec sync** (`Node.js version` →
  `Node.js versions`, `npm provenance` → `npm provenance and ordered workspace
  publishing`). Don't assume a renamed requirement merges cleanly.
- **Residual stale items in the main spec** (NPM_TOKEN req, "Node 22 for both",
  "lint/test in publish") were intentionally *not* fixed via the archive — chase them
  in a small spec-only change, not retroactively.
- No commands failed (0/9) — the discipline of grounding every claim in a
  `git log`/file read before asserting it is what kept it clean.

## 8. Reproduce it faster — checklist

- [ ] Have the change name and repo root ready (`openspec/changes/<name>/`).
- [ ] Inventory: `ls`/`wc -l *.md`/`find specs -type f` on the change dir.
- [ ] Gather evidence: read the shipped artifacts + `git log --oneline -- <paths>`.
- [ ] Get a ✅ satisfied / ❌ stale table, each row with a file+commit citation.
- [ ] Approve reconciliation ("ok") → rewrite `spec.md` to reality, tick `tasks.md`,
      add a reconciliation section.
- [ ] Gate: `openspec validate <name> --strict` + `openspec status --change <name> --json`.
- [ ] Force the sync decision: diff delta vs. main, recommend sync-or-skip with reasons.
- [ ] `/opsx:archive` → if main is newer, **skip sync**; defer residual cleanups.

**Final artifacts:** `openspec/changes/npm-trusted-publishing/specs/ci-cd-pipeline/spec.md`
(reality-aligned delta), `.../tasks.md` (all ticked + reconciliation section), archived to
`openspec/changes/archive/2026-05-02-npm-trusted-publishing/`.

---

_Generated from session `019de830-dc1e-70be-8251-98e8d5ba647b` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-02. Source extract: `/tmp/session_facts_12041.md`._
