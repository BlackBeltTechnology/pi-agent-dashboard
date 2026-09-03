---
session: 019e0daf
week: 2026/W19
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (14 user prompts); large facts sheet (~11116 tok)"
upgrade_status: pending
openspec_changes: [add-rpc-stdin-dispatch-with-keeper-sidecar, fix-extension-slash-commands-in-dashboard, add-dashboard-slash-commands, headless-reload-via-respawn, headless-spawn, fix-multiselect-auto-cancel-on-dashboard]
proposal_excerpt: "Pi 0.74's `ExtensionAPI` still does not expose `dispatchCommand`, `prompt`, or any path to `AgentSession._tryExecuteExtensionCommand`. Typed extension slash commands in the dashboard chat (`/ctx-stats`, `/curator`, `/…"
---

# How we did it: make extension slash commands work in the dashboard — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with the standard `/opsx-apply` prompt — *"Implement tasks from an
OpenSpec change"* — pointed (after a change-selection dance) at
`fix-extension-slash-commands-in-dashboard`. The **real objective**, which only
crystallized through the steering turns, was two-fold: (1) ship a working fix so that
typed extension slash commands like `/ctx-stats`, `/curator`, `/agents` in the dashboard
chat *do something* instead of silently going to the LLM; and (2) once it became clear
pi's SDK gives no host-side dispatch path, honestly answer **"can this even be done on the
pi version we support?"** and lay down an OpenSpec proposal for the only architecture that
actually can — RPC stdin dispatch with a keeper sidecar. It ended as *one shipped bridge
fix + one fully-drafted 4-artifact OpenSpec change*.

## 2. TL;DR playbook

1. **Establish ground truth before writing code.** Ask the AI to *"check current codebase
   and whether the prerequisites are implemented or not"* — get a task-by-task, file-line
   evidence report (`tasks.md` N/M done + concrete `grep` hits) before touching anything.
2. **Apply the in-scope tasks only.** Extract a shared `slash-dispatch.ts` helper, wire it
   into both `bridge.ts::sessionPrompt` and `command-handler.ts`, guard `pi.getCommands()`
   / `pi.dispatchCommand` in try/catch, and back it with two focused test files.
3. **Run the scoped tests first, then the full sweep** with `HOME=$(mktemp -d) npx vitest
   run <files>`; only after they're green do `npm test | tee /tmp/pi-test.log`. Triage
   pre-existing failures out loud so you don't chase unrelated red.
4. **Deploy by the right tier:** bridge-only change → `npm run reload`; client change →
   `npm run build` + `curl -X POST /api/restart`. Never over-rebuild.
5. **When a screenshot shows a "failure", verify it's the *expected* stopgap** by reading
   the installed pi `types.d.ts` — don't assume the code is broken.
6. **Prove the capability gap empirically.** `grep -rn "dispatchCommand"` across *both*
   installed pi forks' `dist/` trees; read `createExtensionAPI` in `loader.js` to confirm
   there is no in-process path to `AgentSession.prompt()`.
7. **Study a working precedent** (howcode) to see how it side-steps the same constraint —
   it embeds pi via `createAgentSession()` rather than being an extension.
8. **Weigh durability before proposing the embed.** Ask "do sessions survive a server
   restart?" — surface the regression *before* committing to an architecture.
9. **Search history for prior rejections** of the same idea, then write the proposal to
   *rebut* them with what's changed since.
10. **Draft the OpenSpec change** (proposal → design → specs → tasks), validate strict,
    and pause for the human at every artifact boundary.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / ground-truth (prompts 1–4).** The AI first tried to auto-select an
OpenSpec change; the human interrupted with *"check current codebase and check the
prerequisites."* The AI produced a precise, file-line evidence report: prerequisite change
1/28 done, target change 0/69 done, with `grep` proof (`DASHBOARD_NATIVE_COMMANDS =
new Set(["roles"])`, no `dispatchCommand` anywhere). The human said *"no"* — don't proceed
— then re-issued `/opsx-apply` re-scoped to the prerequisite change. **Why it worked:**
demanding evidence before code turned a vague "implement tasks" into a bounded, correct
scope.

