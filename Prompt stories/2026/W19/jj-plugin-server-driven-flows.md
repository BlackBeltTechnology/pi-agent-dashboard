---
session: 019df056
week: 2026/W19
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [jj-plugin-server-driven-flows]
---

# How we did it: Reconciling a self-contradictory OpenSpec proposal before implementation — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with one line:

> `proposal: jj-plugin-server-driven-flows. Is there anything to clarify?`

The real objective was **not** "start coding." It was a pre-implementation
*coherence audit*: read an existing OpenSpec change (proposal.md + design.md +
tasks.md), find every place the three artifacts disagree with each other or with
the actual codebase, surface the ambiguities as decision-forcing questions, then —
once the human ruled — fold the rulings back into all three files so they validate
and match reality. The finished artifact is a self-consistent, code-grounded spec
ready to hand to an implementer.

## 2. TL;DR playbook

1. Point the AI at the change dir and ask the neutral question: *"Is there anything
   to clarify?"* — do **not** ask it to implement yet.
2. Let it skim all three artifacts (`proposal.md`, `design.md`, `tasks.md`) and
   return a short list of **concrete contradictions**, each phrased as a binary
   choice, not open-ended musing.
3. Reply with **terse per-item directives** — one line per ambiguity
   (`1. Check what's better and why`, `4. name only`, `5. investigate`).
4. Make the AI **ground every answer in code** (`grep`/`cat` the real files, cite
   line numbers and stub comments) before it recommends a direction.
5. Approve the grounded recommendations in one word (`yes`).
6. Have it apply edits to **all three artifacts together** so they stay in sync, and
   run `npx openspec validate <change>` as the gate.
7. Stop when validate passes and the AI reports a per-file change summary.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the change, find the seams).** The AI listed the change
dir, then read proposal/design/tasks and returned three *real* ambiguities: (1) a
**routes-location conflict** — task 1.1 wanted routes in the plugin package while
1.7/1.11 + "Code touched" said keep them in core server; (2) a **progress-transport
contradiction** — Decision 3 said PromptBus follow-up prompts, Decision 5 + section
2 said WS events to a mounted dialog; (3) a **respawn `strategy` argument** mismatch
vs. the `headless-reload-via-respawn` precedent. *Why it worked:* it treated the
three files as a system and reported disagreements as binary choices, not vague
concerns.

**Phase 2 — Steering (the human rules, tersely).** The human answered with a compact
6-line directive — one instruction per open item (`1. Check what is better and why`,
`2. Investigate why the contradiction`, `4. name only`, `5. investigate, maybe
related to 2`). This is the pivotal turn: instead of picking answers, the human told
the AI *how to decide each one* (investigate vs. just-name).

**Phase 3 — Grounded investigation.** The AI ran ~11 `grep`/`cat`/`ls` probes across
`packages/server/src/routes/jj-routes.ts`, `pi-gateway.ts`,
`session-action-handler.ts`, `headless-pid-registry.ts`, the `jj-plugin` stub, and
the PromptBus / prompt-component-registry files. It found the decisive evidence: the
route implementation **already exists** in core server (registered from
`server.ts:714`), the plugin's `src/server/index.ts` is a 25-line stub with `//
Phase 5 will register routes here`, and the route closes over dashboard-internal
singletons (`browserGateway`, `pendingAttachRegistry`, `networkGuard`,
`headlessPidRegistry`) that `ServerPluginContext` doesn't expose. *Decision point:*
routes **stay in core server** — the rule of thumb it derived is "a route belongs in
a plugin only when it can run on `ServerPluginContext` alone; this one can't." It
similarly concluded PromptBus is bridge-only (no client/server origin path) so
progress must use **client-local dialogs + WS events**, and respawn must hardcode
`strategy: "headless"` gated on a new `SESSION_NOT_HEADLESS` precondition.

**Phase 4 — Fold-back + validate.** On the human's `yes`, the AI edited all three
artifacts in lockstep (dialog substrate, headless precondition, `correlationId` →
`jobId`, enum additions, task redirects) and ran `npx openspec validate
jj-plugin-server-driven-flows` — which passed. It closed with a per-file summary of
exactly what changed.

## 4. Prompts that worked

- **The goal prompt** — `proposal: <change>. Is there anything to clarify?` This is a
  strong kickoff *because it withholds permission to implement.* It frames the task
  as an audit and invites the AI to surface gaps rather than paper over them. Reuse
  verbatim for any pre-implementation spec review.
- **High-leverage follow-up — the per-item directive block.** A numbered list mapping
  1:1 onto the AI's ambiguities, each with a verb telling it *how* to resolve that
  item (`check what's better and why` / `name only` / `investigate`). Tiny to type,
  it dispatched six decisions at once and set the depth for each.
