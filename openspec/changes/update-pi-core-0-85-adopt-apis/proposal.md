## Why

The repo pins `@earendil-works/pi-coding-agent@0.84.4`; upstream is at **0.85.1**. Two things force the bump now.

**1. `claude-fable-5-1` is unusable on Claude Pro/Max subscriptions today.** On the OAuth branch pi impersonates the Claude Code CLI, setting `user-agent: claude-cli/${claudeCodeVersion}` in `createClient` (`dist/bundle/chunks/anthropic-messages-*.js`). That constant is **`"2.1.75"` in 0.84.4** and **`"2.1.251"` in 0.85.1**. Anthropic gates `claude-fable-5-1` behind CLI ≥ 2.1.251 for subscription tokens and returns HTTP 400 `claude_code_version_too_old` below it. Verified live against a real Max token:

| model | UA `claude-cli/2.1.75` (0.84.4) | UA `claude-cli/2.1.251` (0.85.1) |
|---|---|---|
| `claude-fable-5-1` | **400** `claude_code_version_too_old` | **200** |
| `claude-fable-5` | 200 | 200 |
| `claude-opus-4-5` | 200 | 200 |
| `claude-sonnet-4-5` | 200 | 200 |

The failure is *specifically* 5.1 and *specifically* the UA version. The dashboard is not at fault and needs no workaround: `packages/server/src/model-proxy/oauth-compat.ts` `OAUTH_INCOMPATIBLE.anthropic` lists only pre-4.x snapshots, fable is not filtered, and no dashboard code constructs a `user-agent` on an **upstream model request** — the only `user-agent` writers in `packages/server/src` are `pi/pi-dev-version-check.ts:129` (pi.dev self-update check) and `auth/provider-auth-handlers.ts:199` (Copilot OAuth device flow), neither on a completion path. Every Anthropic request inherits pi's header construction through pi-ai `streamSimple`. Bumping the pin is the entire fix.

**2. The 0.85.x line carries zero upstream breaking changes.** Neither 0.85.0 nor 0.85.1 has a `### Breaking Changes` section — the first pi bump in this repo's history with none. That makes this the cheapest possible window to also close the version-gate debt that has accumulated across five prior bumps.

