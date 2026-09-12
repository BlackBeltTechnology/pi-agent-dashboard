# Cross-version verification — drop-final-update-on-tool-execution-end

Correctness precondition for the end-triggered drop (design D1). Answers ONCE
whether `tool_execution_end` `details` subsume the final
`tool_execution_update` `details`, per published producer version, so this is not
re-proposed on the same reasoning.

## Method (task 1.1)

`npm pack @blackbelt-technology/pi-dashboard-subagents@<v>` for every published
version, extract into a tmp dir. Five `extensions/agent.ts` + `extensions/events.ts`
pairs verified on disk:

| version | agent.ts | events.ts |
|---------|----------|-----------|
| 0.2.0 | present | present |
| 0.2.1 | present | present |
| 0.2.2 | present | present |
| 0.2.3 | present | present |
| 0.2.4 | present | present |

Extracted and diffed the four sites that determine end-vs-tail `details`:
`snapshotDetails`, `buildDetails`, `activityFromEvent`, and the three terminal
return paths (`completed` / `error` / `aborted`).

**Structural finding.** Every `details` object — initial `queued`, every
`pushUpdate` tick, and every terminal return — is built by the SAME
`snapshotDetails(status[, error])` → `buildDetails(...)` call. Tail and end thus
share one key list and one accumulator source per version. Sites confirmed by
grep in 0.2.0 and 0.2.4. `activityFromEvent` is byte-identical across all five
versions. `buildDetails`' body is identical across all five versions modulo the
two added output fields below.

## Per-version sections (task 1.2, test-plan X1)

Legend: (a) same key set modulo `undefined`; (b) keys absent-on-end /
present-on-tail; (c) keys whose JS type differs; (d) same-key-same-type value
semantically reset on the end (the only blocking finding).

Emitted key list (from `buildDetails` return):
`agentId, displayName, description, subagentType, status, activity, entries,
toolUses, tokens, tokensUsage, turnCount, durationMs, modelName, agentMdPath,
agentMdSource, error` + version deltas. Keys whose snapshot arg is `undefined`
(`maxTurns`, `tags`) vanish under JSON on BOTH sides.

### 0.2.0
- (a) Holds — tail and end both from `snapshotDetails`→`buildDetails`; identical key list.
- (b) `activity` (cleared to `undefined` by `activityFromEvent` on inner `tool_execution_end`, `return null`). `entries`/`error` grow on end only (end ⊇ tail).
- (c) None.
- (d) None blocking. `durationMs` recomputed per call (end ≥ tail); `status` running→terminal; both are the value the full fold renders (end overwrites `toolDetails` wholesale). All other values monotonic or constant.

### 0.2.1
- (a) Holds. `snapshotDetails`/`pushUpdate`/`buildDetails`/`activityFromEvent` byte-identical to 0.2.0 (the 0.2.0→0.2.1 `agent.ts` churn is outside these four sites).
- (b) `activity`; plus `entries`/`error` end-only.
- (c) None.
- (d) None blocking (same reasoning as 0.2.0).

### 0.2.2
- (a) Holds. `snapshotDetails`/`pushUpdate`/`buildDetails`/`activityFromEvent` byte-identical to 0.2.1 (0.2.1→0.2.2 `agent.ts` diff is 0 lines).
- (b) `activity`; plus `entries`/`error` end-only.
- (c) None.
- (d) None blocking. Installed version (this dashboard) — see task 1.3 note.

### 0.2.3
- (a) Holds. `buildDetails` gains `agentMdPkg` and `agentSessionId` on BOTH sides; key list still identical tail↔end.
- (b) `activity`; plus `entries`/`error`/`agentMdPkg` end-only-if-unset. `agentSessionId` is assigned once and never cleared, so it can be absent-then-PRESENT on the end (harmless; the gate's identity rule permits it, E12) but never present-on-tail/absent-on-end.
- (c) None.
- (d) None blocking.

### 0.2.4
- (a) Holds. `buildDetails` DROPS `agentSessionId` from the output and from `snapshotDetails`; both sides omit it, so the key list stays identical tail↔end. `agentMdPkg` retained.
- (b) `activity`; plus `entries`/`error` end-only.
- (c) None.
- (d) None blocking.

## Decision (task 1.4)

No version shows a key present-on-both with different JS types (c) or a
same-key-same-type value semantically reset on the end (d). The only
absent-on-end key is `activity`, which the SAME superset gate already rejects
(keysSurvive) — the accepted honest cost, spec scenario 2, pinned by replay test
F3.

No blocking finding. The D2 gate with the end-side resolver is sound: an
end-subsumed tail is dropped only when resolving the end's `data.details` /
`data.result` reproduces the folded state.

**Status: gate sound for 0.2.0–0.2.4, proceed.**

Tasks 2–4 are applicable.

## task 1.3 (test-plan X2) — DEFERRED (manual-only)

Live capture on the installed producer (0.2.2) requires a live pi with the
`Agent` tool producing a fresh `tool_execution_update` tail + `tool_execution_end`
for one `toolCallId`, read from the running dashboard's in-memory store. No
active session/store was available to capture from, and the raw session JSONL
does not persist `tool_execution_update` (bridge-level, memory-only store). This
row is `manual-only` in test-plan (X2) — deferred to manual QA. To run it: spawn
one Agent via the dashboard, `GET /api/session/:id/events`, filter by the call's
`toolCallId`, apply the D2 gate by hand, record which key (if any) blocked the
drop and the measured drop rate here.

Expected from the static read: the most common blocker is `activity`
(absent-on-end when the subagent's last inner event was a `tool_execution_end`),
so a successful Agent run often RETAINS its tail; the drop population is
non-Agent streaming tools plus Agent runs whose last inner event was not a tool
end (design Risks / Efficacy boundary).
