---
session: 019f5856
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "large facts sheet (~10292 tok)"
upgrade_status: pending
openspec_changes: [add-gateway-qr-network-selector]
proposal_excerpt: "The Gateway → **Access & QR** view (`GatewayPairQR.tsx`) renders **every** QR at once: one pairing QR for the TLS tunnel PLUS one link QR per no-TLS endpoint (localhost + each LAN address). A real deployment shows 4–5…"
---

# How we did it: Gateway single-QR network selector — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change add-gateway-qr-network-selector
```

The real objective, drawn from the change's proposal: the Gateway → **Access & QR**
view was rendering **every QR at once** — one pairing QR for the TLS tunnel plus one
link QR per no-TLS endpoint (localhost + each LAN address). A real deployment showed
4–5 QRs stacked in a confusing wall. The task was to **collapse that wall into a
single QR driven by a network selector**: pick an endpoint (radio group), see exactly
one QR, and swap the QR + context panel as the selection changes — with keyboard
accessibility and a tunnel-by-default. The steering turns then pushed the work past
"code done" into "prove it with a real browser e2e" and finally "ship it".

## 2. TL;DR playbook

1. `/skill:openspec-apply-change add-gateway-qr-network-selector` — let the apply
   skill load the proposal, tasks.md, and target component.
2. **TDD first:** write `GatewayPairQR.test.tsx` for the single-QR + selector
   behavior, run it, confirm all 7 fail against the current multi-QR code (task 1.7).
3. Rewrite `GatewayPairQR.tsx`: `NetworkSelector` radio group over all endpoints,
   one `QrCanvas` driven by the selected endpoint, context-panel swap on a single
   narrowed `pairingPayload` handle; tunnel = default.
4. **Drive down complexity** to satisfy Biome: extract `NetworkSelector`,
   `PairingApproval`, and the copy-string block into sub-components until the main
   function drops under the threshold.
5. Run the Gateway suite (green) + full quality gate; confirm all repo-wide test
   failures are **pre-existing and unrelated** (client-only diff).
6. Add a **Playwright e2e** (`tests/e2e/gateway-qr-selector.spec.ts`): stub
   `/api/tunnel/endpoints` + `/api/pair/payload` with `page.route`, assert one QR /
   tunnel default / row-switch swap, and **decode the real canvas bitmap with jsQR**.
7. Run the e2e against the Docker harness via the `PW_E2E_USE_RUNNING` fast path with
   `PW_CHANNEL=chrome` (system Chrome) — boot the container manually to dodge the 180s
   cold-build health timeout, then attach.
8. `ship-change`: mark the QA/manual task deferred, archive + sync specs, commit,
   push, open PR against `develop`, watch CI green, wait out CodeRabbit's rate-limit
   window, resolve the **semantic merge** with the overlapping change, squash-merge,
   delete branch + worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply (TDD → rewrite → simplify).** The AI read the proposal, tasks.md,
the existing `GatewayPairQR.tsx`, its shared tunnel types, and the vitest config.
There was no test file, so it wrote one first and confirmed all 7 tests failed against
the multi-QR implementation (task 1.7) before touching the component. It then rewrote
the component into a `NetworkSelector` radio group + single `QrCanvas` + panel swap.
The **effective bit**: when Biome flagged cognitive complexity (21 > threshold), the
AI didn't disable the rule — it extracted `NetworkSelector`, then `PairingApproval`,
then the copy-string block, each move dropping complexity while improving structure.
It also carefully verified that all 18 repo-wide test failures were pre-existing
(image-fit + browse-endpoint suites) and its diff was scoped to exactly 4 files.

**Phase 2 — "Can we e2e this?" (steering #1).** The human asked whether a Docker +
Playwright e2e was possible. Instead of guessing, the AI investigated the harness:
how the Gateway view is reached (`Settings → Gateway`, deep-linkable at
`/settings/gateway`), that the test container has **no real tunnel** (so endpoints
must be stubbed), and that the established suite pattern is `page.route` stubbing. It
added `jsqr` as a devDep and wrote a spec that not only asserts DOM state but **reads
the real `<canvas>` pixels and decodes them with jsQR** — proving the QR bitmap
actually scans, the strongest digital proxy for a phone scan.

**Phase 3 — Getting it green against Docker.** The bundled Chromium download kept
failing (network), but **system Google Chrome was present**, so the AI used
`PW_CHANNEL=chrome`. The managed harness's 180s health window was too short for a cold
image rebuild, so it **booted the container manually** to completion, read derived
ports from `<workspace>/.pi-test-harness.json` (dashboard 18083, gateway 19083), then
attached Playwright via `PW_E2E_USE_RUNNING=1`. Both tests passed — including the
jsQR canvas decode — and it tore down the container + straggler test containers.

**Phase 4 — "What's still manual?" (steering #2).** The human asked if the one
remaining unchecked task could be Playwright-tested. The AI decomposed task 5.3 into
sub-claims and showed most were already covered; only the **physical phone-camera
scan** and a **genuinely-live tunnel** stay manual — Playwright drives a browser, not
a phone pointed at a monitor.

**Phase 5 — Ship (steering #3: "I will test later, ship-change").** The AI ran the
ship flow: deferred the QA/manual task, archived + synced specs, committed, opened
**PR #291**, watched CI go green (10m16s). CodeRabbit was rate-limited; it waited out
the reset, requested a full review, got **0 actionable threads**. Then `develop` had
advanced with an **overlapping change (#290 "make-pairing-qr-camera-scannable")**,
producing a real conflict. The AI resolved it **semantically** — combining its
selector model with #290's scannable deep-link QR (`https://<tls>/pair#<payload>`),
updating both the unit test and the e2e to the new deep-link shape — re-ran CI green,
and squash-merged (commit `83facde3a`), cleaning up branch + worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-gateway-qr-network-selector`.
  Effective because all the intent already lived in the OpenSpec change (proposal +
  tasks.md). A single skill invocation gave the AI a complete, TDD-shaped work plan;
  no re-explaining the feature.
- **High-leverage follow-up: "Is it possible to make e2e test for that? With docker
  test and playwright?"** — a short, open question that unlocked the entire e2e layer.
  It made the AI investigate the harness rather than assume, producing a canvas-decode
  test that automates most of the manual QA.
- **"The unchecked task can be playwright tested?"** — forced an honest
  automatable-vs-manual decomposition instead of over-claiming coverage.
- **"I will test later, ship-change"** — a decisive, minimal ship signal that handed
  the AI a full known workflow (ship-change) to execute end-to-end.

Weak-to-strong rewrite: rather than "make an e2e test", the stronger form is *"add a
Playwright e2e in tests/e2e/ that stubs the tunnel/pair endpoints and decodes the
rendered QR canvas with jsQR"* — naming the harness convention up front.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "implementation complete" (18/19 tasks) | "Is it possible to make e2e test for that? With docker test and playwright?" | Make browser-level e2e part of the apply definition-of-done for client UI changes |
| Leave task 5.3 ambiguous (manual vs automatable) | "The unchecked task can be playwright tested?" | Decompose QA/manual tasks into sub-claims and mark which are Playwright-covered vs truly manual |
| Risk over-verifying before shipping | "I will test later, ship-change" | Trust the ship-change gate (CI + CodeRabbit) as authoritative; defer machine-load flakes |

Quality bars the human implicitly imposed: prove the QR **actually renders and scans**
(not just DOM assertions), and don't ship on local red without confirming it's
environmental flakiness vs a real regression.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created in this session — it was a disciplined run of
existing skills (`openspec-apply-change` → `ship-change`). But two patterns here are
strong skill candidates worth capturing:

- **"jsQR canvas-decode e2e for QR features"** — the reusable move of stubbing the
  data endpoints with `page.route`, then reading `<canvas>` pixels and decoding with
  jsQR to assert QR *content*. It removes the "does the QR actually scan?" manual step
  for any future QR/barcode UI. Invoke whenever a change renders a scannable code.
- **"Manual-boot the Docker harness + attach via `PW_E2E_USE_RUNNING`"** — the
  workaround for cold-build health timeouts and Chromium-download failures
  (`PW_CHANNEL=chrome` + read ports from `.pi-test-harness.json`). Invoke whenever the
  managed e2e run times out on a cold image or the bundled browser won't download.

## 7. Pitfalls & dead ends

- **Biome cognitive-complexity failure (21 > threshold).** Don't suppress — extract
  sub-components (`NetworkSelector`, `PairingApproval`, copy-string block) until the
  main function is under the limit.
- **`vi.mock` path + hoisting.** The first test file used a wrong relative mock path
  and missing `vi.hoisted`; fix both before trusting a "fail" result.
- **Bundled Chromium download keeps failing (network).** Use system Chrome via
  `PW_CHANNEL=chrome`, which skips the bundled-browser preflight.
- **Managed harness 180s health timeout on a cold build.** The image rebuilds
  (npm install + build) exceed the window. Boot the container manually to completion,
  read ports from `<workspace>/.pi-test-harness.json`, attach with
  `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=… PW_GATEWAY_PORT=…`.
- **Leftover `pi-dash-test` containers pile up.** Clean with
  `docker ps -aq --filter 'name=pi-dash-test' | xargs -r docker rm -f`.
- **Local `npm test` red with non-overlapping failures across runs.** These were
  load-induced flakes in unrelated server/extension suites (e.g. `expected 3023 to be
  less than 3000` — a 23ms timing miss). A client-only diff can't cause them; CI on a
  clean runner is authoritative.
- **CodeRabbit "pass / Review rate limited" is NOT a real review.** Wait out the
  reset window (~11 min), request a full review, then verify via the GraphQL
  reviewThreads query for actionable threads.
- **`develop` advanced mid-ship → semantic merge conflict.** An overlapping change
  (#290) required a hand reconciliation, not a mechanical one: combine your model with
  theirs and **update the tests to the new payload shape** (deep-link vs copy-string).
- **`gh` squash-merge branch cleanup fails in a worktree** (branch-collision pitfall).
  The remote merge still succeeds; delete the remote branch explicitly, remove the
  worktree, then force-delete the local branch.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change (`add-gateway-qr-network-selector`) with proposal + tasks.md.
- System Google Chrome installed (fallback for the bundled Chromium).
- Docker running; the all-in-one harness buildable.

**Checklist:**
1. `/skill:openspec-apply-change add-gateway-qr-network-selector`.
2. Write component tests first; confirm they fail against current code.
3. Rewrite `GatewayPairQR.tsx` (selector + single QR + panel swap); extract
   sub-components to satisfy Biome complexity.
4. Gateway suite green; confirm repo-wide failures are pre-existing; diff scoped.
5. Add `tests/e2e/gateway-qr-selector.spec.ts` (`page.route` stubs + jsQR decode);
   add `jsqr` devDep; add AGENTS.md rows.
6. Boot the Docker harness manually; attach via `PW_E2E_USE_RUNNING=1` +
   `PW_CHANNEL=chrome`; both tests green; tear down.
7. `ship-change`: defer QA/manual task → archive + sync → commit → PR vs `develop` →
   CI green → CodeRabbit clean → resolve any semantic merge → squash-merge → cleanup.

**Final artifacts produced:**
- `packages/client/src/components/Gateway/GatewayPairQR.tsx` (rewritten)
- `packages/client/src/components/Gateway/__tests__/GatewayPairQR.test.tsx` (new)
- `tests/e2e/gateway-qr-selector.spec.ts` (new)
- `openspec/changes/add-gateway-qr-network-selector/tasks.md` + AGENTS.md rows
- PR #291, merged as squash commit `83facde3a` on `develop`.

---

_Generated from session `019f5856-38d7-7b86-8a88-0efb90ab662a` · `pi-agent-dashboard` · 2026-07-13. Source extract: facts sheet (session-to-guideline extract)._
