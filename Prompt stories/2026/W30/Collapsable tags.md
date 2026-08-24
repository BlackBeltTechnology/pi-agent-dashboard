---
session: 019f86ab
week: 2026/W30
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [sidebar-tag-collapse-and-delete]
proposal_excerpt: "The sidebar `YOUR TAGS` filter group renders every user tag as an always-visible, wrapping chip row. As tag count grows the group eats vertical sidebar height, and there is no way to delete a tag that is no longer wan…"
---

# How we did it: Planning a collapsible + deletable sidebar-tag change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`): _"Enter explore mode. Think
deeply. Visualize freely."_ — a thinking stance, not an implementation task. The *real*
objective, which crystallized over the steering turns, was: **plan an OpenSpec change for
the dashboard sidebar's `YOUR TAGS` area** so it (a) collapses to reclaim vertical height,
(b) caps overflow with a `+N more` expander, and (c) lets a user destructively delete a tag
globally — then carry that plan all the way through review, scenario design, and commit to
`develop`, stopping cleanly at the git-worktree boundary. No application code was to be
written; the deliverable was a complete, apply-ready set of OpenSpec artifacts.

## 2. TL;DR playbook

1. **Ground before theorizing.** In explore mode, `grep`/`kb_search` the real component
   (`TagFilterGroup`, `allTagsInUse`, `TagEditor`) and trace the backend path
   (`set_session_tags`) *before* diagramming any design.
2. **Surface the interpretation forks explicitly** — don't silently pick. (Here: client
   fan-out vs. a new `remove_tag_globally` bulk verb.) Let the human choose.
3. **Scaffold the change:** `openspec new change "sidebar-tag-collapse-and-delete"`, then
   write `proposal.md` modifying the existing `session-tags` capability.
4. **Build a *grounded* interactive mockup** — real theme tokens (`index.css`), real palette
   hash (`fnv1a32` + `TAG_PALETTE`), both themes — then `serve_mockup` and verify all
   behaviors live in-browser.
5. **Write the UX review** (`ux-review.md`) scored against a cited rubric.
6. **Fast-forward the remaining artifacts** (`openspec-ff-change`): `design.md`, delta
   `specs/`, `tasks.md` — using ADDED requirements to dodge the MODIFIED partial-content pitfall.
7. **Run `plan-proposal`:** doubt-review (2 cross-model cycles) → verify load-bearing findings
   against source → scenario-design → fold automated scenarios into `tasks.md`.
8. **Commit to `develop` and STOP** at the worktree boundary. Do not sweep unrelated
   untracked files into the commit.

## 3. How the collaboration unfolded

**Phase A — Discovery / grounding (explore mode).** The AI refused to theorize first: it
grepped the client for `YOUR TAGS`/`TagFilterGroup`, read `SessionList.tsx`, and traced the
server path for `set_session_tags` through `session-meta-handler.ts` and `browser-gateway.ts`.
_Why it worked:_ the "backend reality" (there is **no bulk verb** today; `set_session_tags`
is per-session only) is the single fact that shapes the entire design — discovering it early
turned a vague "delete everywhere" into two concrete, costed options.

**Phase B — Surface the forks.** Rather than choosing, the AI laid out **(i) client fan-out**
(N messages, reuses existing path) vs **(ii) a new `remove_tag_globally` bulk verb** (new
protocol + handler, 1 round trip) and let the human pick. The human's follow-ups implicitly
selected the server-side atomic verb.

**Phase C — Scaffold + mockup + UX review.** `openspec new change`, then `proposal.md`. The
mockup was deliberately **grounded in real tokens and the real palette hash**, served live
(`serve_mockup`), and every behavior exercised in-browser via `agent-browser` (the Playwright
scorer wasn't installed — the AI fell back gracefully). Both light + dark themes verified.

**Phase D — The steering pivot.** The human said _"The whole tag area be collapseble.
Default collapsed."_ The AI **rewrote the mockup to one master `Tags` fold** and — critically
— kept the proposal coherent with the new decision, adding a **discoverable count on the
collapsed header** (`13 tags · 3 phases`) so folded tags still satisfy NN/g visibility-of-
system-status.

**Phase E — Fast-forward artifacts.** `openspec-ff-change` drove `design.md` (7 decisions),
the delta spec (4 ADDED requirements / 14 scenarios), and `tasks.md` (9 TDD-ordered groups).

**Phase F — plan-proposal: review + scenario fold + commit.** Two cross-model doubt cycles
(`@propose-review-1` glm-5.2 → `@propose-review-2` deepseek). The AI **verified the load-
bearing findings against source** before acting, folded the automated scenarios into
`tasks.md` one-to-one, committed to `develop` (`dfb55543f`), and stopped at the worktree
boundary — leaving unrelated untracked files alone.

## 4. Prompts that worked

- **The goal prompt** — invoking the `openspec-explore` skill established a *thinking, not
  implementing* stance up front. This is what kept the AI grounding-and-diagramming instead
  of prematurely editing code. A strong kickoff for planning work.
- **High-leverage follow-up:** _"The whole tag area be collapseble. Default collapsed. Run
  mock server."_ — three decisions in one line (scope: whole area; default state: collapsed;
  action: serve it). Short, unambiguous, immediately actionable.
