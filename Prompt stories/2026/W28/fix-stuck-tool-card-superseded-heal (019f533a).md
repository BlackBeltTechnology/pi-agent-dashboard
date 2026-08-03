---
session: 019f533a
week: 2026/W28
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-stuck-tool-card-superseded-heal, reduce-chat-render-cpu-umbrella, fix-stuck-tool-card-on-dropped-event]
proposal_excerpt: "A tool card can stay stuck on the running spinner permanently — observed at 2 min+ with no recovery — while the session keeps rendering later cards normally. The base change fix-stuck-tool-card-on-dropped-event…"
---

# How we did it: Archive + sync two dependency-coupled OpenSpec changes, base-first — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with three words: `archive synch and commit`. The *real* objective
that emerged: land the completed OpenSpec change `fix-stuck-tool-card-superseded-heal`
by archiving it, syncing its delta spec into the main spec
(`openspec/specs/incremental-event-sync/spec.md`), and committing — **without corrupting
the main spec or bundling unrelated concurrent work** from other live sessions sharing
the same working tree. The deceptively small ask hid a dependency trap: this change's
delta *MODIFIES* a requirement (`Stale running-tool reconcile`) that lives only in an
**unsynced base change** (`fix-stuck-tool-card-on-dropped-event`), so a naive sync would
have produced an incoherent main spec.

## 2. TL;DR playbook

1. Before archiving, ask: *does this change's delta MODIFY a requirement, and is that
   requirement actually present in the main spec yet?* If not, find the change that ADDS it.
2. `openspec list --json` + inspect each coupled change's `specs/<name>/spec.md` delta —
   note which requirements each **ADDS** vs **MODIFIES**.
3. Establish dependency order: the change that **ADDS** a requirement must sync **before**
   the change that **MODIFIES** it. Sync base-first.
4. Don't hand-edit the main spec to "help" the sync. Let `openspec archive <change> -y`
   apply the deltas itself — it is tool-verified and won't double-apply.
5. If `openspec archive` reports a structural blocker (e.g. `## ADDED Requirements` header
   in a *main* spec), fix that minimal corruption first — it hides requirements from tooling.
6. Archive base change, then the dependent change, each with `-y`. Verify with
   `openspec validate incremental-event-sync --type spec --strict`.
7. Stage **only your own files** (`git add <explicit paths>`), never `git add -A` when the
   tree holds concurrent work from other sessions. Commit with a descriptive message.
8. Report what you left untouched, explicitly, so the operator trusts the boundary.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & blocker detection.** The AI ran `git status`, read `tasks.md`,
and compared the change's delta spec against the main spec. It caught that the delta
*MODIFIES* `Stale running-tool reconcile`, a requirement not yet in main — introduced by
a still-active base change (14/16 tasks). *Why it worked:* it refused to sync on the
surface signal ("change is 17/17 complete") and instead traced the requirement's origin.

**Phase 2 — Stop and surface the blocker.** Rather than guess, the AI used `ask_user` to
present the exact situation (complete-but-blocked, base-change-first is the only coherent
order) and the stray scratch files in the tree. The human said cancel; the AI left the
tree byte-for-byte unchanged and stated the clean path for later.

**Phase 3 — Re-check after concurrent churn.** On the next prompt (`recheck, there was
commits`) the AI re-read the tree and found it had changed — another session had committed
work and left *different* uncommitted files belonging to `reduce-chat-render-cpu-umbrella`.
It correctly identified those as a cohesive unit for a **different** change and declined to
touch them.

**Phase 4 — Execute base-first sync.** Once the tree was clean, the AI committed to the
dependency-ordered plan: archive the base change (ADDS 2 requirements), then the dependent
change (ADDS 1, MODIFIES 1). It hit a real structural blocker — the main spec's line-5
header was `## ADDED Requirements` (a delta-only header, illegal in a main spec) which hid
every requirement from tooling — and fixed exactly that one line. Then `openspec archive`
applied both deltas.

**Phase 5 — Surgical commit.** The AI staged **only its 11 files** (10 archive renames +
the main-spec sync), left all concurrent work unstaged, committed (`aceb4ed61`), and
reported precisely what it left untouched.

## 4. Prompts that worked

- **The goal prompt** — `archive synch and commit`. Terse, but effective *because the AI
  treated it as intent, not a literal script*: it verified preconditions before acting. A
  stronger kickoff would name the change and the coupling risk up front: *"archive + sync
  + commit `fix-stuck-tool-card-superseded-heal`; watch for delta requirements that depend
  on an unsynced base change, and don't bundle other sessions' work."*
