---
session: 019f8647
week: 2026/W30
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (11 user prompts)"
upgrade_status: pending
openspec_changes: [add-hermes-memory-settings-plugin]
proposal_excerpt: "The `pi-hermes-memory` extension is configured entirely through a hand-edited `~/.pi/agent/hermes-memory-config.json` — there is no UI. Every knob (child-LLM model override, background-review cadence, char limits, cor…"
---

# How we did it: From "eliminate the haiku reference" to a scaffolded settings-plugin change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a thinking stance, not an
implementation task. The real question surfaced in the second prompt: *"Maybe the compact
model be deepseek flash too. Check what we can lose when switching."* The operator was
auditing where the `haiku` model is wired into the repo's role aliases (`@fast`, `@compact`)
and whether cheaper providers (DeepSeek Flash) could safely replace it.

That model-routing exploration then **cascaded into a build**: once the operator understood
that the `pi-hermes-memory` extension pins its background LLM to haiku via a hand-edited
`~/.pi/agent/hermes-memory-config.json` with **no UI**, the real objective became: *scaffold a
dashboard settings plugin that exposes every hermes config knob in a form* — captured as a
full OpenSpec change (`add-hermes-memory-settings-plugin`): proposal → mockup → UX review →
design → specs → tasks, apply-ready, committed in two clean commits.

## 2. TL;DR playbook

1. **Ground the model-routing question in evidence, not memory.** `grep -rln` for `haiku`,
   `@fast`, `@compact` across `.pi` + `packages` (exclude `node_modules`/bundled), then
   `list_roles` to see what each alias actually resolves to.
2. **Find the existing experiment before proposing a switch.** The repo already had a
   model-loss test (`reverse-spec-from-code`) proving DeepSeek Flash **beats** haiku
   (96/90 vs 88/81 coverage) *with a format directive*. Quote it; don't re-run it.
3. **Trace the blast radius** of any role change: enumerate every `@compact` consumer
   (built-in compaction, auto-namer, DocScribe, hermes background cognition).
4. **Verify claims about third-party packages by reading their source**, not guessing —
   grep `context-mode` (no LLM inside → nothing to configure) and `pi-hermes-memory`
   (spawns a `pi -p` child → configurable, already pinned to haiku).
5. **Pivot to a build only after the landscape is clear.** Study the reference pattern
   (`goal-plugin`) and confirm the one critical mechanism: `ServerPluginContext.fastify`
   lets a plugin register its own routes to read/write the external hermes file.
6. **Run the OpenSpec artifact chain in order:** `openspec new change` → proposal →
   (mockup + UX review) → design → specs → tasks, validating after each.
7. **Build the mockup with the dashboard's real tokens** via the
   `frontend-mockup-loop-dashboard` skill; score it, fix the a11y/token bugs it surfaces.
8. **Commit only your change's files** — stage the change directory explicitly, leave
   pre-existing unrelated edits untouched.

## 3. How the collaboration unfolded

**Phase 1 — Model-routing audit (Discovery).** The AI grepped for haiku/`@fast`/`@compact`
references and ran `list_roles`. Key finding surfaced fast: **haiku is already bound to
`@compact`, not `@fast`** (which points at DeepSeek v4 Flash). Only one skill couples haiku
to a role, and it already maps to `@compact`. *Why it worked:* the AI resisted acting on the
loose phrasing "replace @fast" and instead pinned down what the aliases actually resolve to
before touching anything.

