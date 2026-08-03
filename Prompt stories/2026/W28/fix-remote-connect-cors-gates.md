---
session: 019f547b
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (5 user prompts); large facts sheet (~10794 tok)"
upgrade_status: pending
openspec_changes: [fix-remote-connect-cors-gates, safe-server-switch, add-tunnel-providers]
proposal_excerpt: "A dashboard running on a LAN host (e.g. `http://192.168.16.242:8000`) is reachable — a browser address-bar visit and a `curl`/main-process probe both work — yet **selecting it as a \"remote\" fails to connect on both su…"
---

# How we did it: Fix remote-connect CORS gates — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened on a note of doubt: **"Why the proposal is missing? In some session lost?"**
The user believed an OpenSpec proposal had vanished across sessions. The *real* objective
that emerged once the confusion cleared was two-fold: (1) confirm nothing was lost and
author the missing optional `design.md`, then (2) fully implement, verify, and ship the
`fix-remote-connect-cors-gates` change — a bug where a LAN-hosted dashboard
(`http://192.168.16.242:8000`) is reachable by browser and `curl`, yet selecting it as a
"remote" fails to connect. The heart of the work was tracing CORS + WebSocket-upgrade auth
gates across three surfaces (server, Electron main/renderer, web client) and landing a
security-correct fix end-to-end.

## 2. TL;DR playbook

1. **Disprove the panic first.** `ls` the change dir + `git log --oneline -- openspec/changes/<name>/` — the proposal was never lost; only the *optional* `design.md` was absent (the session banner lists `{proposal,design,tasks}.md` as a template regardless of what exists).
2. **Author `design.md` grounded in real source, not prose.** Grep the actual code anchors (CORS callback, `probeRemote`, WS-upgrade auth, ticket mint) and mirror a sibling archived change's format. `openspec validate --strict`.
3. **Run `/skill:openspec-apply-change <name>`** — read the spec files, restate the task grouping (§1 server CORS → §2 Electron probe → §3 web switch → §4 verify → §5 manual QA).
4. **TDD each surface.** For security-critical CORS, **extract the decision into a pure module** (`cors-origin.ts`) so the test imports the *real* code instead of a hand-mirror that drifts.
5. **When code contradicts the spec, STOP and re-verify — don't guess.** Here the WS-ticket premise (§3.1–3.3) was false: both upgrade gates short-circuit on a trusted source IP *before* the ticket check. Present the contradiction, get a decision, drop the dead tasks.
6. **Prove reds are not yours.** Run touched test files in isolation; classify full-suite failures (Jimp env mismatch, load-timeout flakes) as pre-existing; confirm the CI baseline on `develop` is green via `gh`.
7. **Ship with `/skill:ship-change`** — archive+sync specs, commit via message file, open PR against `develop`, watch CI, wait for CodeRabbit, squash-merge, clean the worktree from the *parent* checkout.

## 3. How the collaboration unfolded

**Phase 1 — Debunk (Discovery).** The AI immediately `ls`'d the change directory and ran
`git log` to prove the proposal + tasks were present and committed; only `design.md`
(optional) was missing. It correctly diagnosed the session banner's `{proposal,design,tasks}.md`
as a fixed template string, not a manifest. *Why it worked:* it answered the literal question
with filesystem evidence before offering next steps — no speculation.

**Phase 2 — Design grounded in source.** Given "2" (author design.md), the AI grepped the
real anchors (`server.ts` CORS callback, `probeRemote`, WS-upgrade short-circuit, ticket mint)
and matched a sibling archived change's structure, then validated `--strict`. *Decision point:*
the human chose authoring over just reviewing.

**Phase 3 — Apply, TDD, surface-by-surface.** `/skill:openspec-apply-change` drove §1→§4.
The AI extracted the CORS decision into a pure `cors-origin.ts` because the existing
`cors.test.ts` hand-mirrored the callback and had already drifted (missing a branch). Same
move for Electron: extracted `remote-probe.ts` so `main.ts` avoids pulling in `BrowserWindow`.

**Phase 4 — The contradiction (the pivotal moment).** Tracing §3, the AI hit a design issue:
the proposal assumed `/ws` needs a freshly-minted single-use ticket, but the code shows both
WS-upgrade gates allow a trusted source IP *before* any ticket check. It **paused and
presented the contradiction** rather than implementing a ticket flow the server would ignore.
The human's earlier "ok" plus the skill's own pause-on-design-issue rule authorized dropping
§3.1–3.3 and keeping only §3.4 (CORS-blocked-vs-Unreachable UI).

**Phase 5 — Verify honestly.** Full `npm test` showed 14 red files. The AI classified them:
`pi-image-fit` = `Jimp is not a constructor` (local v0.x/v1.x node_modules mismatch);
server timeouts = load contention running 9,725 tests at once. It re-ran touched files in
isolation (53 green) and confirmed `develop`'s CI baseline green via `gh`. Biome/tsc errors
were pre-existing at BASE; its edits added zero new violations.

**Phase 6 — Ship.** "I will tests later, ship-change" → archive+sync, commit, PR #283. One
red (`job-object-windows`) proven pre-existing on `develop` with the identical
`INFRA: app never brought a server up on :8000` message; `develop` unprotected so non-blocking.
CodeRabbit full review: 0 actionable threads. Squash-merged; worktree cleaned from the parent.

