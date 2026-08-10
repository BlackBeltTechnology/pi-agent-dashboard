---
session: 019f5856
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); large facts sheet (~10930 tok)"
upgrade_status: pending
openspec_changes: [make-pairing-qr-camera-scannable]
proposal_excerpt: "The device-pairing QR (`GatewayPairQR.tsx` → `encodePayloadString`) encodes an opaque `pi:pair:v1.<base64url>` string. A phone's native camera only offers to ACT on a QR whose content is a recognized actionable scheme…"
---

# How we did it: make the pairing QR camera-scannable — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change make-pairing-qr-camera-scannable`. The proposal behind it: the device-pairing QR encoded an **opaque** `pi:pair:v1.<base64url>` string, and a phone's native camera only offers to act on a QR whose content is a *recognized actionable scheme* (an `https://` URL). So the real objective — clarified as the session unfolded — was not just "reformat the QR" but "make the entire phone-pairing flow actually work end to end from a camera scan": emit a scannable `https://…/pair#<payload>` deep link, build the browser `/pair` landing that runs the real handshake, **and** give the web client a way to consume the minted device-bearer (which previously only the Electron shell could do). Two steering turns then added a real Docker+Playwright e2e and shipped the change.

## 2. TL;DR playbook

1. **Kick off with the apply skill on the named change:** `/skill:openspec-apply-change make-pairing-qr-camera-scannable`. Let the AI read every context file + the existing code before writing anything.
2. **Map the auth model first.** Have it trace how a browser-stored bearer would authenticate subsequent loads (cookie vs header vs loopback vs trusted-net). This is where the hidden scope lives.
3. **Surface the design ambiguity via `ask_user`** before coding — here, "the web client has no device-bearer consumption path; do we build the full Option A?" Pick the option explicitly.
4. **Build TDD, one lib at a time:** shared QR codec (`lib/pairing-qr.ts`) → pairing protocol (`pair-protocol.ts`) → device-auth store (`device-auth.ts`) → `PairLanding.tsx` component → wire `main.tsx` + `useWebSocket` → Electron `protocol.ts` decode tolerance. Test file before implementation each time.
5. **Run vitest with an ephemeral HOME + localStorage file:** `HOME=$(mktemp -d) NODE_OPTIONS="--localstorage-file=$(mktemp)" npx vitest run <path>`.
6. **Keep it surgical:** when you find a *second* surface with the same bug (`PairingView.tsx`), if it's out of the proposal's scope, DON'T silently change it — flag it as a follow-up memory instead.
7. **When asked for an e2e**, verify feasibility before promising: the camera scan is physical (stays manual), but everything it *triggers* is automatable. Gate a loopback-http pairing origin behind `PI_E2E_SEED` and drive the real handshake in Docker+Playwright.
8. **Ship:** update AGENTS.md tree rows directly, `openspec validate --strict`, archive+sync specs, commit via a message *file*, PR against `develop`, wait out CodeRabbit's rate-limit for a *real* review, squash-merge, clean up the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & auth mapping.** The AI read the change's context files, then grepped the client for routing, the bearer/token store, `fetch-json`, `useWebSocket`, and how the server reads auth. It discovered the pivotal fact: the paired-device bearer was consumed *only* by the Electron shell (`connect.ts`), not the React web client — so a remote phone would store a bearer and still be unauthenticated. *Why it worked:* mapping the full auth model before writing code turned a "reformat a QR" task into its true scope.

**Phase 2 — Resolve the ambiguity (decision point).** Rather than guess, the AI paused with `ask_user`: build full web-client bearer consumption (Option A) or something narrower? The human chose **Option A**. This is the single most important move — the code that followed was large but unambiguous.

**Phase 3 — TDD build.** Shared codec lib + test, pairing-protocol lib, device-auth store, the `PairLanding` browser component + test, `main.tsx` routing/fetch-wrapper install, `useWebSocket` per-connect WS-ticket minting, and Electron `protocol.ts` prefix+https-wrapper decode tolerance. A latent gap surfaced: the shell's `decodePayloadString` never stripped the `pi:pair:v1.` prefix (the copy-string was the only producer), so one task had to add both the wrapper *and* prefix tolerance.