- **Skill-chaining prompts:** invoking `openspec-ff-change` then `plan-proposal` moved the
  work from "captured thinking" → "apply-ready + reviewed + committed" with almost no prose —
  the skills carry the procedure.
- **`"commit"`** — a one-word close once the plan-proposal loop had converged.

_Rewrite of the terse mid-session `"seems ok"`:_ prefer **"Approved — stop the mock server
and continue to design.md + specs"** so the AI doesn't have to guess whether to advance
artifacts.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Mock per-group folds (each of YOUR TAGS + PHASE independently collapsible) | "The whole tag area be collapseble. Default collapsed." | State the collapse granularity + default state in the proposal ask up front |
| Stop after proposal + mockup (explore mode won't advance artifacts unprompted) | Invoking `openspec-ff-change` to fast-forward design/specs/tasks | Say "explore, then FF to apply-ready" if you want the full artifact set in one go |
| Treat a cross-model reviewer's "unimplemented!" flags as real | Verifying that cycle-2 findings were **noise** (a plan read as a finished diff) | Tell reviewers up front "this is a planning artifact, not a diff" to cut the noise |
| Potentially over-commit | "commit" only after convergence; the AI left unrelated untracked files alone | Trust the surgical-changes rule; name exactly which paths to stage |

The decisive quality bar the human imposed was **default-collapsed with a discoverable
count** — the AI honored visibility-of-system-status rather than hiding tags outright.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were *created* this session — instead it's a **masterclass in
composing existing skills** into a planning pipeline:

- **`openspec-explore`** → establishes the no-code thinking stance and grounds design in real
  source before any artifact exists. Invoke when the shape of a change is still uncertain.
- **`serve_mockup` + `agent-browser`** → a *grounded* interactive mockup (real tokens, real
  palette hash) verified live in both themes. Effective because it turns "does this look
  right?" into a checkable in-browser demo before a line of production code is written.
- **`openspec-ff-change`** → drives design → specs → tasks in one pass; use ADDED requirements
  for additive behavior to avoid the MODIFIED partial-content pitfall.
- **`plan-proposal`** → the review+scenario+commit orchestrator: doubt-review (cross-model,
  auto-runs when a `@propose-review-N` role series is configured), source-verification of
  load-bearing findings, scenario-design fold into `tasks.md`, commit, **stop at the
  worktree boundary**.

_Recommended memory to save:_ "For dashboard sidebar tag work, `set_session_tags` is
per-session only — a global delete needs either client fan-out or a new `remove_tag_globally`
bulk verb wired into `browser-gateway.ts` (an unwired verb hits `default:` →
`handlePiGatewayForward` and is misrouted to a pi bridge)."

## 7. Pitfalls & dead ends

- **Playwright scorer not installed** → `score_mockup` failed. **Fix:** fall back to
  `agent-browser` to capture the mockup at breakpoints for the visual review.
- **Unwired bulk verb misroutes.** A new `remove_tag_globally` that isn't given a switch case
  falls through to `default:` → `handlePiGatewayForward` and is forwarded to a pi bridge
  (confirmed at `browser-gateway.ts:843`). Wiring the switch case is load-bearing — call it
  out in `design.md` and `tasks.md`.
- **Cross-model review noise.** Cycle-2 reviewer flagged the *planned-but-unbuilt* features
  as "unimplemented." That's a plan being read as a finished diff — classify as noise, don't
  chase it. Only one cycle-2 finding was real: `normalizeTags([tag])[0]` returns `undefined`
  on blank/whitespace input → add an empty-guard no-op.
- **MODIFIED partial-content pitfall.** For additive behavior, write **ADDED** requirements in
  the delta spec rather than MODIFIED — avoids fragile partial-content matching.
- **Don't over-commit.** Two unrelated untracked paths existed
  (`fix-markdown-preview-relative-images/`, `_render_ri.mts`) — the AI left them alone per
  the surgical-changes rule.

## 8. Reproduce it faster — checklist

- [ ] Enter `openspec-explore`; **ground first** — grep the real components + trace the
      backend verb before designing.
- [ ] Surface the design forks explicitly; let the human choose the transport.
- [ ] `openspec new change "<kebab-name>"`; write `proposal.md` modifying the existing capability.
- [ ] Build a **grounded** mockup (real tokens + palette hash), `serve_mockup`, verify every
      behavior live in both themes; write scored `ux-review.md`.
- [ ] State collapse granularity + default state up front (here: **whole area, default
      collapsed, discoverable count**).
- [ ] `openspec-ff-change` → `design.md` + delta `specs/` (ADDED) + `tasks.md`.
- [ ] `plan-proposal`: doubt-review (verify load-bearing findings vs source) → scenario-design
      fold → commit to `develop` → **stop at the worktree boundary**.

**Key inputs to have ready:** a configured `@propose-review-N` role series (enables auto
cross-model doubt-review); `agent-browser` available as a Playwright-scorer fallback.

**Final artifacts produced** (all under
`openspec/changes/sidebar-tag-collapse-and-delete/`): `proposal.md`, `design.md`,
`specs/session-tags/spec.md`, `tasks.md`, `test-plan.md`, `mockups/index.html`,
`mockups/ux-review.md` — committed to `develop` at `dfb55543f`.

---

_Generated from session `019f86ab-f072-7e1b-926a-b0e8f3ad18db` · `pi-agent-dashboard` · 2026-07-22. Source extract: deterministic facts sheet (session-to-guideline)._
