# Design — bump-pi-compat-to-0-78

## Context

Three pi minor releases shipped after the dashboard's 0.75 floor proposal: `0.76.0` (2026-05-27), `0.77.0` (2026-05-28), `0.78.0` (2026-05-29). The earlier `bump-pi-compat-to-0-76` proposal was drafted but never merged. This change supersedes it and jumps the floor straight to `0.78.0`.

The window contains zero Breaking Changes against the dashboard's exposed surface. The deltas are exclusively additive features, provider/terminal fixes, and one positive side effect for the bridge (SIGTERM/SIGHUP cleanup). See proposal.md "Why" for the inventory.

## Decision 1 — Single 0.75 → 0.78 hop, not three chained bumps

Three options were considered:

| Option | Diff size | Review surface | Rollback granularity |
|---|---|---|---|
| chain 0-76 → 0-77 → 0-78 | 3 PRs × manifest edits | 3× the bookkeeping | one minor per revert |
| revive 0-76, draft 0-77 on top | 2 PRs | 2× bookkeeping | 0.76 vs. 0.77+0.78 split |
| **single 0.75 → 0.78 hop (chosen)** | 1 PR | minimal | revert returns to 0.75 |

The 0-76 proposal never reached `develop` (verified: `develop` HEAD pins `^0.75.0` everywhere). Reviving it adds zero signal over jumping straight to 0.78 — same files, same shape, just an outdated version number. Chaining creates phantom review work for unshipped artifacts.

If a future 0.78.x regression makes us want to step back, reverting this PR returns the codebase to the 0.75 floor, which has the largest user-coverage anyway. We never gain anything by holding a 0.76 intermediate.

## Decision 2 — Lift floor and recommended together to 0.78.0

The 0.78 line currently has only `0.78.0`. The `pi-core-version-check` spec rule "`recommended` SHALL be no more than one minor release behind the latest published" allows `0.77.0` or `0.78.0`. We pick `0.78.0` for lockstep with the floor — avoids the `minimum > recommended` edge case in the upgrade-hint banner state.

When a `0.78.x` patch ships, a follow-up bumps `recommended` only (not floor) to surface the soft upgrade hint without forcing pi 0.78.0 users into a hard error. Same dial as in prior bumps.

## Decision 3 — No Node engines change

Pi 0.76 / 0.77 / 0.78 all inherit the 0.75 Node floor of `>=22.19.0`. The dashboard's root `engines.node` (`>=22.19.0 <25`), server `engines.node` (`>=22.19.0`), and `node-guard.ts::isAffectedNode` (refuses `22.x < 19`) all remain correct as-is.

The lookup table in `bundled-node-meets-pi-floor.test.ts` still needs three new rows (`0.76.0`, `0.77.0`, `0.78.0`) — that's a documentation table tracking "which pi version requires which Node floor," not a runtime guard. All three rows map to `{ major: 22, minor: 19 }`.

## Decision 4 — Bundled-extension peer-deps move in lockstep

Per the spec requirement established in `bump-pi-compat-to-0-75`, `piCompatibility.minimum` SHALL match the bundled-extension peer-dep constraints. Three bumps:

- `pi-anthropic-messages/package.json` peer `>=0.75.0` → `>=0.78.0`
- `pi-flows/package.json` peer + dev for `pi-ai`, `pi-coding-agent`, `pi-tui` `^0.75.0` → `^0.78.0`

The catch-all grep covers any bundled extension that landed between this change and the previous one.

## Decision 5 — Defer adoption of new 0.76 / 0.77 / 0.78 surface

The window introduced these opt-in affordances (none consumed by this change):

| Pi version | Surface | Adoption owner |
|---|---|---|
| 0.76 | `--session-id <id>` CLI flag | follow-up: unify bridge+pi session IDs at spawn |
| 0.76 | RPC `excludeFromContext` on `bash` | not relevant — dashboard's RPC keeper sends only `prompt`, not `bash` |
| 0.77 | `--exclude-tools` / `-xt` CLI flag | follow-up if dashboard wants per-session tool gating |
| 0.77 | `InputEvent.streamingBehavior` | **`surface-input-streaming-behavior` (sibling proposal)** |
| 0.77 | `pi.getAllTools().promptGuidelines` | follow-up if dashboard wants per-tool guideline display |
| 0.78 | `--name` / `-n` CLI flag | follow-up: pre-set session name at spawn (currently set post-spawn via `setSessionName`) |
| 0.78 | exported `convertToPng`, `parseArgs`, type `Args` | follow-up if bridge wants the helpers |

Folding any of these into the floor-bump bloats the diff with feature work whose design rationale is independent of "track latest pi." Each gets a follow-up proposal if user value justifies the work.

## Decision 6 — `pi.dispatchCommand` still not in 0.78 ExtensionAPI

Verified against `node_modules/@earendil-works/pi-coding-agent@0.78.0/dist/core/extensions/types.d.ts` (line 785 onward). The `ExtensionAPI` interface does not expose `dispatchCommand`. The bridge's Path B (`hasDispatchCommand(pi)` in `slash-dispatch.ts:101`) remains dead code at 0.78. The blocking proposal `retire-rpc-keeper-when-dispatchcommand-available` (Phase 0: upstream PR) is therefore **not unblocked** by this bump. No change to that proposal's status.

## Decision 7 — 0.77 RPC bash disposal-abort is not a dashboard exposure

The 0.77 changelog notes "Fixed session disposal to abort in-flight agent, compaction, branch summary, retry, and bash work." The "bash work" portion targets pi's RPC mode `type: "bash"` command (`rpc-types.d.ts:82`) — for hosts driving pi as an RPC client and sending bash commands over the protocol.

The dashboard does not use this channel for bash:

- The dashboard's RPC keeper (`packages/server/src/rpc-keeper/dispatch-router.ts:46`) sends only `type: "prompt"`. No `bash` type is ever written to the RPC socket.
- User-typed bash (`!cmd` / `!!cmd`) goes through `pi.exec("sh", ["-c", command], …)` in `command-handler.ts:660`. That's an in-process ExtensionAPI call governed by the bridge's existing `session_shutdown` / `isActive()` lifecycle — not the RPC channel.

Conclusion: zero behavioral risk to the dashboard from this fix.

## Risks

- **0.78.0 regression discovered post-merge**: If a critical bug surfaces in 0.78.0, pi 0.75/0.76/0.77 users blocked by our floor have no path forward except waiting for 0.78.1. Mitigation: keep `recommended` mobile — bump it to `0.78.1` independently without forcing the floor.
- **Bundled-extension peer-dep mismatch**: a fresh install of a bundled extension against host pi 0.75.x / 0.76.x / 0.77.x fails peer-dep resolution. Intended bite of the floor.
- **Three-minor-jump user friction**: users on 0.75 jump two minor versions to satisfy the new floor. Mitigation: changelog entry calls out the supersession of the unshipped 0-76 proposal so the version gap reads as deliberate, not an oversight.

## Rollback

Revert the three manifest edits + the three `bundled-node-meets-pi-floor.test.ts` table rows. No persisted state to clean up. Returns the codebase to the 0.75.0 / 0.75.5 floor in one commit.