**Phase 4 — Surgical restraint.** The AI found `PairingView.tsx` — a *second* operator surface with a duplicated `encodePayloadString` producing a *different* (bare) format. It decided **not** to unify it (out of the proposal's scope; would change behavior) and instead saved a follow-up memory. Decision point: coherence follow-up over silent scope creep.

**Phase 5 — Docs, quality, verify.** Updated AGENTS.md tree rows directly (source-tree, not `docs/`), auto-fixed Biome import ordering, split a complexity-43 `run()` into helpers, moved QR-text computation to a module-level helper to drop `GatewayPairQR` back under threshold, removed a dead `"confirm"` phase it had introduced. `openspec validate --strict` + full affected suites green (124 files, 1344 tests).

**Phase 6 — e2e (steering #1).** The human asked "can we e2e this with Docker+Playwright?" The AI investigated *before* answering: the camera scan is physical and stays manual, but the handshake is automatable. The one blocker: `pairing.ts → reachableUrls()` hard-filters to `https://`/`wss://`, so the plain-http Docker harness returns `no_reachable_endpoint`. Fix (the human chose "Option 2"): under `PI_E2E_SEED`, inject the server's own `http://localhost:<port>` origin and allow *only* a loopback-http origin past the TLS gate. A unit test proves the gate is off without the flag; a Playwright spec drives the real Ed25519 handshake against the live container and asserts the real paired-devices registry mutated.

**Phase 7 — Ship (steering #2).** "I will test later, ship change." Marked the 2 manual device-QA tasks done for post-merge verification, ran the verify gate (19 failures — all provably in *untouched* packages, a pre-existing jimp/MIME env issue), archived+synced specs, committed via a message file, opened PR #290, waited out CodeRabbit's 26-min rate-limit for a *real* (not rate-limited-ACK) review, squash-merged, and cleaned up the now-deleted worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change make-pairing-qr-camera-scannable`. Effective because the proposal already carried the scope; the skill loaded context files and tasks so the AI ground itself in real code before writing. A good kickoff for OpenSpec work is *just the apply skill on the named change* — don't re-describe the feature.
- **High-leverage follow-up (steering #1)** — *"Is it possible to make e2e test for that? With docker test and playwright?"* Short, but it unlocked a whole feasibility investigation + a real e2e. Effective because it invited the AI to *verify before promising* rather than hand-wave.
- **High-leverage unlock (steering #2)** — *"I will test later, ship change."* Four words that authorized deferring the 2 device-only manual tasks and running the full ship pipeline.
- **Implicit but crucial:** the AI's own `ask_user` on Option A/B, and the human's one-word choices ("Option A it is", "Option 2 it is"). *A future operator should expect and welcome these forks* — answering them decisively is what keeps a large change unambiguous.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the ask as "reformat the QR" and miss that the web client can't consume a bearer at all | (AI self-caught, then) asked Option A/B via `ask_user` | State up front: "the phone must be fully authenticated after pairing — verify the bearer-consumption path exists, not just the handshake" |
| Stop at unit correctness for a phone-pairing feature | *"Is it possible to make e2e test… docker + playwright?"* | Put "add a Docker+Playwright e2e for the real handshake" in the tasks from the start |
| Risk over-promising an e2e that can't simulate a camera | (asked, then) investigated the real blocker before answering | Ask "verify feasibility before promising" for anything touching hardware/physical steps |
| Consider unifying the sibling `PairingView.tsx` (scope creep) | (AI self-caught via surgical-changes rule) left it, saved a follow-up memory | Say "surgical — only files in the proposal; flag adjacent issues, don't fix them" |
| Trust CodeRabbit's rate-limited "pass" as a real review | (AI self-caught) waited out the 26-min limit for a genuine review | Remember: a rate-limited CodeRabbit is an ACK, not a review — wait for the real one |

## 6. Skills, tools & memory created — and why they're effective

No skills were created; **2 project memories** were saved:

1. **Web-client device-bearer auth path** — records that `packages/client/src/lib/device-auth.ts` stores the paired-device bearer in localStorage key `pi-dashboard:device-bearer` and that a global `fetch` wrapper + per-connect `/api/ws-ticket` minting are how the browser (not just the shell) now authenticates. *Why effective:* the next session touching pairing/auth won't re-derive the whole model from grep — the non-obvious "web client ≠ Electron shell" split is captured.
2. **Follow-up + e2e note** — flags that `PairingView.tsx` still renders a bare, non-scannable QR (a coherence follow-up), and that `tests/e2e/pairing-qr.spec.ts` drives the full real handshake in Docker (camera scan stays manual). *Why effective:* preserves the deliberate scope decision so a future reader doesn't "fix" the untouched file blindly, and points straight at the e2e entry point.

**Skill that *should* exist:** an "e2e-gate a loopback-http origin behind `PI_E2E_SEED`" recipe — inject `http://localhost:<port>` into `getReachableUrls()` and allow *only* localhost past the TLS gate, so the Docker harness can mint a real payload. This pattern is reusable for any TLS-gated feature that needs a Playwright handshake.

## 7. Pitfalls & dead ends

- **vitest crashes without an isolated HOME/localStorage.** Fix: `HOME=$(mktemp -d) NODE_OPTIONS="--localstorage-file=$(mktemp)" npx vitest run <path>`.
- **`reachableUrls()` excludes plain http**, so the Docker harness returns `no_reachable_endpoint` and there's no payload to scan. Fix: a `PI_E2E_SEED`-gated loopback-http exception (localhost is a genuine secure context; every non-localhost origin stays TLS-gated).
- **Stale Docker image served a cached build layer** — the managed run's 180s health cap timed out mid-build, and a leftover container lacked the new `isTestLoopbackOrigin`, so the run "passed" against old code. Fix: boot the container directly via `test-up.sh` (no 180s cap) to completion, then attach Playwright via the fast-path.
- **Playwright positional filter was ignored** — it ran the full 72-test suite and the cap cut it off before the alphabetically-late `pairing-qr`. Fix: target the exact spec file, not a positional substring.
- **A borderline component tipped over the Biome complexity threshold** when 2 lines were added. Fix: move computed logic to a module-level helper so the component body drops back under threshold — don't suppress the warning.
- **The AI introduced a dead `"confirm"` phase** during the state-machine work. Fix: it removed it to keep the change surgical — check for orphan states your own refactor created.
- **`git commit` with backticks in `$()`** bites. Fix: commit via a message *file* (`-F msg.txt`).
- **Local post-merge cleanup fails after the worktree is deleted** (your cwd vanishes). Fix: the GitHub squash-merge already succeeded; delete the remote branch + prune the worktree from the parent repo, then `git branch -D` locally (squash-merge means local git doesn't see it as merged).
- **Verify-gate failures in untouched packages** (`pi-image-fit-extension` jimp/MIME) are pre-existing/environmental — confirm via `git diff` that you never touched them, then proceed.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an OpenSpec change proposal naming the exact files in scope; Docker up; a system Chrome (or Playwright chromium) for the e2e; write access to `develop` + `gh` auth.

- [ ] `/skill:openspec-apply-change <change-name>` — let it read context + code first.
- [ ] Map the auth model before writing (who consumes the bearer: shell vs web client vs loopback).
- [ ] Resolve scope forks via `ask_user`; answer decisively (Option A / Option 2).
- [ ] TDD each lib: test file → implementation, run with `HOME=$(mktemp -d) NODE_OPTIONS="--localstorage-file=$(mktemp)" npx vitest run`.
- [ ] Stay surgical — flag adjacent bugs (`PairingView.tsx`) as memories, don't fix them.
- [ ] For a phone/hardware feature e2e: automate everything the scan *triggers*; gate a loopback-http origin behind `PI_E2E_SEED`; unit-test the gate is off without the flag.
- [ ] Boot the harness with `test-up.sh` (no 180s cap) and target the exact spec file.
- [ ] Update AGENTS.md tree rows directly; `openspec validate --strict`; archive+sync specs.
- [ ] Commit via `-F` message file; PR against `develop`; wait out CodeRabbit's rate-limit for a real review; squash-merge; prune the worktree.

**Artifacts produced:** `packages/client/src/lib/pairing-qr.ts` (+ test), `pair-protocol.ts`, `device-auth.ts`, `components/PairLanding.tsx` (+ test), edits to `GatewayPairQR.tsx`, `main.tsx`, `useWebSocket.ts`, `packages/shell/src/lib/protocol.ts` (+ test), `packages/server/src/pairing.ts` + `server.ts` (`PI_E2E_SEED` gate) + `pairing.test.ts`, `tests/e2e/pairing-qr.spec.ts`. Shipped as PR #290 (squash-merged `9905502`).

---

_Generated from session `019f5856` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-13. Source extract: session facts sheet (make-pairing-qr-camera-scannable)._
