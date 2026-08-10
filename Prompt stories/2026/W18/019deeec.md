---
session: 019deeec
week: 2026/W18
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [spawn-failure-diagnostics]
proposal_excerpt: "When `spawnPiSession` fails, the user gets a single message string and very little signal about *what* broke or *why*. The OS process may be alive past the 300 ms crash window yet never `session_register` (wrong port,…"
---

# How we did it: Turning a "how does spawn work?" question into a validated OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a pure discovery question: *"In dashboard how and what module spawn pi instance?"* No plan, no change, no ticket — just wanting to understand the spawn path. The **real objective** only emerged through steering: by prompt 2 the operator asked *"Is it possible to make some error handling to be able to determinate the effect when new session cannot be created?"*, and by prompt 3 (*"all of them, and create proposal"*) the intent had crystallised into: **produce a fully-designed, validated OpenSpec change that adds diagnostics for every way `spawnPiSession` can silently fail** — stderr capture, failure-code classification, a register watchdog, a preflight gate, and a persistent rolling failure log. Implementation itself was deliberately *not* the goal; the session ended with 4/4 artifacts valid and 0/66 tasks done, paused for a human phasing decision.

## 2. TL;DR playbook

1. **Ask the discovery question first, code second.** Prompt: *"how and what module spawns the pi instance?"* Let the AI map `process-manager.ts → spawn-mechanism.ts → detached-spawn.ts` and the two-tier `SpawnStrategy`/`SpawnMechanism` resolution before proposing anything.
2. **Follow the map to the pain point.** Ask *"what node/npm is used, and can we detect when a session can't be created?"* — this surfaces the `binary-lookup.ts` / `tool-registry` resolution chain and the silent-failure gap (process alive but never `session_register`).
3. **Unlock scope with one short prompt.** *"all of them, and create proposal"* — authorise every improvement at once instead of drip-feeding.
4. **Drive OpenSpec by the tool, not by hand.** `openspec new change`, then follow `openspec status --json` / `openspec instructions <artifact>` to build proposal → specs → tasks in dependency order, running `openspec validate` after each.
5. **Explicitly ask "anything to clarify?"** before locking the design — this is what turned unilateral defaults (hard-coded 10 s watchdog, deferred Unix stderr, no tmux watchdog) into surfaced decisions.
6. **Answer the ambiguities as a numbered list** matching the AI's numbered questions (`1. make 30s and config… 2. keep deferred but docs/todo… 3. watch by cwd…`) — cheapest possible high-bandwidth steering.
7. **Re-validate and let it fold decisions back** into design.md + every affected spec delta + tasks.md; end with `openspec validate` green.
8. **Stop at the implementation boundary.** When `/opsx:apply` proposes a phasing, confirm the plan *before* writing code — don't let it plow 66 tasks unattended.

## 3. How the collaboration unfolded

**Phase A — Discovery (prompts 1–2).** The AI read + grepped `process-manager.ts`, `spawn-mechanism.ts`, `detached-spawn.ts`, `binary-lookup.ts` and the `tool-registry` and produced two dense explainers: the spawn-mechanism selector rules and the `resolvePi`/`resolveNode`/npm resolution chain (managed module → bare-import → npm-global → managed bin; Windows always `[node.exe, cli.js]`). *Why it worked:* grounding the proposal in the *actual* code paths meant the failure taxonomy that followed was real, not speculative.

**Phase B — Scope unlock + proposal (prompt 3).** *"all of them, and create proposal"* authorised all five improvements. The AI ran `openspec new change spawn-failure-diagnostics`, wrote `proposal.md` covering stderr tail, 9 failure codes, register watchdog, preflight gate, and a rolling NDJSON log — then **stopped at the proposal artifact** because validation expects deltas next. *Decision point:* the human let the AI drive the OpenSpec state machine rather than dictating file layout.

**Phase C — Spec deltas + tasks (prompt 4 = the `/opsx:ff` command).** The AI generated 7 spec deltas (`process-manager`, `headless-spawn`, `spawn-preflight`, `spawn-register-watchdog`, `spawn-failure-log`, `spawn-error-persistence`, `dashboard-server`), a `design.md` with 7 decisions (D1–D7) + 6 risks, and `tasks.md` — validating after each with `openspec validate` + `openspec status --json`.

**Phase D — Clarify before committing (prompts 5–6).** The human asked *"Is there anything to clarify?"* and the AI surfaced three real ambiguities it had resolved unilaterally: hard-coded 10 s watchdog, no Unix-headless stderr, no tmux/wt watchdog. The human answered with an 8-point numbered list. The AI folded every answer back: watchdog → **30 s default + `spawnRegisterTimeoutMs` config + Settings UI**, two new spec deltas (`shared-config`, `settings-panel`), tmux/wt now watched **by cwd** with dual `byPid`/`byCwd` indexing, preflight `useLoginShell: false`, log relocated to `~/.pi/dashboard/sessions/spawn-failures.log`, plus a late-register recovery message (`spawn_register_recovered`). Validation green, 9 deltas.

