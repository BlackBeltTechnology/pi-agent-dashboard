---
session: 019ec388
week: 2026/W24
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [fix-spawn-token-env-leak, fix-openspec-worktree-cwd-keying, new-spec-spawn]
proposal_excerpt: "When a user spawns a worktree/OpenSpec session, the real session card appears but the placeholder loading card never clears (it lingers ~30 s until the safety timeout). Root cause: the single-use spawn-correlation…"
---

# How we did it: Trace the stuck placeholder card and land a proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a thinking stance, no
implementation. The real objective, once steering clarified it: **find out why the
"placeholder loading card" for a worktree/OpenSpec spawn never clears** (it lingers
~30 s until a safety timeout) — and, added mid-session, why the **new worktree card
doesn't appear at the top of the list**. The deliverable was not a code fix but a
**validated OpenSpec change proposal** (`fix-spawn-token-env-leak`) capturing the root
cause, the blast radius, and the trap that makes the naive fix wrong.

## 2. TL;DR playbook

1. Enter `openspec-explore` — declare "trace it, don't fix it" so the AI stays in
   investigation mode and produces artifacts, not edits.
2. Have the AI grep the client for the placeholder concept
   (`placeholder|optimistic|spawningCwd|PlaceholderSessionCard`) and map the
   **clear-on-arrival** correlation chain end to end (client `requestId` ↔ server
   `spawnToken` ↔ `session_added{spawnRequestId}`).
3. Split the two symptoms early — **card ordering** (a grouping-by-design fact) vs
   **card never clears** (a correlation break). They have different root causes.
4. Pull **runtime evidence** from `~/.pi/dashboard/server.log`: quantify token reuse
   (`token=X → N sessions, all in the same worktree`) to upgrade "probable" → "certain".
5. Follow the env var down the process tree: `spawnPiSession` → `buildSpawnEnv` →
   rpc-keeper → `keeper.cjs spawnPi()` → bridge `session-sync.ts`. Find the two hops
   where `PI_DASHBOARD_SPAWN_TOKEN` should be scrubbed but isn't.
6. **Ask "what else does this touch?"** before proposing a fix — map every reader of
   the token/`dashboardSpawned` to find the overload (single-use correlation **and**
   a persistent boolean).
7. Scaffold the change **manually** (there is no `openspec change new` scaffold
   command), following the existing `specs/<capability>/spec.md` delta convention.
8. `openspec validate <change> --strict`, then commit and `git pull --rebase origin
   develop` before pushing.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (client).** The AI grepped `packages/client/src` for the
placeholder concept, found `spawningCwds` / `PlaceholderSessionCard` keyed by cwd, and
traced the clear logic. Redaction mangled identifiers (`l card`, `nCwd`) so it read the
**actual source** to recover real names. *Why it worked:* it mapped the full correlation
round-trip instead of guessing at the symptom.

**Phase 2 — Correlation trace (server + bridge).** It followed `spawnRequestId` →
`spawnToken` across `event-wiring.ts`, `session-action-handler.ts`, and the bridge's
`session-register`, discovering a 3-tier correlation and that the worktree path DID
record the correlation server-side — so the break was downstream.

**Phase 3 — Runtime evidence.** Prompt `a`/`b` steered it to *trace it* with real data.
It grepped `~/.pi/dashboard/server.log` and found **one `spawnToken` reused by 13
sessions**, all in the same worktree — the smoking gun that flipped the hypothesis to a
certain root cause.

**Phase 4 — Blast-radius mapping.** Prompt "Analyze what other part can be affected"
forced the decisive finding: `PI_DASHBOARD_SPAWN_TOKEN` is **overloaded** — a single-use
correlation token AND the `dashboardSpawned` boolean read on every register. A naive
`delete` fixes the leak but silently regresses source labelling.

**Phase 5 — Proposal + ship.** "create proposal" → pre-scaffold coherence check against
active changes, manual scaffold of the 4-file change, `--strict` validate, then "commit
and push" → rebase onto latest `develop` and push. Decision points: the human chose to
*trace with evidence* (not stop at the hypothesis), to *widen scope* to ordering + blast
radius, and to *capture as a proposal* rather than fix inline.

## 4. Prompts that worked

