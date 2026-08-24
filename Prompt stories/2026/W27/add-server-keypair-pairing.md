---
session: 019f2e36
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); large facts sheet (~12509 tok)"
upgrade_status: pending
openspec_changes: [add-server-keypair-pairing]
proposal_excerpt: "Today the only remote-auth method is OAuth (GitHub/Google/OIDC), which needs a registered OAuth app and a public provider — heavy for a self-hosted personal tool. There is no \"just let *my* phone in\" path."
---

# How we did it: Server keypair phone-pairing — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The literal first prompt was tiny — `rebase to develop` — but the *real* objective
lived in the OpenSpec change that followed it: **`add-server-keypair-pairing`**, one of
the largest, most security-critical changes in the repo. It replaces "OAuth-or-nothing"
remote auth with a **"just let my phone in" path**: a persistent server Ed25519 identity,
QR-code pairing with a compare-code approval flow, long-lived opaque bearer tokens,
single-use WebSocket tickets, and — the dangerous part — ripping out `isLoopback()`
auth-exemption (a live zrok-tunnel bypass) and replacing it with genuine-local IPC
detection. 26 tasks across 6 capabilities, ending in a new neutral-shell PWA and a
GitHub Pages deploy. The operator drove the whole thing to a **squash-merged PR** in one
two-hour session using three short prompts.

## 2. TL;DR playbook

1. **Rebase / sync first.** `rebase to develop` — confirm the branch is actually in sync
   before touching code (here it already was; the AI said so and stopped).
2. **Hand it the change, not a task list.** `/skill:openspec-apply-change add-server-keypair-pairing`.
   The apply skill reads proposal + design + all specs + tasks.md and grounds against real code.
3. **Unlock full autonomy up front.** When the AI proposes landable phases and asks how to
   proceed, answer **"full A→E in order, pause only if genuinely blocked."** This converts a
   26-task spec into an unattended phase march.
4. **Let it build phase-by-phase, tests-first.** Each phase = new module + its `*.test.ts`,
   typecheck the package, run the targeted suite, then the full server suite for regressions,
   then mark tasks done.
5. **Expect a genuine design fork on the risky task** (loopback→IPC). The AI correctly
   *stopped and surfaced the fork* rather than guessing; pick the **narrower option**
   (forwarded-header + local-token, not a full Unix-socket migration).
6. **Delegate the large self-contained frontend** to `react-expert` with the now-frozen API
   contracts; keep the small Settings integration inline.
7. **Ship it:** `Use ship-change skill`. It verifies (`npm test` + build), archives + syncs
   specs, commits, pushes, opens the PR, watches CI, drains CodeRabbit threads, and
   squash-merges.
8. **Treat CodeRabbit as a real reviewer.** Apply the bugs it finds in *your* code, defer
   preference-only threads with a transparent PR note, loop until CI green + 0 actionable.

## 3. How the collaboration unfolded

**Phase 0 — Sync check (1 prompt).** `rebase to develop` → the AI ran `git rev-list
--left-right --count`, found 0/0, reported "nothing to rebase," and *asked* before doing
anything destructive. Good instinct worth reinforcing: it did not invent work.

**Phase 1 — Grounding (skill invoke).** `/skill:openspec-apply-change` triggered a full read
of proposal, design, all 6 specs, and 26 tasks, cross-referenced against the actual
`auth-plugin.ts`, `localhost-guard.ts`, `server.ts:1630`, `bridge.ts`. The AI produced a
**scope-reality assessment** — flagging the two gated tasks (D13 token model, resolved by
specs to opaque-bearer; D10 loopback→IPC, the dangerous migration) and a natural A→E phase
breakdown — *before writing a line*. This is the single highest-leverage move: the model
mapped risk before touching code.

**Phase 2 — Server build A→C (autonomous).** After the operator said "full A→E in order,"
the AI marched: identity → pairing → paired-devices → bearer-auth → pairing-routes → CORS
(A), WS single-use ticket (B), genuine-local + local-token (C). Every module shipped with
a colocated test, a package typecheck, and a full-suite regression run (2819 → 2830 server
tests). It caught its own bugs mid-flight (a `sweep()` that deleted an expired code before
the expiry check could report it) and reconciled a spec contradiction on its own (F6: the
durable bearer must **never** ride the WS — only the ephemeral ticket may, so Phase A's
bearer-over-subprotocol became a ticket in Phase B).