- **`yes`** — the one-word approval that authorized the lockstep fold-back once the
  recommendations were code-grounded.

Weak-prompt rewrite: instead of a bare `investigate` for item 5, a stronger version
states the hypothesis to test — *"item 5 is probably the same root cause as item 2
(PromptBus origin); confirm or refute with the bus source."* — which is exactly the
link the AI ended up making on its own.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Offer to just answer ambiguities from the text | `Check what is better solution and why` / `Investigate` | Say "ground every recommendation in the actual code (grep/cat, cite lines)" in the goal prompt |
| Treat two contradictions as independent | `Investigate, maybe related to 2` | Ask it to look for a **shared root cause** across contradictions before resolving each |
| Risk over-scoping (move routes into the plugin SDK) | `4. name only` (bound the depth per item) | Give an explicit per-item depth: *name-only* vs. *full investigation* |
| Edit one artifact and drift the others | (implicit) fold-back to all three + validate | Require `openspec validate` as the pass/fail gate after every fold-back |

The controlling quality bar the human imposed: **decisions must be justified by
codebase evidence, not spec prose**, and the depth of investigation is set
per-question — some items only need a name, others need a full grep trail.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session. But the workflow is clearly
repeatable and deserves one. Recommended skill: **`reconcile-openspec-artifacts`** —

- **What it would capture:** read all three change artifacts, diff their claims
  against each other and against the codebase, emit contradictions as binary
  decision questions, then (on approval) fold rulings into all three and gate on
  `openspec validate`.
- **Why it's effective:** it removes the manual cross-referencing of proposal ⇄
  design ⇄ tasks and forces every ruling to cite code, catching stub-vs-real drift
  (like the never-moved Phase-5 routes) that pure spec-reading misses.
- **When to invoke:** any time an OpenSpec change was authored across multiple
  sessions/authors and you suspect the three files have diverged, *before*
  implementation starts.

This repo already ships `doubt-driven-review` and `openspec-verify-change`; the new
skill would sit upstream of them, at the "is the spec internally consistent" stage.

## 7. Pitfalls & dead ends

- **Don't trust spec prose over code.** The proposal's task 1.1 confidently named a
  plugin-package route file that was only a 25-line stub. Reading the spec alone
  would have sent the implementer down the wrong path; the `grep`/`cat` probes are
  what caught it.
- **Watch for singleton coupling when "moving to a plugin."** Routes that close over
  `browserGateway` / `pendingAttachRegistry` / `networkGuard` / `headlessPidRegistry`
  can't run on `ServerPluginContext` (only `{ logger, config }`). If a probe shows
  that coupling, the "move it into the plugin" instinct is scope-creep — leave it.
- **PromptBus is bridge-only.** It has no client- or server-origin path, so it can't
  carry server→dialog progress. Reaching for it for UI progress is a dead end; use
  client-local dialogs + WS events instead.
- **Edit artifacts in lockstep.** Changing `correlationId` → `jobId` (or any shared
  identifier) in one file and not the others silently reintroduces contradictions —
  always fold back to all three and re-run validate.

## 8. Reproduce it faster — checklist

- [ ] Have the change dir ready: `openspec/changes/<change>/{proposal,design,tasks}.md`.
- [ ] Kick off with: `proposal: <change>. Is there anything to clarify?`
- [ ] Receive a list of binary contradictions; reply with a per-item directive block
      (`N. <verb: check/investigate/name only>`), telling it the depth for each.
- [ ] Insist every ruling is code-grounded (`grep`/`cat`, cite files + lines + stub
      comments). Ask it to look for a shared root cause across related items.
- [ ] Approve with `yes`.
- [ ] Fold rulings into **all three** artifacts together.
- [ ] Gate: `npx openspec validate <change>` must pass.
- [ ] Confirm a per-file change summary before handing to an implementer.

Final artifacts produced (paths):
`openspec/changes/jj-plugin-server-driven-flows/proposal.md`,
`.../design.md`, `.../tasks.md` — all three edited and validating.

---

_Generated from session `019df056` · `pi-agent-dashboard` · 2026-05-04. Source extract: `/tmp/facts (session-to-guideline extract)`._