**Phase E — Implementation boundary (prompt 7 = `/opsx:apply`).** The AI selected the change, reported 0/66 tasks, proposed a 4-phase execution order — and, per AGENTS.md "confirm the plan before any major change", **paused for approval instead of implementing**. The human declined the proposed phasing; the AI stopped cleanly, leaving the change fully designed and ready.

## 4. Prompts that worked

- **Goal prompt — *"how and what module spawn pi instance?"*** Effective because it asked the AI to *map* before *build*. A stronger phrasing for a future run: *"Map the pi-spawn code path (entry module → mechanism selection → actual child_process.spawn), then tell me every way it can fail silently."* — folds discovery + failure analysis into one.
- **High-leverage unlock — *"all of them, and create proposal"*** Five words that authorised the entire scope and switched mode from Q&A to OpenSpec authoring. This is the single most valuable prompt in the session.
- **The clarify prompt — *"Is there anything to clarify?"*** Cheap and enormously effective: it forced the AI to expose the defaults it had silently chosen, converting hidden risk into explicit human decisions.
- **The numbered-answer prompt** (`1. make 30s… 2. keep deferred… 3. watch by cwd…`). Matching the AI's numbered questions 1:1 is the highest-bandwidth, lowest-effort way to steer a multi-decision design.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Hard-code magic timeouts (10 s watchdog) as if final | "make 30s and create config `spawnRegisterTimeoutMs` and add to settings page" | State up front: "any tunable threshold → config field + Settings UI, no magic numbers" |
| Silently defer gaps (Unix-headless stderr) without tracking them | "keep deferred, but add to `docs/todo.md`" | Require every deferral to leave a `docs/todo.md` breadcrumb |
| Exclude hard cases (tmux/wt get no watchdog because "we don't own the PID") | "watch by cwd in 30s" | Ask "what's the fallback signal when the obvious one is unavailable?" during design |
| Resolve design ambiguities unilaterally and move on | "Is there anything to clarify?" | Add an explicit clarify checkpoint after design.md, before specs are finalised |
| Want to plow all 66 implementation tasks once apply started | Decline the proposed phasing; keep it paused | Confirm phasing/scope-per-session *before* `/opsx:apply` writes code |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was saved this session — it was a pure OpenSpec authoring run driven by existing tooling (`openspec new/status/instructions/validate` + the `/opsx:ff` and `/opsx:apply` skill flows). The reusable asset produced is the **change itself** (`openspec/changes/spawn-failure-diagnostics/`, 4 valid artifacts, 9 spec deltas, 66 tasks).

**Skill that *should* exist** (recommend creating): a "diagnose-then-spec" playbook that codifies the effective loop seen here — *map the code path → identify silent-failure modes → `openspec new` → build artifacts in `openspec status --json` order → insert an explicit clarify checkpoint before finalising design → validate → stop at the apply boundary.* This session is a near-perfect template for it.

## 7. Pitfalls & dead ends

- **One edit failed (1 of 8)** — expected when editing freshly-generated spec deltas; re-read the file and retry with exact context rather than guessing.
- **Proposal validation "fails" by design** after only the proposal exists — it expects deltas next. Don't treat the red as an error; it's the state machine telling you the next artifact. Follow `openspec status`/`instructions`.
- **Unilateral design defaults are invisible until you ask.** The 10 s watchdog, missing Unix stderr, and unwatched tmux would have shipped silently without the "anything to clarify?" checkpoint. Always run it before specs harden.
- **Don't let `/opsx:apply` run unattended on a 66-task change.** The correct move (taken here) is to propose phasing and pause; a 6h-13m session that ends at 0/66 designed-and-validated is a *success*, not an incomplete.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** repo with OpenSpec configured (`openspec` CLI on PATH), the target code area identified (here: `packages/server/src/process-manager.ts` + `packages/shared/src/platform/`).

- [ ] Ask the AI to **map the code path** (spawn entry → mechanism → child_process) before proposing anything.
- [ ] Ask **"how can this fail silently, and how would we detect it?"** to derive the failure taxonomy.
- [ ] Authorise scope in one prompt: **"all of them, create proposal."**
- [ ] Let the AI drive `openspec new change <name>` then build artifacts in `openspec status --json` order, validating after each.
- [ ] Run the **"anything to clarify?"** checkpoint after `design.md`; answer ambiguities as a numbered list.
- [ ] Confirm **all decisions fold back** into design.md + every affected spec delta + tasks.md; end on `openspec validate` green.
- [ ] At `/opsx:apply`, **confirm phasing before any code is written**; pause if unsure.

**Artifacts produced:** `openspec/changes/spawn-failure-diagnostics/{proposal.md, design.md, tasks.md}` + 9 spec deltas under `specs/` (process-manager, headless-spawn, spawn-preflight, spawn-register-watchdog, spawn-failure-log, spawn-error-persistence, dashboard-server, shared-config, settings-panel). 4/4 artifacts valid, 66 tasks ready.

---

_Generated from session `019deeec-86e8-716d-a3a6-3ea96b2946d5` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-03. Source extract: session-to-guideline facts sheet._