**Decision point — the loopback fork (C).** Before ripping out `isLoopback()`, the AI
*stopped* and surfaced a real, grounded design fork: browser callers (terminal/editor/main
WS) **cannot** read a Unix socket or a `0700` token file, so a full IPC migration would
break them. It proposed the narrower **option 2** (trust loopback only when no
`X-Forwarded-*` header is present — zrok injects them — plus an affirmative local-token for
process callers). The operator picked it. This is the model doing its job: not guessing on
an irreversible security change.

**Phase 3 — Frontend D (delegate + inline split).** The AI built the small Settings
paired-devices section inline, then handed the large self-contained neutral-shell PWA
(keyring + PairView + protocol) to the **`react-expert`** subagent with frozen API
contracts. Clean isolation because the contracts were already fixed by Phases A–C.

**Phase 4 — Deploy + gates E.** Caught a real infra collision — `site/` already owns the
single GitHub Pages slot and `pi-dashboard.dev` CNAME — and resolved it by serving the
shell at a **same-origin subpath** `/app/` (so the CORS default still works). Delegated the
`docs/` architecture entry to a subagent per the caveman-style Rule 6. Ran security-hardening
+ doubt-driven-review passes and recorded the residual notes as a memory.

**Phase 5 — Ship (2nd steering prompt).** `Use ship-change skill` drove verify → archive →
commit → PR #236 → CI → CodeRabbit → merge. Along the way it repaired two **pre-existing**
malformed main specs (`## ADDED Requirements` where `## Requirements`/`## Purpose` belonged)
that blocked the spec sync, and worked around the non-atomic archive that leaked a
half-written spec file.

## 4. Prompts that worked

- **The goal prompt (`/skill:openspec-apply-change add-server-keypair-pairing`).** Effective
  because it hands the AI a *fully-specified change* (proposal/design/specs/tasks), not a
  vague ask. All the requirements-gathering already happened in OpenSpec, so the model
  spends its budget on grounding and building, not guessing scope.
- **High-leverage unlock: "full A→E in order, pause only if genuinely blocked."** One
  sentence converted a 26-task spec into an unattended march. The key phrase is
  *"pause only if genuinely blocked"* — it grants autonomy while preserving the
  stop-and-ask instinct for real forks (which fired exactly once, on the loopback migration).
- **The ship prompt (`Use ship-change skill`).** Effective because it delegates the entire
  land-it pipeline to a known skill instead of hand-driving git/gh/CI.

Weak-prompt rewrite: `rebase to develop` on its own is nearly a no-op here. If the intent is
"start implementing this change," say so directly: *"Sync to develop, then
`/skill:openspec-apply-change add-server-keypair-pairing`; go full-phase, pause only on a
genuine design fork."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop and ask "what next?" after mapping the phases | Answering "full A→E in order, pause only if genuinely blocked" | Stating the autonomy contract in the kickoff prompt so it never waits |
| Treat "rebase to develop" literally (a no-op) | Following up with the actual apply-skill invoke | Leading with the real objective, not a pre-step |
| Leave the ship/land phase implicit after implementation | Explicitly `Use ship-change skill` | Naming the terminal skill in the same breath as the build ("build then ship") |

Note the *absence* of correction on the substance — the operator never had to redirect the
crypto, the token model, or the loopback fix. The heavy steering was purely about **granting
autonomy and naming the next skill**, because the OpenSpec change had already absorbed the
requirements work.

## 6. Skills, tools & memory created — and why they're effective

Two **project memories** were saved (no skills):