The target is **0.85.1, not 0.85.0**. 0.85.0 unintentionally published internal experimental code and dependencies, breaking SDK imports ([pi#9132](https://github.com/earendil-works/pi/issues/9132)); 0.85.1 reverts that and restores the `@earendil-works/pi-coding-agent/client` compatibility entry point. Landing on 0.85.0 would ship a known-broken import surface.

## What Changes

### Pin bump (atomic)

- Bump the governed pi pins to `0.85.1` — **six surfaces**: `packages/server/package.json` `dependencies`, `piCompatibility.recommended`, `piCompatibility.minimum`, `docker/Dockerfile:116` global install, `scripts/verify-release-deps.mjs:67` `minVersion` + its evidence note, and **`pnpm-workspace.yaml:47` `overrides["@earendil-works/pi-coding-agent"]`**. The override is the one that fails *silently*: under `nodeLinker: hoisted` the broad `>=0.80.10` peer ranges resolve a second, older hoisted copy that `/api/health` then reports — the ghost-version defect the 0.84 change added the override to kill. A stale override would make the fable 5.1 fix appear not to work.
- **Raise `piCompatibility.minimum` from `0.78.0` to `0.85.1` (lockstep).** This is a deliberate policy change, not a mechanical consequence — see *Modified Capabilities* and *Impact → Risk*.
- Re-resolve the lockfile with **`pnpm install`** (never `npm install` — `pnpm-workspace.yaml` sets `nodeLinker: hoisted`).

### Version-gate debt retired by the lockstep floor

With one supported pi, conditional bridge code that degrades to floor pi becomes unreachable and must be removed rather than left as dead branches:

- `packages/extension/src/agent-settled.ts` — all **nine** exports become unreachable once the floor is 0.85.1, not just the gate: `NATIVE_AGENT_SETTLED_FLOOR`, `nativeAgentSettledSupported()`, `interface SettleEvent`, `synthesizeAgentSettledEvent()`, `settleFollowUp()`, `markFloorSettle()`, `floorRetryReconcileDelay()` and the two floor-retry delay constants (plus the private `parseVersion()`). Retire the module together with its **three** `bridge.ts` consumption sites — the import (`:24`), the `piEmitsNativeSettled` activation read (`:354-357`), and the floor-retry reconciliation machine (`floorRetryWaiting` at `:2097/:2152`, the `markFloorSettle` + `setTimeout(… floorRetryReconcileDelay)` block at `:2518-2557`). That block is nested inside `if (synthSettle)`, which is `null` on native pi, so it is dead code rather than a behavior change (the `floorRetryWaiting` *assignment* at `:2152` is the exception — a dead store inside a live handler). Two consumers sit outside `bridge.ts`: `packages/extension/src/__tests__/retry-tracker.test.ts:2` imports `settleFollowUp`, and `packages/client/src/lib/chat/event-reducer.ts:1442` branches on the `retryPending` flag that only `markFloorSettle` produced — both retire with the module. See design §3 for the enumerated surface and the one accepted residual (unknown-version pi is now trusted to emit natively). This also **eliminates a latent correctness trap**: the raw major-first comparison returns `true` for any major ≥ 1, so the gate would silently mis-answer on a future pi 1.0.
- `packages/extension/src/bridge.ts` `passThroughEventTypes` + `packages/server/src/session/event-status-extraction.ts` — the "inert below floor" comments for `session_compact_failed` (≥ 0.84.3) and `ui_prompt_start`/`ui_prompt_end` (≥ 0.84.4) become factually stale. Update the comments; no behavior change (subscribing was already unconditional).

### Upstream items to adopt (all five selected for active verification, not assumed wiring)

- **GPT-6 Astra** (OpenAI API keys + OpenAI Codex subscriptions) — **design question resolved by inspecting the 0.85.1 catalog directly, not assumed.** `gpt-6-astra` is published four times, once per channel, each entry carrying its own `provider`: `openai` (api `openai-responses`), `openai-codex`, `github-copilot`, and `azure-openai-responses`. Because the Codex entry carries `provider: "openai-codex"` — the same key `internal-auth-storage.ts:34` maps and `oauth-compat.ts` filters on — **there is no provider-key remap gap and no remap is needed.** The task reduces to verifying reachability and pinning the no-remap conclusion in the spec so a future change does not "fix" it with heuristic provider matching.
- **Persistent Claude thinking effort** — supported Anthropic transports now preserve per-turn effort and recover from signed-thinking mismatches. Audit the bridge's `thinking_level_select` path (subscription `bridge.ts:2053`, handler `:2242`) and `provider-register.ts:447` `deriveSupportedThinkingLevels` for double-handling now that pi persists effort itself.
- **`SessionManager.inMemory()` restorable sessions** ([pi#8980](https://github.com/earendil-works/pi/pull/8980)) — `commit-draft-agent.ts:69-80` already calls `sdk.SessionManager.inMemory`. Audit against the new restore-externally-stored-entries API; this is the same unexported-internals surface that the 0.84 change flagged as its largest unknown, so it is re-verified rather than assumed stable.
- **RPC `abort` now cancels an in-progress manual compaction** ([pi#8920](https://github.com/earendil-works/pi/issues/8920)) — previously `abort` reported success without cancelling. Verify the dashboard abort path and the server-side `compacting` latch (cleared via `session_compact_failed` in `event-status-extraction.ts`) behave correctly now that abort genuinely cancels; a latch that only clears on the failure event may now strand on the abort path.
- **Tools honor `ctx.cwd`** ([pi#8627](https://github.com/earendil-works/pi/pull/8627)) — `bash`, `edit`, `find`, `grep`, `ls`, `read`, `write` previously ignored it. Audit the dashboard's own registered tools (`ask-user-tool.ts`, `canvas-tool.ts`, `role-model-tools.ts`) for the same bug pattern and for any behavior that depended on the old ignore-`cwd` semantics.

### Test surface

- Parameterize `tests/e2e/pi-084-runtime.spec.ts` off `packages/server/package.json` instead of the hardcoded `PINNED_PI = "0.84.4"` **and** the hardcoded `expect(compat.minimum).toBe("0.78.0")` at `:90`, so future bumps need no spec edit. Rename to a version-neutral filename.
- Update `packages/server/src/__tests__/pi-version-skew.test.ts` (`PINNED_PI`, the E1/E3 coherence assertions, and the `checkPiPinCoherence` fixture at `:60-66`, which today supplies only `dependencies` + `recommended`) for the new pin **and** the raised floor.
- Add a `"0.85.1"` row to `PI_MIN_TO_NODE_FLOOR` in `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts`. The table is keyed by the *exact* `piCompatibility.minimum` string and asserts the row exists, so the floor raise fails it even though `engines.node` is unchanged — the row is required by the lookup, not by a Node-floor move.

### Audited with no dashboard consumer (evidence recorded, no task)

Following the D5 audited-not-applicable pattern established by the 0.84 change:

- **Internal dependency restructure** — 0.85.1 drops `@earendil-works/pi-client` and `@earendil-works/pi-protocol` and adds `@earendil-works/chord`. Repo-wide grep across `packages/*/src`, `packages/*/package.json` and `scripts/`: **zero references** to any of the three.
- **`exports` map gained `./experimental/plugin`** — the dashboard imports only the root specifier (17 non-test sites — 12 static type imports plus dynamic imports in `commit-draft-agent.ts`, `command-handler.ts`, `resource-toggle-trust.ts`; no `/rpc-entry`, `/client` or `/experimental/plugin` subpath imports), so the 0.85.0 SDK-publishing regression and its 0.85.1 fix are both invisible to us.
- **`engines.node` unchanged** at `>=22.19.0` on both versions — `packages/electron/scripts/_node-version.sh::BUNDLED_NODE_VERSION` does not move. (`bundled-node-meets-pi-floor.test.ts` still needs a new `PI_MIN_TO_NODE_FLOOR` row, because that table is keyed by the floor string rather than by the Node requirement — see *Test surface*.)
- **Publishable peer ranges stay broad.** Eight publishable packages declare `@earendil-works/pi-coding-agent >=0.80.10` as a peer; they are deliberately NOT raised (design §9). The range governs standalone npm consumers of those packages, not what the dashboard server drives, and native `agent_settled` exists from `0.80.4` — below that peer floor — so retiring the synthesis does not invalidate it.
- **`packages/electron/resources/bundled-extensions/` still exists on disk** (`pi-flows`, `pi-anthropic-messages`, peer `^0.75.0`), but `eliminate-electron-runtime-install` removed the forge wiring that packaged it (`forge.config.ts:121`). Unpackaged ⇒ not a shipped pin surface ⇒ no floor anchor. (Earlier drafts of the delta spec asserted the directory itself was deleted; it was not.)
- **`typebox` unchanged** at `1.3.7` — the extension's test-fidelity devDep pin `^1.3.7` stays as the spec requires.
- TUI-only work (fullscreen transcript jump-to-latest, embedded working indicator, Alt mouse-wheel scrolling, keybinding fixes, drag-selection, Zed image detection, seccomp `SIGWINCH` startup) — documented no-ops, following the `outputPad` precedent in `pi-api-feature-detection`.
- Provider/catalog fixes with no dashboard consumer: Grok Build 0.1 removal, Qwen3.8 Flash catalog fix, Codex SSE terminal-event parsing, Copilot Fable 5 reasoning levels, Baseten GLM-5.2 image-input flag, Fireworks GLM adapter, `vllmPriority`/`supportsMaxOutputTokens`, GPT-5.6+ `prompt_cache_options.ttl`.

## Capabilities

### New Capabilities
_None. Every change lands on an existing capability._

### Modified Capabilities

- `pi-core-version-check` — the spec hard-codes `recommended SHALL be "0.84.4"`, `minimum SHALL stay "0.78.0"`, and a requirement that `minimum` is an INDEPENDENT broad-support floor which **"SHALL NOT be raised merely because tests or the pinned runtime moved"**. The lockstep decision **amends that policy requirement itself**, not just the version literals: `minimum` and `recommended` both become `0.85.1`. This is the substantive spec change in this proposal and must be written as a deliberate policy delta with its rationale (one supported pi ⇒ no conditional bridge code), not as a literal swap.
- `pi-runtime-selection` — "Floor evaluation per candidate" disqualifies the entry paths of any candidate below `piCompatibility.minimum`. Raising the floor to 0.85.1 disqualifies every 0.78–0.84 install on a user's machine.
- `pi-api-feature-detection` — the governing rule is amended (a surface guaranteed at the pin is consumed unconditionally; an unreachable *version-gated* fallback is dead code removed in the same change, while runtime probes are explicitly carved out and retained) and the 0.85.1 adoption rows are added (thinking-effort persistence, `ctx.cwd`, `SessionManager.inMemory()` restore, RPC abort/compaction, dropped sub-deps) alongside the TUI no-op entries. The `agent_settled` synthesis retirement itself lives in the `bridge-extension` delta, not here.
- `bridge-extension` — the `agent_settled` version gate and synthesis path are retired; the bridge consumes pi's native event unconditionally.
- `model-proxy-credential-routing` — records that a subscription-catalogued model is reachable without a provider-key remap (verified against the 0.85.1 catalog), that same-id entries under different providers are filtered independently, and that a client-version header gate (the fable 5.1 400) SHALL NOT be modelled as an `oauthCompatible: false` entry.
- `doctor-skill` — "Flag floor violation" now fires for any resolved pi below 0.85.1; the derived pi-resolution version tables must be regenerated (`doctor --regenerate pi-resolution`), never hand-edited.

## Impact

**Pins (must move atomically or CI gates fail — or, for the override, fail silently)** — `packages/server/package.json` (dependency + `piCompatibility.minimum` + `.recommended`), `docker/Dockerfile:116`, `scripts/verify-release-deps.mjs:67` + evidence note, `pnpm-workspace.yaml:47` `overrides`.

**Code** — `packages/extension/src/agent-settled.ts` (retire), `bridge.ts` (`piEmitsNativeSettled` at `:354-357`, the floor-retry block at `:2097`/`:2152`/`:2518-2557`, pass-through comments), `commit-draft-agent.ts`, `provider-register.ts`, `ask-user-tool.ts`, `canvas-tool.ts`, `role-model-tools.ts`; `packages/client/src/lib/chat/event-reducer.ts` (the `retryPending` branch, unreachable once its only producer is gone); `packages/server/src/session/event-status-extraction.ts`, `packages/server/src/model-proxy/internal-auth-storage.ts`, `packages/server/src/model-proxy/oauth-compat.ts` (stale no-remap NOTE only — `OAUTH_INCOMPATIBLE` itself is unchanged).

**Tests** — `pi-version-skew.test.ts`, `agent-settled.test.ts` (retire with its subject), `packages/extension/src/__tests__/retry-tracker.test.ts` (imports `settleFollowUp`), `packages/client/src/lib/__tests__/event-reducer-agent-settled.test.ts` (the two `retryPending` cases), `event-status-extraction.test.ts`, `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts` (new floor row), `tests/e2e/pi-084-runtime.spec.ts` (parameterize + rename). `pi-version-skew-recommended-0-84.test.ts` is deliberately untouched — it drives `computeCompatibility` with a synthetic range and remains the only coverage of the hint branch once the shipped hint band is empty.

**Docs** — `docker/Dockerfile.AGENTS.md` pi version (the literal is in the per-file sidecar, NOT in `docker/AGENTS.md`), the stale "inert below floor" prose in `bridge.ts.AGENTS.md` + `event-status-extraction.ts.AGENTS.md`, root `CHANGELOG.md` `## [Unreleased]`, `See change:` notes wherever gate logic is removed. All `docs/` prose is delegated to DocScribe in caveman style.

**Not affected (audited, evidence recorded)** — Electron bundled Node (`engines.node` unchanged), the extension `typebox` pin (unchanged), all subpath import surfaces (root specifier only), and the dropped `pi-client`/`pi-protocol` packages (zero references).

**Risk — concentrated in the floor raise, not the pin.** The pin bump itself is near-zero-risk: no breaking changes, no Node-floor move, no subpath exposure. The lockstep floor is the real exposure and has two distinct failure modes:

1. *User-facing hard break.* `packages/server/src/pi/pi-version-skew.ts:133-138` sets a hard `error` below `minimum`, which `PiVersionAdvisory.tsx` renders as a red panel, and `pi-runtime-selection` disqualifies below-floor candidates outright. Every user on 0.78–0.84 flips from "working" to "hard-blocked" in one release. This needs an explicit upgrade-path decision and a CHANGELOG callout, not a silent pin move. Note the block is an *advisory* — there is no 503 compatibility gate in the tree and this change adds none — and a **persisted** runtime override below the floor is not re-validated at spawn (design §10, deliberately out of scope).
2. *Runtime-only breakage from unexported internals.* Per the bump protocol, a green `npm test` with mocked catalog probes can still hide a real pi-ai symbol break, and the resource-activation write path depends on pi internals that are not exported and therefore cannot fail at build time. Re-verify all four on this bump: directory layout (`~/.pi/agent`, the `skills|extensions|prompts|themes` roots, the `<agentDir>/npm/node_modules/<name>` install root), pattern-matching semantics (`matchesAnyPattern` vs `matchesAnyExactPattern`, the excludes → force-includes → force-excludes precedence), package-identity normalisation (`getPackageIdentity`), and delta resolution (`findAutoloadDeltaBase` engaging only for `scope === "project" && autoload === false`). Run `packages/server/src/__tests__/resource-activation-toggle.test.ts` and smoke-test a real dashboard session spawn. Also re-check that the trust symbols `ProjectTrustStore` and `hasTrustRequiringProjectResources` are still reachable through the exports map — their withdrawal breaks the trust gate at runtime, not at build time.

**Out of scope** — cutting a dashboard release (that is `release-cut`), and any change to `OAUTH_INCOMPATIBLE` (fable is not filtered and must not be added; the 400 was a UA gate, not a catalog gate).

## Discipline Skills

`doubt-driven-review` (the floor raise from 0.78.0 to 0.85.1 amends a standing spec policy and hard-blocks existing users — irreversible in the release it ships in, and it must be stress-tested before it stands) · `systematic-debugging` (the `SessionManager.inMemory()` and resource-activation audits touch unexported pi internals that fail at runtime, not build time) · `security-hardening` (GPT-6 Astra reachability turns on the `openai-codex` → `openai` credential-remap gap, i.e. which credential reaches which upstream) · `review-code` (cross-package diff spanning extension, server, client tests and the docker pin) · `code-simplification` (retiring the `agent_settled` synthesis path and its version gate is a deliberate dead-branch removal, not incidental cleanup).
