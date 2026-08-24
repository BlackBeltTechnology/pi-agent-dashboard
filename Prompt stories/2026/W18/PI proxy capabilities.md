---
session: 019de0d6
week: 2026/W18
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (12 user prompts)"
upgrade_status: pending
openspec_changes: [add-dashboard-model-proxy, add-extension-ui-rjsf-form]
proposal_excerpt: "External services (Honcho memory store, LangChain workers, CI test harnesses, custom apps) need a stable, always-on HTTP endpoint that exposes the same set of LLM models the dashboard's `/model` selector shows — witho…"
---

# How we did it: an always-on dashboard model proxy — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** — a thinking-partner stance, explicitly *no
implementation*:

> "Enter explore mode. Think deeply. Visualize freely. Follow the conversation
> wherever it goes… You may read files, search code, and investigate the codebase,
> but you must NEVER write code or implement features… You MAY create OpenSpec
> artifacts."

The real objective only emerged through the steering turns: the operator wanted
external services (Honcho, LangChain workers, CI harnesses, custom apps) to reach the
**same LLM models the dashboard's `/model` selector exposes** through a **stable,
always-on HTTP endpoint** — one proxy, many clients, alive whenever the dashboard is
running. The session ended by drafting and committing a full OpenSpec change proposal
(`add-dashboard-model-proxy`) capturing that capability — not code.

## 2. TL;DR playbook

1. **Start in explore mode**, state the no-code / OpenSpec-artifacts-allowed boundary.
2. **Ground the question in reality first**: before designing, probe whether the thing
   already exists (`lsof -iTCP:<port>`, `pi list | grep proxy`, read the installed
   package's `src/extension.ts`). Discover *why* it isn't running.
3. **Diagnose empty output as signal, not noise** — an empty `curl -s` means
   "nothing listening"; walk the failure tree instead of guessing request shape.
4. **Reframe "one-per-session" → "one daemon, many clients"** with an ASCII before/after
   diagram so the human sees the architecture shift.
5. **Trace the credential layer to its true home**: `ModelRegistry` lives in
   `@mariozechner/pi-coding-agent` (`core/model-registry.ts`), *not* in `pi-ai`.
   `ModelRegistry.create(AuthStorage.create())` needs no live pi session.
6. **Force the fork in the road** when the operator's signals conflict (dashboard-resident
   vs upstream package) — show both proposal shapes, let them pick deliberately.
7. **Draft four OpenSpec artifacts** (`proposal.md`, `design.md`, `tasks.md`,
   `specs/model-proxy/spec.md`) and `openspec validate --strict`.
8. **Run a workshop pass** on the riskiest decision (auth), map handled vs unhandled
   state-space, apply the resolution to all three artifacts, re-validate.
9. **Commit only the proposal directory** — `git add openspec/changes/<name>/` —
   never the unrelated working-tree changes.

## 3. How the collaboration unfolded

**Phase 1 — Reality-check (probe before design).** The AI answered the "is it available?"
question by *checking*, not asserting: it found `@blackbelt-technology/pi-model-proxy`
installed as a pi extension, saw port 9876 wasn't listening, and read
`src/extension.ts` to explain *why* — the proxy boots on `session_start` and dies on
`session_shutdown`, so it only exists while a pi session is alive. This grounding is
what made every later design choice load-bearing.

**Phase 2 — Triage by failure tree.** The operator pasted several `curl` attempts that
returned empty. Instead of guessing, the AI treated empty output as diagnostic, drew a
decision tree (is anything on :9876? was Content-Type set? is the model in the registry?),
and caught two literal copy-paste bugs (a `92876` port typo > 65535, and an
unsubstituted `<id-from-step-3>` placeholder). The lesson it kept returning to: *prove
the proxy is alive before debugging the request*.

**Phase 3 — Reframe the architecture.** The operator's real want surfaced: "work as a
service where multiple clients connect… start when the extension loads, regardless of
session." The AI drew the current (one-proxy-per-session, `EADDRINUSE` collisions) vs
wanted (one long-lived daemon, many clients) picture, which turned a vague request into
a concrete design constraint.

**Phase 4 — Find where the smarts actually live.** Critical grounding: the dashboard
server today has **no `pi-ai` dependency, no streaming, no ModelRegistry** — only
one-shot credential probes. The AI traced the model-resolution machinery to
`@mariozechner/pi-coding-agent`'s `core/model-registry.ts` and confirmed
`ModelRegistry.create(authStorage)` is a clean factory the dashboard can call directly.
Decision point: **the dashboard does not need to spawn a pi session to be a proxy** —
Option C1 (server-resident) became the clear answer.

**Phase 5 — Resolve the contradiction, then draft.** The operator said "draft in
pi-model-proxy project," which conflicted with an earlier "c = dashboard-specific"
signal. The AI stopped and showed *both* proposal shapes rather than silently picking.
Once the operator chose, it drafted four artifacts in
`openspec/changes/add-dashboard-model-proxy/` and passed `openspec validate --strict`.

