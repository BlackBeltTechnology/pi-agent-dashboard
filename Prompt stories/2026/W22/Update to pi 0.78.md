---
session: 019e7986
week: 2026/W22
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [bump-pi-compat-to-0-78, surface-input-streaming-behavior, bump-pi-compat-to-0-76, retire-rpc-keeper-when-dispatchcommand-available, add-editor-keeper-sidecar]
proposal_excerpt: "Pi has published two minor releases since the 0.75 floor was drafted: `0.76.0` (2026-05-27), `0.77.0` (2026-05-28), `0.78.0` (2026-05-29). The earlier proposal `bump-pi-compat-to-0-76` was drafted but never merged to…"
---

# How we did it: Bump the dashboard's pi compatibility floor to 0.78 — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore` skill) — a deliberate
*think-don't-implement* stance. The literal first prompt was the skill boilerplate
("Enter explore mode. Think deeply…"), but the real objective, which crystallized over
the next few steering turns, was: **decide whether and how to bump the dashboard's pinned
`@earendil-works/pi-coding-agent` floor past the stale 0.75 line, audit what changed
across 0.76→0.77→0.78, and capture the decision as OpenSpec proposals — without writing
any implementation code.** The end state was two scaffolded, validating OpenSpec changes
(a pin-bump + a follow-up streaming-behavior surfacing stub) committed to a fresh worktree.

## 2. TL;DR playbook

1. **Enter explore mode** (`openspec-explore`) so the AI *thinks and drafts specs* but
   refuses to implement — the right stance for a version-bump decision.
2. **Establish ground truth on the registry**: `npm view @earendil-works/pi-coding-agent
   version dist-tags versions time engines --json` to learn the latest version, the
   Node floor, and the publish dates.
3. **Create an isolated worktree** off `develop`: `git worktree add -b
   bump-pi-compat-to-0-78 .worktrees/bump-pi-compat-to-0-78 develop && npm install`.
4. **Audit the changelog delta** across the skipped minors: `npm pack …@0.78.0`, untar
   `CHANGELOG.md`, then `grep -niE 'breaking'` + an `awk` pass to extract every
   `### Breaking` block. Confirm the Node floor is unchanged.
5. **Trace the actual code path** for any surface the changelog touches (here
   `InputEvent.streamingBehavior`) — `rg` the bridge pass-through, server forwarding,
   and client reducer to learn whether it's a pin bump or a real protocol change.
6. **Mirror the prior proposal's structure** rather than inventing one: copy the
   `bump-pi-compat-to-0-76` change tree (`.openspec.yaml` / proposal / design / tasks /
   specs) and adjust version strings + the changelog-delta rows.
7. **Validate before committing**: `openspec validate <change>` on each change until both
   pass clean.
8. **Commit only the proposal artifacts** with a trailing `[ci skip]` — keep the
   `npm install` `package-lock.json` delta *out* of the commit.

## 3. How the collaboration unfolded

**Phase 1 — Ground truth (registry + worktree).** The AI queried npm for the live
version (0.78.0, published 2026-05-29), confirmed `engines.node` stayed `>=22.19.0`
across the window, and stood up an isolated `.worktrees/bump-pi-compat-to-0-78` worktree
off `develop` with a full `npm install` (1910 packages). *Why it worked:* isolating the
work in a worktree meant `npm install` and any scratch files never touched the live
checkout, and the registry query replaced guesswork with facts.

**Phase 2 — Changelog audit.** Instead of eyeballing release notes, the AI `npm pack`-ed
the 0.78.0 tarball, extracted just `CHANGELOG.md`, and ran a `grep`/`awk` pass to pull
every `### Breaking` section. Verdict: **no breaking changes** in the 0.76→0.78 window,
Node floor unchanged. It tabulated the additive deltas that touch the dashboard's surface
(`InputEvent.streamingBehavior`, `pi.getAllTools()` promptGuidelines, new exports,
SIGTERM `session_shutdown` ordering, RPC bash abort-on-disposal). *Why it worked:* pulling
the changelog straight from the published artifact is authoritative and cheap.