- **The goal prompt** (`openspec-explore` stance): effective because it forced a
  *thinking/artifact* mode — the AI investigated and wrote a proposal instead of editing
  code. Bake in "trace, don't fix" for any root-cause hunt.
- **"Trace it. And the created worktree card not in top"** — a high-leverage follow-up:
  demanded real tracing (→ server-log evidence) AND added the second symptom in one line.
- **"Analyze what other part can be affected for the change of this logic"** — the single
  most valuable prompt: it surfaced the overload/blast-radius trap before any fix was
  proposed, preventing a regression.
- **"create proposal" / "commit and push"** — terse unlocks that moved from analysis to a
  shipped artifact.

Weak prompts `a` and `b` (single letters) worked only because context was already deep;
a stronger version: *"trace the deferred worktree-spawn token path in the server against
the server.log — quantify token reuse."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at a plausible hypothesis for symptom 1 | "Trace it" (+ demand runtime data) | State "confirm with server.log evidence, not just code reading" up front |
| Focus on one symptom (card never clears) | Adding "and the created worktree card not in top" | List all observed symptoms in the goal prompt |
| Head toward a fix once root cause was found | "Analyze what other part can be affected" | Always run a blast-radius / who-else-reads-this pass before proposing |
| Trust redacted grep output (`l card`, `nCwd`) | Re-reading the actual source | Prefer `read` over grep snippets when identifiers look mangled |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was saved. The reusable assets are the **OpenSpec artifacts**
(`fix-spawn-token-env-leak`: proposal, design, tasks, spec delta). The **design.md** is
the durable value — it pins the *capture-once boolean* decision and explicitly rejects
reusing `PI_DASHBOARD_SPAWNED`, so a future implementer doesn't re-derive the trap.

The one subagent — `Explore` ("Find workspace card and placeholder rendering") — was the
right call for the read-only "where is X" opening move, keeping the search out of main
context. **Worth creating next time:** a `trace-spawn-correlation` project skill capturing
the client↔server↔bridge token round-trip and the `server.log` token-reuse query, since
this correlation path is investigated repeatedly.

## 7. Pitfalls & dead ends

- **`openspec change new <name>` does not exist** — the command failed. Scaffold the
  change directory manually, copying the existing `specs/<capability>/spec.md` delta
  layout.
- **Redacted grep output** mangles identifiers into `l`/`n` placeholders — if a symbol
  looks wrong, `read` the file directly rather than trusting the snippet.
- **Naive `delete process.env.PI_DASHBOARD_SPAWN_TOKEN` is a trap** — it fixes the leak
  but collapses the `dashboardSpawned` role read on every register, regressing source
  labelling. Never scrub an overloaded env var without mapping every reader first.
- **Push rejected** — remote had new commits; `git pull --rebase origin develop` before
  `git push` (rebased onto `383bb2e9`, landed at `653f3052`).

## 8. Reproduce it faster — checklist

- [ ] Enter `openspec-explore`; declare "trace, don't fix — confirm with server.log".
- [ ] Grep client for `spawningCwds|PlaceholderSessionCard`; map clear-on-arrival chain.
- [ ] Trace `requestId ↔ spawnToken ↔ session_added{spawnRequestId}` across
      `event-wiring.ts`, `session-action-handler.ts`, bridge `session-register`.
- [ ] Quantify token reuse in `~/.pi/dashboard/server.log` (`token=X → N sessions`).
- [ ] Follow the env var: `buildSpawnEnv` → `keeper.cjs spawnPi()` → `session-sync.ts`;
      find the un-scrubbed hops.
- [ ] Map every reader of the token/`dashboardSpawned` (blast radius) → find the overload.
- [ ] Manually scaffold `openspec/changes/<name>/` (proposal, design, tasks, spec delta).
- [ ] `openspec validate <name> --strict` → commit → `pull --rebase` → push.

**Key inputs:** running dashboard with `~/.pi/dashboard/server.log`, repo on `develop`.
**Artifacts produced:** `openspec/changes/fix-spawn-token-env-leak/{proposal,design,tasks}.md`
and `specs/spawn-correlation/spec.md` (1 MODIFIED + 2 ADDED requirements); committed as
`653f3052`, no `src/` changes.

---

_Generated from session `019ec388-a111-7390-b1f9-220d4f3b005e` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-14. Source extract: deterministic facts sheet._