- **tool-quirk — "worktrees need their own `npm ci`."** A fresh `.worktrees/<name>` checkout
  has a near-empty `node_modules`, so both `tsc` and the jiti runtime walk *up* to the MAIN
  repo's `node_modules` and resolve `pi-dashboard-shared` to the parent checkout — making
  your in-worktree `shared` edits **invisible**. The fix: run `npm ci` inside the worktree.
  Effective because this is a silent, high-confusion failure ("my edits don't take effect")
  that costs 15+ minutes of resolution-debugging to rediscover; the memory makes it a
  one-line fix next time.
- **insight — residual security notes (non-blocking).** Records the doubt-review findings
  (e.g. a bearer-paired device passes `networkGuard` and can call `POST /api/pair/approve`),
  so the next person hardening this surface starts from the known-open questions instead of
  re-deriving them.

Recommended skill to create (none existed): a **"worktree apply-change bootstrap"** skill
that runs `npm ci` in the worktree *before* the first typecheck, since this session lost real
time to the resolution gotcha above.

## 7. Pitfalls & dead ends

- **Worktree module resolution silently resolves to the parent repo.** Symptom: edits to a
  shared package don't show up in typecheck; `import.meta.resolve` points at the main
  checkout. Fix: `npm ci` inside the worktree (see the memory above).
- **Stale `tsbuildinfo`.** A `pairing` config field showed as "missing" from a cached
  incremental build. Fix: clear `*.tsbuildinfo` and re-typecheck.
- **`sweep()` before an expiry check masks the very thing you're testing.** The pairing test
  failed because the pre-lookup sweep deleted the expired code before the explicit expiry
  branch could report it. Fix: don't sweep before the check you rely on.
- **`@types/node` overload gap.** `createPublicKey(privateKey: KeyObject)` isn't in this
  version's overload union → cast it.
- **Pre-existing malformed main specs block `openspec archive`.** `cross-origin-client` and
  `server-cors` carried a stray `## ADDED Requirements` delta header (needs
  `## Purpose` + `## Requirements`). The archive is **not atomic** — it leaked a half-written
  `bearer-device-auth/spec.md` before aborting. Fix: repair the two blocking specs to the
  valid top-level form, delete the leaked file, re-run.
- **`gh pr merge` fails inside a worktree** because it tries to check out `develop` locally
  (owned by the parent worktree). The **remote merge still succeeds** — verify with
  `gh pr view`, then delete the remote branch and remove the worktree *from the parent*.
- **After `git worktree remove`, your shell's cwd is gone.** The Bash tool stays pinned to
  the deleted dir; run final verification from the parent (or the sandbox shell).

## 8. Reproduce it faster — checklist

- [ ] Have the OpenSpec change ready (`openspec/changes/<name>/` with proposal, design,
      specs, tasks.md).
- [ ] From the worktree: **`npm ci` first** (avoid the parent-resolution trap), then
      `/skill:openspec-apply-change <name>`.
- [ ] In the kickoff, grant autonomy: *"full phase march in order, pause only on a genuine
      design fork."*
- [ ] Build each module tests-first → package typecheck → targeted suite → full server suite
      for regressions → mark tasks.
- [ ] For the one dangerous task (auth/loopback), expect a stop-and-ask; pick the **narrower**
      option.
- [ ] Delegate large self-contained frontends to `react-expert` with frozen API contracts;
      keep small integrations inline.
- [ ] `Use ship-change skill` to verify → archive → PR → CI → CodeRabbit → squash-merge.
- [ ] Apply CodeRabbit's real bugs, defer preference threads with a PR note, loop to green.
- [ ] Save the worktree-`npm ci` tool-quirk and any residual-security notes as project memory.

**Final artifacts:** server modules `identity.ts`, `pairing.ts`, `paired-devices.ts`,
`bearer-auth.ts`, `ws-ticket.ts`, `local-token.ts`, `routes/pairing-routes.ts` (+ tests);
client `PairedDevicesSection.tsx` + `paired-devices-api.ts`; new neutral-shell PWA
(`packages/shell/`); `deploy-site.yml` shell-at-`/app/`; 6 synced specs; PR **#236**
squash-merged to `develop` as `f36a0cf7e`.

---

_Generated from session `019f2e36-005c-73d9-bfeb-7e724473d211` · `pi-agent-dashboard` · 2026-07-04. Source extract: deterministic facts sheet._
