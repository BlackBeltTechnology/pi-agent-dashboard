---
session: 019f3b33
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [wire-nonzrok-pairing-view]
proposal_excerpt: "The `add-server-keypair-pairing` change (archived `2026-07-04`) shipped the full pairing **backend** (`/api/pair/{payload,redeem,challenge,approve,poll}` in `packages/server/src/routes/pairing-routes.ts`) and the **de…"
---

# How we did it: Wire the non-zrok pairing view — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was a single skill invocation:

```
/skill:openspec-apply-change wire-nonzrok-pairing-view
```

The *real* objective, once the change artifacts were read: the pairing **backend**
(`/api/pair/{payload,redeem,challenge,approve,poll}`) already shipped in an earlier
archived change, but nothing in the client called it. This session was the pure
**wiring pass** — build the operator-side React surface (`PairingView`) that fetches a
pairing payload, renders a QR + copyable base64url string + fingerprint + a 60s TTL
countdown, and does a typed confirm-code approval — then land it. The whole change was
**client-only, no new server route**. The second (and only other) prompt, `ship-change`,
carried it from "code complete" through PR, CI, CodeRabbit, and squash-merge.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — let the apply skill read `proposal.md` +
   `design.md` + `tasks.md` and announce the plan.
2. **Resolve the one open question deterministically** before building: the design
   already concluded "oversight," the maintainer launched the apply (confirming intent),
   and the endpoints were provably uncalled → proceed, don't stall on `ask_user`.
3. **Study the existing idioms first** — the server route shapes (`pairing-routes.ts`),
   the client tunnel-navigation pattern, the QR/`qrcode` usage, and confirm the `@mdi/js`
   icon names actually export (`node -e "require('@mdi/js')…"`) *before* writing the view.
4. Build in task order: `pairing-api.ts` (typed fetch helpers) → `PairingView.tsx` →
   mount in `SettingsPanel.tsx` Security section → `PairingView.test.tsx`.
5. Run tests under a clean HOME: `HOME=$(mktemp -d) npx vitest run <spec>` (avoids
   home-dir config bleed).
6. Quality gate: `git add -A` first (Biome `--changed` needs staging), then
   `npm run quality:changed`; fix the handful of `any` / unused-import warnings; then
   scoped `tsc --noEmit` grepped to your files.
7. Delegate `docs/` prose (architecture + faq) to a `general-purpose` subagent in
   **caveman style** (Rule 6); edit source-tree `AGENTS.md` rows yourself.
8. `ship-change` — verify gate → archive + sync delta specs (via subagent) → commit →
   push → open PR → watch CI → drain CodeRabbit → squash-merge → clean up worktree.

## 3. How the collaboration unfolded

**Phase 1 · Discovery (read the change + the codebase).**
The AI read `proposal.md`, `design.md`, `tasks.md`, then grepped the *server* pairing
route to learn the exact payload/approve shapes, the client's tunnel-navigation idiom,
the `qrcode` usage, the 60s TTL constant, and the `@mdi/js` icon exports. *Why it
worked:* wiring UI to an existing backend is 80% reading the contract you must match —
the model matched real field names (`no_reachable_endpoint`, `urls[]`, `confirmCode`)
instead of inventing them.

**Phase 2 · Build (three files + a mount).**
`pairing-api.ts` (typed `getPairPayload()` returning `{ok:false}` on
`no_reachable_endpoint` rather than throwing, and `approvePairing(code, confirmCode,
label?)`), then `PairingView.tsx` (QR + base64url copy string + fingerprint + TTL
countdown + D5/D6 empty state that never implies plain-http LAN pairing + D12 typed
confirm-code approval), then mounted it in the `SettingsPanel` Security section above
Paired Devices. *Decision point:* keep it client-only — no new server route — because
the backend already existed.

**Phase 3 · Test + quality gate.**
Four Vitest cases (empty-state navigate; QR/copy/fingerprint render; correct-code
approve → paired; wrong-code error → no pairing). Then the Biome + scoped-tsc gate.
*Decision point:* the AI correctly isolated 17 local test failures to
`pi-image-fit-extension` (a Jimp v1 API break), confirmed `develop`'s CI was green, and
treated CI — not the local jimp artifact — as authoritative.

**Phase 4 · Docs (delegated).**
`docs/architecture.md` operator-flow + `docs/faq.md` "Pairing ≠ LAN access" entry were
handed to a `general-purpose` subagent in caveman style; the per-file `AGENTS.md` rows
in `components/` + `lib/` were edited directly. *Why:* the repo's Rule 6 forbids the main
agent from writing `docs/` prose directly.

