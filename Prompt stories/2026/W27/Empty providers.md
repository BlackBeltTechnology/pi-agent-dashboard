---
session: 019f3494
week: 2026/W28
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [surface-model-introspection-to-agents]
proposal_excerpt: "Agents inside a pi session repeatedly need to answer \"which models can I actually reach, and with what capabilities?\" — for cross-model review (pick a non-Anthropic reviewer), vision routing (needs `input: [image]`),…"
---

# How we did it: Surfacing model introspection to agents — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a thinking stance, not an
implementation task. The trigger was a screenshot: an agent was trying to find a
non-Anthropic reviewer model by shell-parsing `~/.pi/agent/providers.json` with a
fragile Python one-liner (`d.get('providers')`) — and getting nothing back. The plain
first prompt was just the explore-mode preamble; the **real objective** emerged through
steering: *figure out why an agent can't reliably discover which models it can actually
reach, decide whether that's a recurring need worth an artifact, and — if so — capture
a proposal plus concrete guidance so no agent ever hand-rolls that broken parse again.*

## 2. TL;DR playbook

1. **Ground before theorizing.** `grep` the server/extension source for the real
   introspection surfaces (`modelRegistry`, `/api/models`, `provider-auth/status`)
   before proposing anything.
2. **Find the wrong assumption first.** Confirm `providers.json` holds only
   `roles`/`rolePresets`/`activePreset` — **no model inventory** — which is exactly why
   the one-liner failed silently.
3. **Map what already exists** across all layers: pi built-ins, `models.json`,
   `auth.json`, `InternalRegistry.getAvailable()/getAllAnnotated()`, and the REST
   endpoints `/v1/models` + `/api/provider-auth/status`.
4. **Verify live, don't trust the design.** Hit the running dashboard: discover
   `/v1/models` is **401-gated** (proxy Bearer key) and `/api/provider-auth/status` is
   open but **providers-only**. Mint a temp key → prove the catalogue → revoke it (204).
5. **Run the coherence check** against archived changes before scaffolding (catch
   duplicates). Confirm additive, then create the `openspec/changes/<name>/` artifacts
   by hand (no `change new` scaffold command exists).
6. **Validate `--strict`** and fix delta format (`## ADDED Requirements` headers).
7. **Curate reviewer guidance as families, not a frozen allowlist** — substrings
   fuzzy-matched against the *live* accessible set, symmetric across authors.
8. **Commit only your own files** — inspect `git status` and stage explicitly.

## 3. How the collaboration unfolded

**Discovery → correct the mental model.** The AI resisted theorizing and immediately
grounded in source. The decisive finding: the agent's mental model was *wrong* —
`providers.json` has no `providers` dict at all. The fragile parse wasn't missing a
capability; it was knocking on the **wrong door**. This reframing drove the entire rest
of the session.

