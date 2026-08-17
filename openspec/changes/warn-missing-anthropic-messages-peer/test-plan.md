# Test Plan — warn-missing-anthropic-messages-peer

Stage: design   Generated: 2026-06-24

Gate resolved before writing (HARD gate, design stage): **C1** import-failure detection = literal
`import failed:` prefix match on `reason`; **C2** probe re-read cadence = poll while the section is
mounted, interval adopted from `usePiCompatibility.ts:22` (60 s) rather than invented.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 hint renders | decision-table | L1 | automated | `anthropic` row `authenticated: true`; health payload with `flows-anthropic-bridge`.`lastProbe.peers["@pi/anthropic-messages"] = {ok:false}` | section renders | hint node present, naming `@blackbelt-technology/pi-anthropic-messages`, install control present |
| E2 | R1 peer resolving | decision-table | L1 | automated | same, `{ok:true}` | section renders | no hint node |
| E3 | R3 signed-out gate | decision-table | L1 | automated | `anthropic` row `authenticated: false`; probe `{ok:false}` | section renders | no hint node |
| E4 | R4 other OAuth provider | decision-table | L1 | automated | `openai-codex` + `github-copilot` rows `authenticated: true`; probe `{ok:false}` | section renders | no hint node on either row |
| E5 | R4 API-key row | decision-table | L1 | automated | `anthropic-api` row (`flowType: "api_key"`); probe `{ok:false}` | section renders | no hint node in the API Keys list |
| E6 | R2 signal is the peer key, not status | decision-table | L1 | automated | `lastProbe = {status:"waiting_peers", peers:{"@pi/anthropic-messages":{ok:true},"pi-flows":{ok:false}}}` | authenticated anthropic row renders | no hint node |
| E7 | R2 peers key is the legacy literal | state-based | L1 | automated | probe carrying only `peers["@blackbelt-technology/pi-anthropic-messages"] = {ok:false}` (scoped key, wrong wire shape) | section renders | no hint node (client reads the legacy key only) |
| E8 | R9 import-failure withholds install | decision-table | L1 | automated | `{ok:false, reason:"import failed: Unexpected token"}` | section renders | hint reports the reason; **no** install control |
| E9 | R9 non-import reason keeps install | BVA (prefix boundary) | L1 | automated | `{ok:false, reason:"MODULE_NOT_FOUND"}`, `{ok:false}` (no reason), `{ok:false, reason:"imported failed: x"}` (near-miss prefix) | section renders | install control present in all three |
| E10 | R9 bridge/client prefix coupling | contract | L1 | automated | `peer-probe`/bridge probe forced to fail at the import step | bridge builds its status payload | emitted `reason` starts with `import failed:` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R7 clears on a fresh probe | state-transition | L1 | automated | probe `{ok:false}` → hint shown | next `/api/health` read returns `{ok:true}` | converges to no hint, no remount/reload of the section |
| F2 | R7 re-read on window focus | state-transition | L1 | automated | hint shown; server now returns `{ok:true}` | `window` `focus` event | converges to no hint |
| F3 | R7 re-read on package-operation completion | state-transition | L1 | automated | hint shown; server now returns `{ok:true}` | `pi-package-event` with `package_operation_complete`, `success: true` | converges to no hint |
| F4 | R7 first probe on an open focused tab | state-transition (timer) | L1 | automated | mounted section, health has no `lastProbe`; after mount the payload gains `{ok:false}` | advance fake timers by one poll interval, no focus/package event | hint appears |
| F5 | R7 poll stops with the section | state-transition (illegal edge) | L1 | automated | mounted section polling | unmount, then advance fake timers two intervals | zero further `/api/health` requests |
| F6 | R8 post-install latch survives the queue window | state-transition (timer) | L1 | automated | install completes successfully; probe still `{ok:false}` | advance fake timers past the queue's success auto-clear window (3000 ms) | informational "installed, applies on next session start" still rendered; install control still withdrawn |
| F7 | R8 latch releases on a resolving probe | state-transition | L1 | automated | latched informational state | later read returns `{ok:true}` | whole surface gone |
| F8 | R6 duplicate enqueue blocked | state-transition (illegal edge) | L1 | automated | install queued/running for that source | second activation of the control | exactly one enqueue for `(source, install)`; control reflects queued/running |
| F9 | R5 non-blocking | state-based | L1 | automated | hint rendered on the authenticated row | inspect the row | Sign Out enabled; Connected marker + expiry text unchanged; no dialog/modal role in the tree |
| F10 | D7 visual fit of the warning under the green Connected marker in both themes | visual/subjective | — | manual-only | providers tab, hint rendered | human looks, dark + light | [judgment: reads as "next step", not "sign-in failed" — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R2 fail-open, request rejects | fault-injection (abort) | L1 | automated | `/api/health` fetch rejects | section renders | no hint node; no unhandled rejection |
| X2 | R2 fail-open, non-OK status | fault-injection (abort) | L1 | automated | `/api/health` returns 500 | section renders | no hint node |
| X3 | R2 fail-open, still loading | fault-injection (delay) | L1 | automated | `/api/health` never settles | section renders, no timer advance | no hint node at first paint (the pre-fetch frame must not warn) |
| X4 | R2 fail-open, no bridge row | fault-injection (shape) | L1 | automated | health payload whose `plugins[]` has no `flows-anthropic-bridge` | section renders | no hint node |
| X5 | R2 fail-open, no lastProbe | fault-injection (shape) | L1 | automated | `flows-anthropic-bridge` row without `lastProbe` | section renders | no hint node |
| X6 | R2 fail-open, malformed payload | fault-injection (shape) | L1 | automated | `plugins` absent / not an array; `lastProbe.peers` absent or not an object | section renders | no hint node; no throw |
| X7 | R6 install failure is surfaced | fault-injection (abort) | L1 | automated | queue reports an error for that source | operator activated install | the source's error message is rendered inside the hint; control returns to an actionable state |

---

## Coverage summary

- Requirements covered: 9/9 (R1–R9 as numbered in `specs/anthropic-peer-hint/spec.md`)
- Scenarios by class: edge 10 · perf 0 · frontend 10 · error 7
- Scenarios by level: L1 26 · L2 0 · L3 0 · manual-only 1
- Scenarios by disposition: automated 26 · manual-only 1

**Why no L2/L3.** Every observable is client-side derivation from an `/api/health` payload shape,
which the L1 component tier reaches directly. An L3 Playwright run cannot produce the primary input:
the hint requires an *authenticated* Anthropic OAuth row, and the docker harness cannot complete a
real Claude subscription sign-in. No process/install/multi-OS behaviour is introduced, so L2 has
nothing to assert.

**No performance rows.** The change adds one polled `/api/health` read per mounted providers tab at
an existing cadence; the spec sets no latency or throughput budget, so there is no threshold to
assert against.

## New infra needed

None. `packages/client/src/__tests__/ProviderAuthSection.test.tsx` already exists as the harness
exemplar; E10 needs a probe-level unit test alongside
`packages/flows-anthropic-bridge-plugin/src/__tests__/` (existing tier, no new harness).
