---
session: 019df059
week: 2026/W19
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [inject-session-context-into-agent]
proposal_excerpt: "Today the dashboard's \"attach proposal\" feature is purely server/UI metadata: `session.attachedProposal` drives the chip, the artifact letters, and auto-rename, but the pi agent running inside the session is never tol…"
---

# How we did it: locking the design for injecting session context into the pi agent — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with `proposal: inject-session-context-into-agent Is there anything to clarify?`
— i.e. *before writing any code, pin down every ambiguity in an existing OpenSpec proposal so
implementation can proceed without guesswork.* The proposal's intent: the dashboard already
tracks `session.attachedProposal` for UI (chip, artifact letters, auto-rename), but the pi
agent **inside** the session never learns its own session id, cwd, or attached OpenSpec change.
The real objective that emerged through steering was narrow and precise: **decide exactly how
and where to splice a "session context" fragment into pi's system prompt** — the wording, the
anchor point, and the caching consequences — and record those decisions in `design.md` +
`tasks.md`. This was a **planning/design-lock session, not an implementation session.**

## 2. TL;DR playbook

1. Kick off with the proposal name + "is there anything to clarify?" — force the AI to
   surface ambiguities *before* it writes code.
2. Have the AI read `proposal.md` / `design.md` / `tasks.md` and emit a **numbered list of
   genuine ambiguities**, each with a concrete proposed default (not open-ended questions).
3. Answer the list tersely by number (`1. put before the model name … 6. mirror`) — one line
   resolves many open decisions at once.
4. When a placement decision is fuzzy ("left to model"), make the AI **enumerate the literal
   readings (A vs B)** rather than guess which you meant.
5. Force **verification against the real artifact**: don't let the AI splice against an
   *assumed* system-prompt format — make it grep the installed pi `dist/core/system-prompt.js`
   to see what the SP actually contains.