**Phase 2 — Implement + deploy the bridge fix (prompt 5, "build and deploy").** The AI
extracted `slash-dispatch.ts`, wired it into `bridge.ts` and `command-handler.ts`, wrote
`extension-slash-command-detection.test.ts` (10 scenarios) and
`bridge-slash-command-routing.test.ts` (12 cases), ran scoped tests green, updated
AGENTS.md + CHANGELOG, and deployed **bridge-only** via `npm run reload` (correctly *not*
restarting the server). 19/28 tasks done.

**Phase 3 — "There is a problem" screenshot (prompts 6–7).** A screenshot showed a
persistent "in progress" badge next to "failed". The AI correctly diagnosed two things:
the *failure itself was the expected pi-0.70 stopgap* (pi 0.73 still exposes no dispatch),
but the *dual-row was a real client bug*. It fixed `event-reducer.ts` to upsert the
terminal status onto the matching `started` row, rebuilt the client, and restarted.

**Phase 4 — Is this even possible on our pi? (prompts 8–9).** Human: *"we support 0.74.x —
can you check it supports dispatch for extensions?"* and *"check howcode, it has the same
intentions."* The AI read the installed `types.d.ts` for **both** forks
(`@earendil-works` 0.74.0 and `@mariozechner` 0.73.1), confirmed **neither exposes
`dispatchCommand`/`prompt`**, and found that howcode side-steps it by embedding pi as a
library (`createAgentSession()` → `session.prompt()`) instead of registering as an
extension.

**Phase 5 — Durability + history due-diligence (prompts 10–13).** The human probed the
embed path with sharp architecture questions: *"will it load all extensions/skills?"*
(yes — verified in `sdk.js`/`resource-loader.js`), *"do AgentSessions survive a server
restart?"* (no — a real durability regression, laid out in a table), *"what was the reason
I dropped RPC mode?"* (RPC is still used; what was rejected was piping *all* session ops
via stdin — "Path C"), and *"check history for a similar dropped solution"* (found three
prior changes that deferred/rejected this exact idea).

**Phase 6 — Draft the OpenSpec change (prompt 14, "3" = pick option C2).** The AI drafted a
full 4-artifact change `add-rpc-stdin-dispatch-with-keeper-sidecar`: proposal (with a
prior-art rebuttal table), design (10 numbered decisions), 6 spec deltas, tasks — all
validated `--strict`. It then wrapped up `fix-extension-slash-commands-in-dashboard` at
25 done / 3 deferred, verifying §7 manual tasks by code-path inspection + the screenshot.

## 4. Prompts that worked

- **The goal prompt** — the raw `/opsx-apply` template. It's a *fine kickoff* but too open;
  it let the AI start auto-selecting a change. Stronger opener: *"Apply
  `fix-extension-slash-commands-in-dashboard`, but first give me a task-by-task evidence
  report of what's already implemented — don't write code yet."*
- **"check current codebase and check the prerequisites implemented or doesn't"** —
  high-leverage. Forced an evidence pass that reset the scope and prevented redundant work.
- **"@…pi-coding-agent is old, we support 0.74.x. Can you check it supports dispatch for
  extensions?"** — reframed the whole task from "make it work" to "prove whether it *can*
  work," which is what unlocked the honest proposal.
- **"Check howcode, it has the same intentions"** — pointing the AI at a real precedent got
  a concrete architectural comparison instead of speculation.
- **"What was the reason I dropped RPC mode?"** and **"check the history, maybe we had a
  very similar solution earlier which was dropped"** — short prompts that forced
  prior-art due-diligence and made the eventual proposal defensible.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Auto-select / start applying an OpenSpec change immediately | "check current codebase and prerequisites first" / "no" | Open with "evidence report first, no code until I confirm scope" |
| Treat a screenshot "failure" as a bug to chase | (implicitly, by the AI reading `types.d.ts`) — but confirm the stopgap is *expected* | State "when a stopgap fires, verify it's expected before fixing" |
| Assume the current pi version might support dispatch | "we support 0.74.x — check it actually exposes dispatch" | Pin the exact supported pi version + verify SDK surface up front |
| Propose an architecture without weighing durability | "will AgentSessions survive a server restart?" | Require a durability/restart-survival check before any embed proposal |
| Reinvent a previously-rejected design | "check the history for a similar dropped solution" | Grep `openspec/changes/archive/` for prior decisions before proposing |
| Over-deploy (rebuild everything) | (AI self-corrected) — bridge-only → reload; client → build+restart | Keep the 3-tier rebuild matrix in mind: extension→reload, server→restart, client→build+restart |

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created in this session. But the workflow is clearly
repeatable and two skills *should* exist (and largely do in this repo):