- **`recheck, there was commits`** — high-leverage: it forced a fresh tree read after
  concurrent churn, which is exactly when stale state causes wrong commits.
- **`archive and synch` / `commit`** — short unlocks that advanced the plan once the
  blocker cleared. They worked because the AI had already laid out the ordered plan, so a
  one-word go was unambiguous.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "complete change" as "ready to sync" | Nothing — the AI self-caught the base-change dependency | State up front: *"sync respects delta dependency order; ADD before MODIFY"* |
| Act on a possibly-stale working tree | `recheck, there was commits` | Always re-run `git status` immediately before any archive/commit when other sessions may be live |
| Risk hand-editing the main spec to force a sync | (self-corrected) reverted the manual append and let `openspec archive` apply deltas | Prefer the CLI's tool-verified apply over manual spec edits; only patch genuine structural corruption |
| Potentially bundle concurrent work | (self-corrected) staged explicit paths only | Never `git add -A` in a shared tree; `git add <your files>` and report the untouched set |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created in this session. But the workflow is clearly repeatable and
**should be captured as a skill**: *"archive + sync dependency-coupled OpenSpec changes."*
It would encode (a) the ADD-before-MODIFY ordering rule, (b) the "let `openspec archive`
apply deltas, don't hand-edit main" discipline, (c) the `## ADDED Requirements` →
`## Requirements` main-spec corruption fix, and (d) the shared-tree surgical-staging rule.
Invoke it whenever archiving a change whose delta MODIFIES a requirement, or when several
coupled changes must land together.

## 7. Pitfalls & dead ends

- **Syncing a MODIFY before its ADD.** Syncing the dependent change alone would strand the
  base requirement and drop `Drop-site delivery instrumentation` entirely → incoherent main
  spec. *If you hit a delta that MODIFIES an absent requirement, find and sync its ADD source first.*
- **Hand-editing the main spec to "help."** The AI first appended requirements manually,
  then reverted (`git checkout`) and let `openspec archive` apply them — the CLI path is
  tool-verified and avoids double-apply. *If tempted to edit main by hand, revert and use the CLI.*
- **`## ADDED Requirements` header in a main spec.** A pre-existing corruption (108 specs
  share the quirk repo-wide) that makes every requirement invisible to tooling and blocks
  sync. *If archive fails cryptically, check the main spec's top-level header is `## Requirements`.*
- **Stale tree in a multi-session repo.** Other live sessions commit and leave uncommitted
  files mid-task. *Always re-read `git status` right before staging; stage explicit paths only.*
- **A `grep -c` returning 0 breaks an `&&` chain.** One command "failed" only because a
  zero-count grep short-circuited the chain — not a real error. *Don't chain verification
  greps with `&&` when a legitimate zero-count is expected.*

## 8. Reproduce it faster — checklist

- [ ] `git status` — confirm tree state; note any concurrent-session files to leave alone.
- [ ] For the target change, read `specs/<name>/spec.md` — list its ADDED vs MODIFIED requirements.
- [ ] For each MODIFIED requirement, confirm it exists in the main spec; if not, find the base change that ADDS it.
- [ ] Order the changes ADD-before-MODIFY (base-first).
- [ ] If the main spec's top header is `## ADDED Requirements`, fix it to `## Requirements`.
- [ ] `openspec archive <base-change> -y`, then `openspec archive <dependent-change> -y`.
- [ ] `openspec validate incremental-event-sync --type spec --strict`.
- [ ] `git add <your explicit paths only>` — never `-A` in a shared tree.
- [ ] `git commit` with a message naming both changes and the synced requirements.
- [ ] Report the untouched concurrent-work set explicitly.

**Key inputs:** the OpenSpec CLI (`openspec list/archive/validate`), write access to
`openspec/specs/` and `openspec/changes/`, and awareness of which other sessions share the tree.
**Final artifacts:** commit `aceb4ed61` (11 files) — both changes archived under
`openspec/archive/2026-07-11-…`, main spec `openspec/specs/incremental-event-sync/spec.md`
synced with `+ Stale running-tool reconcile`, `+ Drop-site delivery instrumentation`,
`+ Superseded terminal heal`, and the `## ADDED Requirements` → `## Requirements` corruption fixed.

---

_Generated from session `019f533a` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-12. Source extract: `/tmp/facts_9619_1784863459.md`._