6. Once reality is known (pi's SP has **no model-name line**), have the AI re-enumerate the
   now-valid options (B1/B2/B3) and pick one by label (`B3`).
7. Ask the second-order question the spec forgot: **"how does this affect Anthropic context
   caching?"** — make the AI trace the provider's `cache_control` behavior and record the
   verdict.
8. Confirm (`ok`) and let the AI write the locked decisions into `design.md` + `tasks.md`.

## 3. How the collaboration unfolded

**Phase A — Clarify (read → enumerate ambiguities).** The AI read the three OpenSpec artifacts
and returned a numbered list of *real* ambiguities: exact SP fragment wording, the inbound
dispatch site (`bridge.ts` vs a new module), the `cwd` source (`event.systemPromptOptions?.cwd
?? pi.cwd ?? process.cwd()`), replay scope, headless default, and test-harness mirroring. Each
came with a proposed default. *Why it worked:* proposing defaults turns a slow Q&A into a fast
"ack/tweak" pass — the operator resolved six items with `1. put before the model name / 2. ok /
… / 6. mirror`.

**Phase B — Disambiguate placement (A vs B).** The instruction "put before the model name" was
ambiguous. The AI refused to silently pick and instead spelled out two literal readings: **(A)**
prepend the whole fragment to `event.systemPrompt`; **(B)** splice the id/cwd line right before
pi's model-name line via a string marker. The operator chose **B** — the fragile one.

**Phase C — Verify against reality (the pivotal move).** Rather than implement the fragile splice
on faith, the AI flagged that B depends on pi's internal SP format and went to check. It grepped
the installed pi `dist/core/system-prompt.js` and discovered **pi's SP has no model-name line at
all** — it opens with `You are an expert coding assistant operating inside pi…` and ends with
`Current date: <date>\nCurrent working directory: <cwd>`. B *as stated had no target.* The AI
re-derived the valid anchors — **B1** (after the opening line), **B2** (before `Current date:`),
**B3** (replace the trailing `Current working directory:` line, no cwd duplication) — and the
operator picked **B3**.

**Phase D — Second-order check (caching).** The operator asked "How does this affect context
caching in Anthropic?" The AI grepped pi-ai's Anthropic provider for `cache_control` and
confirmed: pi sends the whole SP as one `ephemeral` block with a single trailing cache
breakpoint. Because B3 keeps the fragment at the very end with session-stable values
(`sessionId`, `cwd`), the SP stays byte-identical turn-to-turn → **cache hits exactly as today**;
only attach/detach or the daily date rollover costs one miss. Verdict recorded under Risks /
Trade-offs.

**Phase E — Lock.** Decisions written into `design.md` and `tasks.md`, including a new repo-lint
task (4.6) that probes the installed pi for the anchor and skips if unresolvable.

## 4. Prompts that worked

- **Goal prompt** — `proposal: <name> Is there anything to clarify?` — excellent kickoff for a
  design-lock session: it scopes the AI to *questioning*, not *building*, and yields a
  decision checklist you can burn down.
- **`1. … 2. ok … 6. mirror`** — high-leverage batch answer: one terse line resolves an entire
  ambiguity list because the AI had proposed numbered defaults. Reuse this pattern: make the AI
  number its questions so you can answer by index.
- **`B` / `B3`** — label-selection follow-ups. Because the AI enumerated labeled options, a
  single letter locked a decision. Cheap and unambiguous.
- **`How does this affect context caching in Anthropic?`** — the best prompt of the session: a
  second-order question the spec omitted, forcing a provider-level verification that de-risked
  the whole design.
- Weak prompt to rewrite: `The sessionn id, cwd blaced left to model` (typo-ridden, ambiguous)
  → **stronger:** *"Splice only the sessionId+cwd line immediately before pi's model/system
  block — confirm pi's SP actually has such a marker first."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Lock a placement (A: prepend whole fragment) based on the first reading | Redirect to a different placement ("before the model name", then "left to model") | State the anchor point explicitly up front: "splice at/replace `<marker>`, verify it exists" |
| Plan a string-splice against an **assumed** SP format | (AI self-corrected) — but the operator's "B" pushed it toward a fragile splice that only reality-checking saved | Always require "grep the installed artifact before anchoring on its format" as a rule |
| Treat the design as done after wording+placement | Ask the omitted second-order question (caching) | Add "trace caching / cache_control impact" to the design checklist for any SP mutation |
| Offer only 2 options (A/B) when B was under-specified | (AI re-enumerated B1/B2/B3 after verification) | Ask for labeled, exhaustive options once the true constraints are known |

Key guardrail: **the fragile choice (B) was only rescued because the AI verified pi's real SP
before implementing.** Never let a marker-based splice be locked without confirming the marker
exists in the installed dependency.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created in this session — it was a focused design-lock. But the workflow
is clearly repeatable and *should* be captured as a skill:

- **Proposed skill: `design-lock-openspec-change`** — reads an OpenSpec change's
  proposal/design/tasks, emits numbered ambiguities with proposed defaults, forces
  verification of any external-format assumptions (grep the installed dependency), and writes
  the resolved decisions back into `design.md` + `tasks.md`. *Why effective:* it removes the
  slow round-trips of unstructured clarification and prevents the classic failure of
  anchoring a splice against an imagined format.
- **Reusable move worth memorizing:** for any change that mutates a system prompt, **always
  trace `cache_control` in the provider** and record the caching verdict in Risks / Trade-offs.

## 7. Pitfalls & dead ends

- **Splicing against a model-name line that doesn't exist.** The operator's "before the model
  name" intent had **no target** — pi's SP contains no model name. If you hit this: grep
  `dist/core/system-prompt.js` in the installed pi to see the real opening/closing lines, then
  anchor on `Current working directory:` (option B3) instead.
- **Fragile marker splices.** Any anchor into a dependency's internal SP format is version-
  brittle. Mitigate exactly as this session did: add a repo-lint task that probes the installed
  pi for the anchor and **skips gracefully if unresolvable**, plus a fallback (append on miss).
- **Forgetting caching.** Mutating the SP tail can silently break Anthropic prompt-cache hits.
  Verified-safe here only because B3 keeps values session-stable; a fragment with per-turn
  volatile data would have caused a cache miss every turn.

## 8. Reproduce it faster — checklist

- [ ] Open with `proposal: <name> Is there anything to clarify?` to scope the AI to questioning.
- [ ] Make the AI read proposal/design/tasks and **number** every ambiguity with a proposed default.
- [ ] Answer by index in one terse line (`1. … 6. mirror`).
- [ ] For any placement/format decision, demand **labeled, literal options** (A/B/B1/B2/B3).
- [ ] Force a grep of the **installed dependency's real artifact** before anchoring any splice
      (`grep -n … dist/core/system-prompt.js`).
- [ ] Ask the second-order question the spec omits — here, **Anthropic `cache_control` impact**.
- [ ] Have the AI write the locked decisions + a graceful-fallback lint task into `design.md`
      and `tasks.md`.

**Inputs to have ready:** the OpenSpec change dir (`openspec/changes/<name>/`), read access to
the installed pi (`.../pi-coding-agent/dist/…`).
**Artifacts produced:** `openspec/changes/inject-session-context-into-agent/design.md`,
`openspec/changes/inject-session-context-into-agent/tasks.md` (decisions locked: B3 placement,
exact fragment wording, caching verdict, repo-lint task 4.6).

---

_Generated from session `019df059` · `pi-agent-dashboard` · 2026-05-04. Source extract: session facts sheet (mktemp)._