## 4. Prompts that worked

- **Goal prompt — "Why the proposal is missing? In some session lost?"** Weak as written
  (an anxious question, not a task), but effective because it forced an evidence-first answer.
  **Stronger version:** *"Verify openspec/changes/fix-remote-connect-cors-gates/ is intact;
  if design.md is missing, author it grounded in the source, then apply the change."*
- **"2"** — a one-character high-leverage pick from an offered menu (author design.md). Menus
  make terse steering unambiguous.
- **"/skill:openspec-apply-change fix-remote-connect-cors-gates"** — invoking the skill by
  name handed the AI the full task-grouping + discipline context in one move.
- **"I will tests later, ship-change"** — explicitly deferred manual QA (§5) and triggered the
  ship skill; clear scope boundary let the AI mark §5 tested-later without asking.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the banner's `{proposal,design,tasks}.md` as a real manifest | (self-corrected) prove with `ls` + `git log` | Never trust template banners — verify files on disk |
| Risk implementing a spec premise blindly | The skill's pause-on-design-issue rule + prior "ok" | STOP and surface code-vs-spec contradictions before coding |
| Add tests that mirror the callback (drift risk) | (self-corrected) extract pure module, import real code | For security-critical logic, test the extracted real function |
| Panic at 14 red test files | Classify: Jimp env mismatch + load-timeout flakes | Run touched files in isolation; check CI baseline via `gh` |
| Delete branch from inside the worktree | Clean up from the *parent* checkout | Worktree pitfall: prune/branch-delete run from parent repo |

## 6. Skills, tools & memory created — and why they're effective

- **Project memory (insight):** the WS-upgrade auth short-circuit — *both* gates
  (no-auth branch `server.ts:~1786`, auth branch `validateWsUpgrade`) allow a trusted source
  IP **before** any ticket check. *Why effective:* this fact burned the proposal's entire
  §3 ticket premise; recording it prevents the next author from re-deriving (or re-proposing)
  a ticket flow the server ignores. **Invoke by:** memory_search "WS upgrade trusted IP ticket"
  before touching remote-connect / ws-auth again.
- **Skills used (not created):** `openspec-apply-change` (task drive + pause-on-design-issue),
  `ship-change` (archive→PR→CI→CodeRabbit→squash→cleanup), `security-hardening` (CORS-widening
  + cross-origin auth discipline).
- **Recommended skill to create:** a "classify a red full-suite run" helper that codifies the
  Jimp-mismatch + load-timeout-flake triage and the `gh`-baseline check — it was reconstructed
  by hand here and is clearly repeatable.

## 7. Pitfalls & dead ends

- **`design.md` "missing" was a false alarm** — the session banner always prints all three
  template names. If a file looks lost, `ls` + `git log --oneline -- <path>` before reacting.
- **`cors.test.ts` hand-mirror had already drifted** (missing the `pi-dashboard.dev` branch).
  If you touch a test that re-implements production logic, extract + import instead of extending.
- **`npm test` full-run reds were environmental:** `Jimp is not a constructor` = local jimp
  v0.x/v1.x node_modules mismatch; server 5000ms timeouts = contention from 9,725 tests at once.
  Re-run affected files in isolation to prove your diff is clean.
- **`biome --changed` found nothing** (no VCS base in worktree) — run Biome on explicit file
  paths; then diff error counts against BASE (git stash) to prove zero new violations.
- **`export type … from` doesn't bind locally** — `remote-connect-window.ts` needed a separate
  local import to use `RemoteProbeResult`/`probeRemote` internally.
- **`--delete-branch` fails inside the worktree** (`develop` held by parent) — the remote merge
  + remote branch-delete still succeed; run local cleanup (`git worktree remove`, branch delete)
  from the parent checkout.
- **`job-object-windows` red is a pre-existing Windows-runner infra flake** — identical
  `INFRA: app never brought a server up on :8000` on `develop`; non-required, non-blocking.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the change name; `gh` authed; the worktree at
`.worktrees/os-<name>`; a second LAN machine only for the *deferred* manual §5 QA.

1. `ls openspec/changes/<name>/` + `git log --oneline -- openspec/changes/<name>/` — confirm intact.
2. Author `design.md` from real code anchors; `openspec validate <name> --strict`.
3. `/skill:openspec-apply-change <name>` — restate §-grouping, note `security-hardening` in scope.
4. Extract security-critical logic to a pure module; TDD against the *real* function.
5. On any code-vs-spec contradiction, STOP, present it, get a decision, drop dead tasks.
6. Run touched test files in isolation (green); classify full-suite reds; `gh` CI baseline.
7. Biome on explicit paths + `tsc --noEmit`; prove zero new violations vs BASE.
8. `/skill:ship-change` → archive+sync, commit via message file, PR vs `develop`, watch CI,
   wait CodeRabbit (0 actionable), squash-merge, clean worktree **from parent**.

**Final artifacts:** PR #283 merged (squash `8bdcf280d` on `origin/develop`); new
`packages/server/src/cors-origin.ts`, `packages/electron/src/lib/remote-probe.ts` (+ tests);
archived `openspec/changes/archive/2026-07-12-fix-remote-connect-cors-gates/`.

---

_Generated from session `019f547b` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-12. Source extract: session facts sheet (mktemp)._