**Phase 2 — "What can we lose?" grounded in a real experiment.** Rather than speculate, the
AI found the repo's own model-loss test table and quoted it: DeepSeek Flash out-performs
haiku on generation quality **but only with an explicit format directive** ("no tables / no
bold Scenario / no numbered requirements"). It then mapped every `@compact` consumer to its
sensitivity. *Decision point:* the operator learned the switch was viable but conditional.

**Phase 3 — Educational detours (context-mode, compaction, hermes).** The operator asked
three "how does X work" questions in a row (built-in compaction, whether context-mode uses a
provider model, hermes memory). For each, the AI **read the installed source** before
answering: context-mode makes *zero* LLM calls (FTS5/BM25 only — nothing to configure);
hermes is the opposite — it shells out to a `pi -p --no-session` child and is configured via
`hermes-memory-config.json`, already pinned to haiku.

**Phase 4 — Feasibility + scope lock (Design).** The pivot: "can we make a settings page for
hermes?" The AI studied `goal-plugin` as the reference plugin pattern, mapped the full
`MemoryConfig` schema (~30 fields), and confirmed the crux — `ServerPluginContext` exposes
`fastify`, so a plugin can register `GET`/`PUT /api/plugins/hermes-memory/config` routes that
read/write the real external file. A `ask_user` batch locked four design forks.

**Phase 5 — Proposal + mockup + UX review (Generate).** `openspec new change`, then proposal.
The operator added two refinements mid-flight: *show the default value when a field is unset*,
and *resolve config but write to settings on edit; try to read the file via the hermes API*.
The AI traced the hermes surface and found **no writable API** — the extension only ever
*reads* config and is an unmodifiable external package — so the file is the sole interface.
Then it ran the `frontend-mockup-loop-dashboard` skill: grounded on the dashboard's theme
tokens, built the mockup, scored it, and fixed the surfaced bugs (light-theme `--bg-code`
token, focus-visible rings, WCAG 2.5.8 toggle hit-target).

**Phase 6 — Finish the artifact chain + commit (Verify).** design → specs (7 requirements,
16 scenarios) → tasks (9 TDD-ordered groups), validating to 4/4. Two clean commits, staging
only the change directory and leaving pre-existing unrelated edits unstaged.

## 4. Prompts that worked

- **The goal prompt** (explore mode) was a *stance*, not a task — good for open-ended
  investigation. Pair it with a concrete first question ("audit where haiku is wired into our
  role aliases and what we'd lose switching @compact to DeepSeek Flash") to give the
  exploration a spine.
- **"Check what we can lose when switching"** — high-leverage. It forced an
  evidence-gathering pass (blast-radius map + the existing experiment) instead of a yes/no.
- **"Is it possible to make a settings page for hermes… set every possible setting in
  hermes-memory-config.json — put it in this monorepo's hermes plugin's settings page"** —
  the pivot prompt. Effective because it named the *exact file*, the *scope* (every field),
  and the *destination* (a monorepo plugin), so the AI could ground feasibility immediately.
- **"Show the field's current — if not set — the default values"** — a small refinement that
  shaped both the GET response shape (`{value, default, isDefault}`) and the form UX.
- **"create mockup and ux review"** — short, unlocked the whole design-loop skill.

Rewrite of a weak prompt: *"Maybe the compact model be deepseek flash too"* →
**"Audit every place haiku is bound to a role alias; tell me what `@compact` currently
resolves to, who consumes it, and what quality we'd lose switching it to DeepSeek Flash —
cite any existing test in the repo."**

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Interpret "replace @fast" literally | The AI itself surfaced the ambiguity and paused for intent | State up front which alias you mean and what "replace" means (swap provider vs. re-point role) |
| Answer "how does X work" from priors | Nothing — the AI read installed source first | Keep asking "did you verify that in the source?" for any third-party package claim |
| Want to reuse the hermes extension's API | "if possible get the file content from the hermes extension over its API" | Accept the grounded finding: no writable API exists → the file *is* the interface |
| Treat all modified files as commit fodder | "commit" (implicitly: only my change) | Say "commit only the change directory; leave pre-existing edits unstaged" explicitly |
| Scope the form loosely | "set **every possible** setting" | Name the exhaustiveness bar in the pivot prompt |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — it *consumed* existing skills well:

- **`openspec-explore`** — held the thinking-vs-implementing boundary so the model-routing
  investigation didn't prematurely edit config.
- **`frontend-mockup-loop-dashboard`** — grounded the mockup on the dashboard's real theme
  tokens and an existing settings surface, then scored it and surfaced concrete a11y/token
  bugs (light `--bg-code`, focus rings, toggle hit-target). This is the reusable engine for
  any dashboard settings-surface design.
- **`openspec-ff-change`** — drove the design → specs → tasks tail in one pass.

*Skill that should exist:* a **"map a role-alias change's blast radius"** procedure — grep
`@compact`/`@fast` consumers, resolve via `list_roles`, and cross-reference the repo's
model-loss test tables. This session did it by hand; it's clearly repeatable.

## 7. Pitfalls & dead ends

- **Playwright browser not installed → `npx playwright install chromium` failed on network.**
  Fallback: use the `browser` tool to capture screens at multiple widths/themes instead of
  `score_mockup`'s headless path.
- **Toggle CSS collision:** a later `.track{inset:0}` rule overrode the toggle positioning
  and ballooned the track. Fix: rewrite the toggle block cleanly rather than layering
  overrides — re-verify rendering after any CSS token edit.
- **`git add` hit a transient `.git/index.lock`.** Don't force-remove it blindly — check for
  running git procs first; it cleared on retry.
- **Don't assume a third-party extension exposes a config API.** `pi-hermes-memory` only
  *reads* config (`loadConfig()`) and is an external `node_modules` package — you cannot add
  an API to it as part of your change. Read/write the file directly with the exact path
  resolution (`PI_CODING_AGENT_DIR` → `~/.pi/agent`).

## 8. Reproduce it faster — checklist

- [ ] `grep -rln` haiku / `@fast` / `@compact` across `.pi` + `packages` (skip node_modules/bundled)
- [ ] `list_roles` → confirm what each alias resolves to before proposing any switch
- [ ] Find the repo's model-loss test (`reverse-spec-from-code`) and quote its numbers
- [ ] Read the actual source of any third-party package you make claims about
- [ ] Confirm the plugin mechanism: `ServerPluginContext.fastify` → register `GET`/`PUT` routes
- [ ] `openspec new change` → proposal → mockup + UX review → design → specs → tasks (validate each)
- [ ] Run `frontend-mockup-loop-dashboard`; score; fix surfaced a11y/token bugs
- [ ] Stage **only** the change directory; commit; leave pre-existing edits unstaged

**Inputs to have ready:** the target config file path (`~/.pi/agent/hermes-memory-config.json`),
the reference plugin (`packages/goal-plugin`), the dashboard theme tokens.
**Artifacts produced:** `openspec/changes/add-hermes-memory-settings-plugin/` — `proposal.md`,
`mockups/hermes-settings.html`, `mockups/ux-review.md`, `design.md`,
`specs/hermes-memory-settings/spec.md`, `tasks.md` (two commits: `5271031f5`, `41915895c`).

---

_Generated from session `019f8647-421c-704c-afaf-25d943daeb0a` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-21. Source extract: deterministic facts sheet._