**Gather → map the real landscape.** Prompted to look beyond review ("Check the current
pi-dashboard shipped skills too… Check other pi tools how to introspect models?"), the
AI widened the search and found the introspection machinery *already exists* in three
mature layers: the `InternalRegistry`, the OpenAI-compatible `/v1/models`, and
`/api/provider-auth/status`. The question flipped from "build it" to "why can't agents
*reach* it."

**Verify → live-probe ground truth.** On "verify", the AI hit the running dashboard
instead of trusting its own design. This changed the picture: `/v1/models` returns 401
without a proxy Bearer key; `/api/provider-auth/status` is open but providers-only. It
then minted a temporary proxy key, proved `/v1/models` returns 38 reachability-filtered
models with rich `x-pi` metadata (contextWindow, cost, `input:[text,image]`), and
revoked the key cleanly (HTTP 204). Ground truth, not assumption.

**Generate → capture the proposal.** On "capture", the AI ran the pre-scaffold
coherence check (nearest archived work: `add-dashboard-model-proxy`,
`filter-oauth-incompatible-models` — neither adds an *ungated* agent-facing catalogue),
then scaffolded `surface-model-introspection-to-agents/` (proposal, design, tasks, spec
delta) and passed `openspec validate --strict` after fixing the `## ADDED Requirements`
delta format.

**Refine → make the reviewer guidance concrete and portable.** Two late steering turns
sharpened the `doubt-driven-review` skill: add concrete model *families* good for
validation, and require picking only from the *accessible* set. The AI added a
"Choosing the reviewer model — from the accessible set" block using family substrings
(fuzzy-matched to the live list), then — after "anthropic is missing" — generalized the
rule to *symmetric* selection: identify the author's family, pick any other.

**Ship → commit only your work.** On "commit", the AI noticed unrelated pre-existing
dirty files, staged only its own 5 files (+187), and committed `3afd66794`.

## 4. Prompts that worked

- **Goal (explore-mode preamble).** Effective because the *stance* — "think, don't
  implement" — kept the AI grounding in source and mapping reality before proposing.
  A stronger explicit kickoff: *"An agent failed to find a non-Anthropic reviewer by
  parsing providers.json. Ground in the real pi/dashboard introspection surfaces, tell
  me why it failed, and whether this is worth a proposal."*
- **`this recurring`** — a two-word high-leverage turn. It changed the calculus from a
  one-off recipe to a durable *artifact*, which is what unlocked the whole proposal.
- **`Check the current pi-dashboard shipped skills too… Check other pi tools how to
  introspect models?`** — broadened scope and surfaced that the machinery already
  existed, flipping the whole framing.
- **`verify`** — the single most valuable word. It forced live-probing that corrected
  the design (401 gate, providers-only endpoint) before anything was written down.
- **`capture`** — clean unlock to turn verified findings into OpenSpec artifacts.
- **`The doubt review be updated what models is good for validation… models be used
  which is active? Means accessible.`** — rough phrasing, but it precisely demanded
  concrete names + an accessibility-first rule. Stronger version: *"In doubt-driven-
  review, add concrete reviewer model families and require selecting only from the
  live accessible/reachable set."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Frame the fix as a one-off recipe | "this recurring" | Ask "is this recurring?" up front — recurring ⇒ artifact, not steps |
| Scope narrowly to the review use case | "Not only for review… check shipped skills / other pi tools" | State the full surface to survey (skills + extension API + RPC + REST) in the kickoff |
| Trust its own design of the endpoints | "verify" | Always live-probe running surfaces before writing a proposal; mint→prove→revoke |
| Give abstract "different-architecture" advice with zero names | "add names (without provider)" | Ship concrete family substrings, fuzzy-matched to the live list |
| Recommend only from what pi *knows* | "models which is active? Means accessible" | Require enumerating the *accessible/reachable* set first, then pick |
| Assume the author is always Claude → drop Anthropic | "anthropic is missing" | Make selection symmetric: identify author family, exclude only that |
| — | "commit" (with unrelated dirty files present) | Inspect `git status`, stage only your own files explicitly |

## 6. Skills, tools & memory created — and why they're effective

- **OpenSpec change `surface-model-introspection-to-agents`** (proposal + design +
  tasks + spec delta). Captures the reusable problem: agents reinvent — badly — an
  endpoint that already returns typed, reachability-filtered, cost-and-modality-
  annotated truth. Proposes one small **ungated `GET /api/models`** (reuses the
  registry; `?annotated=1` surfaces `excludedReason`) plus a **`dashboard-list-models`**
  skill command. Effective because it converts a silent-failure footgun into a typed,
  discoverable surface. Invoke when implementing agent-facing model discovery.
- **`doubt-driven-review` skill update** — adds accessible-set enumeration + symmetric
  reviewer-family selection. Effective because it removes the guessing that started the
  session: the agent picks a real, reachable, different-family reviewer instead of
  hand-parsing config. Families are substrings (robust to version churn like
  `gpt-5.4→5.5`), not a frozen allowlist that goes stale. Invoke on any cross-model
  escalation / adversarial review.

## 7. Pitfalls & dead ends

- **Don't parse `providers.json` for models** — it holds only roles/presets; there is
  no `providers` dict. `d.get('providers')` returns empty and fails silently. Ask pi
  (`pi --list-models`) or the registry/REST surface instead.
- **`/v1/models` is 401-gated** behind a proxy Bearer key (built for external
  OpenAI-compatible clients). It is *not* freely agent-reachable — that gap is the
  whole point of the proposal.
- **`/api/provider-auth/status` is providers-only** — reachability per *provider*, not
  the model catalogue. Useful, but not a substitute for a model list.
- **No `openspec change new` scaffold command** — create the `changes/<name>/`
  directory and files manually, matching an existing proposal's format.
- **Spec delta needs `## ADDED Requirements` headers** — first `--strict` validate
  failed on missing delta headers; add them and re-validate.
- **Minting a proxy key returns a wrapped `data` field** — the first field guess was
  empty; read the real response shape, then use and revoke (204) cleanly.
- **Watch for unrelated dirty files at commit** — stage only your own work.

## 8. Reproduce it faster — checklist

- [ ] `grep` server/extension source for `modelRegistry` / `/api/models` /
      `provider-auth/status` before proposing.
- [ ] Confirm `providers.json` has no model inventory (roles/presets only).
- [ ] Map the layers: pi built-ins, `models.json`, `auth.json`, `InternalRegistry`,
      REST endpoints.
- [ ] Live-probe the running dashboard; note the 401 gate + providers-only gap
      (mint→prove→revoke a temp proxy key if needed).
- [ ] Run the pre-scaffold coherence check against archived changes.
- [ ] Scaffold `openspec/changes/surface-model-introspection-to-agents/` by hand;
      `openspec validate --strict`; fix `## ADDED Requirements` delta headers.
- [ ] Curate reviewer families as substrings; make selection symmetric across authors.
- [ ] `git status` → stage only your files → commit.

Inputs to have ready: a running dashboard (know its port/health), OpenSpec repo layout,
and (if probing `/v1/models`) the ability to mint/revoke a proxy key. Final artifacts:
`openspec/changes/surface-model-introspection-to-agents/{proposal,design,tasks}.md` +
`specs/agent-model-introspection/spec.md`, and the updated
`packages/eng-disciplines/.pi/skills/doubt-driven-review/SKILL.md` (commit `3afd66794`).

---

_Generated from session `019f3494` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-06. Source extract: session facts sheet (Empty providers)._