- **"Verify a pi SDK capability is present before building on it."** The reusable move:
  `grep -rn "<method>"` across *every* installed pi fork's `dist/` + read the
  `types.d.ts` `ExtensionAPI` surface. Removes hours of building against a phantom API.
  Invoke whenever a feature depends on an un-guaranteed pi SDK method.
- **"Prior-art check before an OpenSpec proposal."** Grep `openspec/changes/archive/` for
  the idea, tabulate each prior change + its decision + what's changed since, and open the
  proposal WHY with that rebuttal table. Makes a re-proposal of a once-rejected design
  defensible instead of amnesiac. (The repo's `plan-proposal` / `doubt-driven-review`
  skills cover the adjacent ground.)

## 7. Pitfalls & dead ends

- **`ask_user` dropdown returned no selection** early on — the AI stalled waiting. If a
  dropdown doesn't resolve, re-issue the choice explicitly (the human answered "no", then
  re-ran the command).
- **6 failed `curl` restart attempts** against `localhost:8000/api/restart` — the inline
  `curl … && curl health` one-liners raced the restart. Fix: use a small
  `restart-dash.sh` + `wait-health.sh` that poll `/api/health` until `mode`/`pid`/`uptime`
  report ready, rather than a fixed `sleep`.
- **Full `npm test` shows 8 red that aren't yours** — pre-existing failures in
  `packages/server` (`pi-dashboard-bin-wrapper.test.ts`) and `packages/shared`
  (`openspec-effective-status-script.test.ts`). Run the *scoped* extension tests first
  (all 88 green) and call out unrelated red explicitly instead of chasing it.
- **Assuming pi supports `dispatchCommand`** — the central dead end the whole session
  circled: pi 0.73.1 *and* 0.74.0 both lack it. Confirm against the installed
  `types.d.ts`, not the docs or optimism.
- **The embed-pi (`createAgentSession`) shortcut has a hidden cost** — restarting the
  server kills every in-flight `AgentSession` (streams, tool runs, MCP subprocesses).
  The current bridge-in-pi-process architecture survives restarts; the embed does not.

## 8. Reproduce it faster — checklist

- [ ] Open with an **evidence report** request: task-by-task done/not-done + `grep` proof,
      *before* any code.
- [ ] Apply only in-scope tasks; extract a shared helper (`slash-dispatch.ts`) rather than
      duplicating dispatch logic across `bridge.ts` + `command-handler.ts`.
- [ ] Guard every un-guaranteed pi SDK call (`getCommands`, `dispatchCommand`) in try/catch.
- [ ] Run **scoped** vitest with `HOME=$(mktemp -d)` first, then `npm test | tee
      /tmp/pi-test.log`; triage pre-existing red out loud.
- [ ] Deploy by tier: bridge → `npm run reload`; client → `npm run build` + `curl -X POST
      /api/restart`; poll `/api/health` (never fixed `sleep`).
- [ ] Verify any user-visible "failure" is the *expected stopgap* against installed
      `types.d.ts` before touching code.
- [ ] Before proposing an alternative architecture: `grep -rn "<method>"` across all pi
      forks, read a precedent (howcode), weigh restart-durability, and grep
      `openspec/changes/archive/` for prior decisions.
- [ ] Draft the OpenSpec change proposal→design→specs→tasks, `openspec validate --strict`,
      pause at every artifact boundary.

**Key inputs to have ready:** the target OpenSpec change name; installed pi paths
(`~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent`,
`@earendil-works/pi-coding-agent`); a running dashboard on `localhost:8000`.

**Final artifacts produced:**
- Shipped bridge fix: `packages/extension/src/slash-dispatch.ts`,
  `bridge-context.ts`, `bridge.ts`, `command-handler.ts`, plus
  `extension-slash-command-detection.test.ts` + `bridge-slash-command-routing.test.ts`;
  client `event-reducer.ts` dedup fix.
- Fully-drafted OpenSpec change `add-rpc-stdin-dispatch-with-keeper-sidecar` (proposal +
  design + 6 spec deltas + tasks, validated strict).

---

_Generated from session `019e0daf` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-09. Source extract: `/tmp/session_facts.15787.14817.md`._