**Phase 6 — Workshop the riskiest decision.** In workshop mode the AI ranked the five
areas most likely wrong and led with **auth** ("hardest to undo — keys leak, tunnels
expose, failures are silent"). It mapped the dashboard's *actual* auth rules from
`auth-plugin.ts` (loopback bypass, `bypassHosts`, `bypassUrls`), found the proposal
silently assumed auth was binary, and recommended: `/v1/*` never inherits dashboard
bypasses, uniform API-key requirement, per-user key ownership, scopes/expiry/soft-delete.
It patched all three artifacts, re-validated, and committed `975d1be` — proposal
directory only.

## 4. Prompts that worked

- **The goal (explore-mode preamble).** Effective because it set a *stance* (thinking
  partner, no code, artifacts allowed) rather than a task — which is exactly right for a
  proposal you don't yet fully understand. Reusable verbatim.
- **"I would like to work as a service where multiple clients can connect… start when
  extension loads, regardless of session."** Short, but it reframed the whole problem
  from "why won't my curl work" to "design a daemon." High leverage.
- **"Yes, draft in pi-model-proxy project."** A one-line unlock that authorized artifact
  creation — but it *conflicted* with an earlier answer, which is what forced the useful
  fork-in-the-road moment.
- **"commit"** — the terminal instruction; the AI already knew to stage only its own
  directory.

**Rewrite weaker prompts.** The numbered/single-letter replies ("a", "1", "c", "speak")
were terse and twice mis-read (a multiselect got no selection). Stronger:
> "Skip the questionnaire — pick the auth area, give me your recommendation in prose,
> and I'll tell you where I disagree."
State the *mode you want* (prose recommendation vs multiple-choice) so the AI doesn't
guess your interaction style.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Answer "is it available?" as availability-in-principle | Pasting live `curl`s demanding a *running* endpoint | Ask "is it running *now*, and if not, why?" up front |
| Stay inside the one-proxy-per-session mental model | "Work as a service, multiple clients, always-on" | State the daemon/multi-client requirement in the goal |
| Present a multiselect/questionnaire | Terse replies ("a", "1") that didn't select | Say "give a prose recommendation, no questionnaire" |
| Assume auth was binary (JWT-or-key) | Steering into the real bypass rules | Point it at `auth-plugin.ts` before it designs auth |
| Risk committing unrelated working-tree changes | Implicitly (AI self-guarded) — verify it | Always `git add openspec/changes/<name>/` scoped |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was persisted this session — it was a pure explore→propose run. But
the workflow is clearly repeatable and *should* be captured:

- **A "propose a dashboard capability from explore mode" skill.** It would encode the
  winning sequence: ground-in-reality probes → failure-tree triage → architecture
  reframe diagram → trace-the-real-dependency (`ModelRegistry` in `pi-coding-agent`, not
  `pi-ai`) → fork-in-the-road on conflicting signals → four OpenSpec artifacts →
  `--strict` validate → workshop the riskiest decision → scoped commit. That removes the
  re-discovery of *where the credential layer lives* every time.
- **A durable memory worth saving now:** `ModelRegistry.create(AuthStorage.create())`
  from `@mariozechner/pi-coding-agent/core/model-registry.ts` gives full credential
  resolution (auth.json + providers.json + OAuth refresh) **without spawning a pi
  session** — the key architectural fact that unlocked the whole design.

## 7. Pitfalls & dead ends

- **Empty `curl -s` output is not "no data" — it's "nothing listening."** Drop `-s`, add
  `; echo "exit=$?"`; exit 7 = connection refused. Don't debug the request body until the
  port answers.
- **Port typo `92876` > 65535** fails at the OS level and `curl -s` swallows the error.
  Sanity-check ports.
- **Unsubstituted placeholders** (`<id-from-step-3>` sent literally) produce misleading
  404s — verify shell variable substitution before blaming the server.
- **`ModelRegistry` is NOT in `pi-ai`.** Searching `pi-ai` for it wastes time; it lives
  in `@mariozechner/pi-coding-agent`. `pi-ai` exports only primitives (stream fns, OAuth
  helpers, env key resolution).
- **`openspec change new` failed** (`❌`); the AI fell back to creating the directory +
  artifacts by hand — check `openspec --help` for the actual subcommand shape.
- **Conflicting operator signals** ("c = dashboard-specific" vs "draft in pi-model-proxy
  project") — don't silently reconcile; surface both shapes and make the human choose.

## 8. Reproduce it faster — checklist

- [ ] Enter explore mode; state *no code, OpenSpec artifacts allowed*.
- [ ] Probe reality: `lsof -iTCP:9876 -sTCP:LISTEN`, `pi list | grep proxy`, read the
      installed package's `src/extension.ts` for its lifecycle.
- [ ] When a `curl` returns empty, prove the port is alive first (`curl -i … ; echo exit=$?`).
- [ ] Draw the current-vs-wanted architecture (one-per-session → daemon) as ASCII.
- [ ] Confirm the credential layer: `ModelRegistry.create(AuthStorage.create())` in
      `@mariozechner/pi-coding-agent/core/model-registry.ts` — no pi session needed.
- [ ] On conflicting signals, present both proposal shapes; let the operator pick.
- [ ] Draft `proposal.md` / `design.md` / `tasks.md` / `specs/<cap>/spec.md`; run
      `openspec validate <name> --strict`.
- [ ] Workshop the riskiest decision (here: **auth** — map handled vs unhandled state
      against `auth-plugin.ts`); patch all artifacts; re-validate.
- [ ] Commit scoped: `git add openspec/changes/<name>/ && git commit` — never the
      unrelated working tree.

**Inputs to have ready:** a running dashboard, the installed `pi-model-proxy` package,
`~/.pi/agent/{auth,providers,models}.json`, and `openspec` on PATH.
**Artifacts produced:** `openspec/changes/add-dashboard-model-proxy/{proposal,design,tasks}.md`
+ `specs/model-proxy/spec.md`, committed as `975d1be` on `develop`.

---

_Generated from session `019de0d6-bffd-7139-94b3-844eef88380e` · `pi-agent-dashboard` · 2026-05-01. Source extract: facts sheet from `extract_session.ts`._