**Phase 3 — Supersession check.** A steering turn asked the AI to verify a claim ("it's
already in develop"). The AI checked and found `bump-pi-compat-to-0-76` was **never merged
to develop** — it lived only as an unshipped worktree. That reframed the whole change:
0.78 becomes the 0.75→0.78 jump that *supersedes* the abandoned 0.76 proposal in one PR.

**Phase 4 — Scope the streaming-behavior surface.** The human asked "what means
deterministic session names? surface new streamingBehavior." The AI traced the real code
path (`bridge.ts` pass-through → opaque server forwarding → client reducer rawEvent
fallback) and discovered the field **already flows through and renders** (buried in a JSON
card). That collapsed a feared protocol-wide change into three honest tiers (Min = zero
code, Small = reducer handler, larger = full UI). *Decision point:* rather than pick a
tier, capture it as a **stub** proposal with an open design question.

**Phase 5 — Scaffold + validate + commit.** The `openspec change new` CLI didn't exist,
so the AI mirrored the 0-76 change-tree layout by hand (`mkdir` + `write`), ran
`openspec validate` on both changes until clean, then committed only the 10 proposal files
with a trailing `[ci skip]` (matching the repo convention from commit `f9b92213`),
deliberately leaving the `package-lock.json` delta uncommitted.

## 4. Prompts that worked

- **The goal prompt (explore mode).** Launching via the `openspec-explore` skill was the
  high-leverage move: it framed the whole session as *capture-the-decision*, not
  *do-the-work*, so the AI produced proposals instead of code edits. If you want a
  reasoned version-bump artifact, **start in explore mode**.
- **"1. As I know it is already in develop. But check it. Its supersede it."** — a
  short steering turn that forced verification of an assumption. It unlocked the entire
  supersession framing (0.76 was never shipped). *Effective because* it told the AI to
  *check, not trust* — the resulting finding changed the proposal's "Why".
- **"surface new streamingBehaviour"** — a two-word scope addition that sent the AI to
  trace the actual code path and right-size the change.
- **"1. And add [ci skip] to avoid build"** — a precise final instruction that produced a
  correct, convention-matching commit in one shot.

*Rewrite of the terse steering turns* (`3`, `c`, `i`) — these were menu picks against
options the AI offered. A future operator can be explicit instead: e.g. "Draft the
pin-bump proposal by mirroring the 0-76 structure, and file the streamingBehavior work as
a separate stub with the design question left open."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust that the 0.76 proposal was already on develop | "check it. Its supersede it." | State up front: *verify merge/archive state before writing the "Why"* |
| Assume `streamingBehavior` needed a full protocol+reducer+UI change | "surface new streamingBehavior" (prompting a code-path trace) | Trace bridge→server→reducer *before* sizing any event-surface change |
| Mis-say "deterministic session **names**" | corrected the AI (it self-corrected to session **IDs**) | Distinguish `--session-id` (IDs) from deterministic naming explicitly |
| Reach for `openspec change new` (CLI verb doesn't exist) | fall back to mirroring the 0-76 tree by hand | Remember: scaffold OpenSpec changes by copying an existing change tree |
| Want to commit the whole worktree | "add [ci skip]" + keep lock-file out | Commit proposal artifacts only; exclude the `npm install` lock delta |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session. The reusable asset is the **`openspec-explore`
stance itself** plus a repeatable *version-bump audit* procedure. If this recurs (and it
does — see the chain 0-76 → 0-78), the workflow deserves a dedicated skill:

- **What it would capture:** the pin-bump audit loop — registry query → worktree →
  changelog `### Breaking` extraction → surface trace → mirror prior change tree →
  validate → `[ci skip]` commit.
- **Why it's effective:** it turns a fuzzy "should we upgrade?" into a mechanical,
  evidence-backed proposal, and it prevents the recurring failure of stacking unshipped
  bump proposals (0.76 was drafted-but-never-merged; 0.78 had to supersede it).
- **When to invoke:** every time pi publishes new minors past the current floor. (A
  `bump-pi-version` project skill already exists — this session's audit steps are exactly
  what belongs in it.)

## 7. Pitfalls & dead ends

- **`npm pack … --pack-destination` failed** (first attempt errored). *Fix:* `mkdir -p
  /tmp/pi078 && cd` into it and `npm pack` there, then `tar -xzf` just the files you need
  (`CHANGELOG.md`, `dist/**.d.ts`).
- **`openspec change new <name>` does not exist** as a CLI verb (the invocation failed).
  *Fix:* mirror an existing change tree — `mkdir -p openspec/changes/<name>/specs/<cap>`
  and hand-write `.openspec.yaml` / proposal / design / tasks / spec, then `openspec
  validate`.
- **Assuming a changelog "feature" means a code change.** `streamingBehavior` looked like
  a protocol change but the bridge's schema-blind pass-through already forwards it. *Lesson:*
  trace the real path before scoping.
- **The `package-lock.json` delta from `npm install` is noise** — keep it out of the
  proposal commit; the real pin bump will regenerate it anyway.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** clean `develop`, npm access to `@earendil-works/pi-coding-agent`,
the name of the last bump change to mirror (`bump-pi-compat-to-0-76`).

- [ ] `openspec-explore` mode on (think + draft, no implement).
- [ ] `npm view @earendil-works/pi-coding-agent version dist-tags versions time engines --json`.
- [ ] `git worktree add -b bump-pi-compat-to-<v> .worktrees/bump-pi-compat-to-<v> develop && npm install`.
- [ ] `npm pack …@<v>` → untar `CHANGELOG.md` → `grep -niE 'breaking'` + `awk` `### Breaking` extraction → confirm Node floor.
- [ ] Verify prior bump proposals' merge/archive state (supersession check).
- [ ] `rg`-trace any changelog surface (bridge → server → reducer) before scoping it.
- [ ] `mkdir` + `write` the change tree mirroring the prior one; `openspec validate <change>` until clean.
- [ ] Commit proposal artifacts only, trailing `[ci skip]`; leave `package-lock.json` out.

**Artifacts produced:** two OpenSpec change trees in
`.worktrees/bump-pi-compat-to-0-78/openspec/changes/` —
`bump-pi-compat-to-0-78/` (full: proposal, design, tasks, `specs/pi-core-version-check/spec.md`)
and `surface-input-streaming-behavior/` (stub: proposal, design with 1 open decision,
tasks, `specs/event-reducer/spec.md`) — committed as `e05d8b19` with `[ci skip]`.

---

_Generated from session `019e7986-b69b-796a-b81b-e60dcb755319` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-30. Source extract: session facts sheet (mktemp)._