**Phase 5 · Ship (`ship-change`).**
Verify gate → delta-spec sync (delegated to a subagent, 4→6 requirements) → archive →
commit → push → PR #254 → watch CI (green) → CodeRabbit returned **1 actionable** (Enter
key bypassed the `expired` guard) + 1 typing nitpick → both fixed, re-pushed → CI green
again, no unresolved threads → squash-merge (`c79d3f89`) → worktree cleanup.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change wire-nonzrok-pairing-view`.**
  Effective because the change was already fully specified: proposal, design, and a
  task list existed, so a single skill invocation had everything it needed. *Lesson:* do
  the spec work up front; then the build prompt is one line.
- **The high-leverage follow-up — `ship-change`.**
  One word carried the change through ~10 shipping steps (verify → PR → CI → CodeRabbit
  → merge → cleanup). Effective because the shipping discipline lives in a skill, not in
  the prompt. *Lesson:* lean on `ship-change` rather than hand-driving git/gh/CI.

There were no weak prompts to rewrite — the two-prompt shape (apply → ship) is already
the strong pattern for a well-specified OpenSpec change.

## 5. Steering & corrections (what to watch for)

Only 2 user prompts — this was a low-steering session, which is itself the lesson: a
tight spec removes the need to steer. The "corrections" here were the AI's own
self-guardrails; bake them in.

| The AI tended to… | The steer / guardrail applied | Bake this in next time by… |
|---|---|---|
| Stall on an open task question (4.1/5.1) | Resolved it deterministically: design said "oversight," maintainer launched the apply, endpoints provably uncalled → proceed | State the resolution rule in `design.md` so apply never needs `ask_user` |
| Treat local test failures as blockers | Isolated the 17 failures to `pi-image-fit-extension` (Jimp v1 break), confirmed `develop` CI green, trusted CI as authoritative | Note the known jimp-env failure in the FAQ so it's recognized instantly |
| Run Biome `--changed` before staging (found nothing) | `git add -A` first, then `npm run quality:changed` | Remember: Biome `--changed` needs staged files |
| Let home-dir config bleed into Vitest | `HOME=$(mktemp -d) npx vitest run …` | Use a clean HOME for client tests |
| Write `docs/` prose directly | Delegated architecture + faq to a subagent (caveman style, Rule 6) | Always route `docs/` prose to a subagent |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session *consumed* the existing discipline
skills rather than producing new ones:

- **`openspec-apply-change`** — turned a fully-specified change into ordered
  implementation with built-in task tracking, quality gates, and the docs-delegation
  rule. Effective because it encodes the repo's build discipline (TDD, surgical changes,
  Rule 6) so the operator supplies only the change name.
- **`ship-change`** — the ~10-step land pipeline (verify → archive → sync specs → PR →
  CI watch → CodeRabbit drain → squash-merge → worktree cleanup). Effective because it
  makes the risky, error-prone shipping steps reproducible and idempotent.
- **Two `general-purpose` subagents** — one wrote the pairing docs (architecture + faq),
  one synced the `qr-device-pairing` delta specs. Effective because both are
  self-contained, isolate context, and satisfy the Rule 6 "no direct `docs/` writes"
  constraint.

*Recommendation:* nothing new to create — this workflow is already fully skill-backed.

## 7. Pitfalls & dead ends

- **Biome `--changed` finds nothing until you stage.** `git add -A` before
  `npm run quality:changed`, or the gate silently passes on zero files.
- **17 red tests that aren't yours.** `pi-image-fit-extension` fails locally on a Jimp
  v1 API/constructor break. Confirm your change doesn't touch that package and that
  `develop` CI is green; then proceed — CI is authoritative, the local jimp failure is an
  environment artifact.
- **CodeRabbit's Enter-key finding was real.** The typed confirm-code approval let the
  Enter key bypass the `expired` guard. Don't dismiss the actionable thread — localized,
  safe fixes like this are quick wins worth applying before merge.
- **Squash-merge fails the local branch switch in a worktree.** The merge tries to check
  out `develop` locally, which the parent worktree already holds. The *remote* merge
  still succeeds (PR #254 MERGED, `c79d3f89`) — verify server-side, then clean up branch
  + worktree from the parent repo, not the (now-removed) worktree.
- **Icon names before the view.** `node -e "require('@mdi/js')…"` verified
  `mdiCheckCircle`/`mdiContentCopy`/etc. exist before writing JSX — cheaper than a failed
  build.

## 8. Reproduce it faster — checklist

- [ ] Confirm the backend already exists and is uncalled (this is a wiring pass only).
- [ ] `/skill:openspec-apply-change <change>` — read proposal/design/tasks, announce plan.
- [ ] Resolve any open task question deterministically (design intent + maintainer
      launch + provable evidence) — don't stall on `ask_user`.
- [ ] Read the server route shapes + client idioms; verify `@mdi/js` icon exports.
- [ ] Build: `*-api.ts` typed helpers → `*View.tsx` → mount → `*.test.tsx`.
- [ ] `HOME=$(mktemp -d) npx vitest run <spec>` for a clean test run.
- [ ] `git add -A && npm run quality:changed`; fix `any`/unused-import warnings; scoped
      `tsc --noEmit`.
- [ ] Delegate `docs/` prose (architecture + faq) to a subagent (caveman style); edit
      source-tree `AGENTS.md` rows directly.
- [ ] `ship-change` — verify → sync specs → archive → PR → CI → CodeRabbit → squash-merge
      → worktree cleanup.

**Key inputs:** the OpenSpec change name (with proposal + design + tasks written);
`gh` auth; a green `develop` CI to compare against.
**Artifacts produced:** `packages/client/src/lib/pairing-api.ts`,
`packages/client/src/components/PairingView.tsx`,
`packages/client/src/components/__tests__/PairingView.test.tsx`, a mount edit in
`SettingsPanel.tsx`, `docs/` + `AGENTS.md` updates, and the archived change +
synced `qr-device-pairing` spec (4→6 requirements). Merged as PR #254 / `c79d3f89`.

---

_Generated from session `019f3b33` · `pi-agent-dashboard` · 2026-07-07. Source extract: facts sheet from `extract_session.ts`._
