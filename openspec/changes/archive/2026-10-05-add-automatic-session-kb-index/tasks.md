# Tasks

## 1. Headless `--index-only` mode

- [ ] 1.1 Add `--index-only` flag to `packages/session-distiller/src/main.ts` `parseArgs`. Mutually exclusive with `--apply`; error if both given.
- [ ] 1.2 In `run()`, when `indexOnly`, branch after `extractSignals` to the new `kb` sink instead of `buildRoutePlan`. Keep watermark advance identical.
- [ ] 1.3 Emit a JSON summary `{ indexed, skippedSubagent, scrubbed, malformed, newWatermark }` for observability.

## 2. `kb` sink + metadata

- [ ] 2.1 Add `Sink = "kb"` to `route.ts` and a `sinkForIndex(signal)` that maps ALL five signal classes to `kb`.
- [ ] 2.2 Define the chunk shape: body = the artifact's human text; metadata = `{ signal, sessionId, cwd, model, confidence, verified, lastSeen }`.
- [ ] 2.3 Add an ingestion entry to `packages/kb` that accepts externally-provided `{ body, headingPath, metadata }` chunks (reuse `chunker.ts` + `indexer.ts` + `sqlite-store.ts`; do NOT re-implement FTS5).
- [ ] 2.4 Namespace/tag session-derived chunks so `kb_search` can filter by `signal` and distinguish them from repo-doc chunks.

## 3. Mandatory scrub (shared module)

- [ ] 3.1 Create `packages/session-distiller/src/scrub.ts`: redact secrets/tokens/`auth.json`-shaped content (regex + entropy), PII (emails, hostnames), normalize absolute paths (`/Users/<u>/Project/<x>/…` → `<repo>/…`), drop `image` base64 blocks, strip `thinkingSignature`, truncate over-long tool output to head+tail.
- [ ] 3.2 Add a `secretScan(text): boolean` gate. The `kb` sink SHALL refuse to write a chunk when the scan flags residual secrets (fail-closed).
- [ ] 3.3 Export `scrub` for reuse by the LoRA export change.

## 4. Decoupled recurrence gate

- [ ] 4.1 In the index path, gate on `verified === true` only (single sighting is indexable). Do NOT require `N≥3`.
- [ ] 4.2 Leave the `--apply` promotion gate (`promote`, `DEFAULT_RECURRENCE`) unchanged.

## 5. Lifecycle-triggered auto-index (server)

- [ ] 5.1 Add a server subscriber that observes the existing session lifecycle (`agent_end`+`isIdle` → LiveIdle; `alive→ended` in `reattach-placement.ts` → Ended).
- [ ] 5.2 On `LiveIdle` sustained ≥ `T_idle` (default 120 s) OR `Ended`, spawn `distiller --index-only --cwd <sessionCwd>` detached/niced.
- [ ] 5.3 `Ended` triggered by a WS drop with no teardown waits `T_crash` (default 30 s) for reconnect before firing.
- [ ] 5.4 Per-session index lock so LiveIdle + Ended don't double-run concurrently.
- [ ] 5.5 File-mtime sweep (opt-in, for no-bridge sessions) as a fallback trigger; watermark keeps it incremental.

## 6. Idempotency

- [ ] 6.1 Reuse the distiller watermark so only sessions newer than the last run are processed.
- [ ] 6.2 Reuse `packages/kb` content hashing so re-indexing an unchanged/resumed session is a no-op (upsert by hash).

## 7. Subagent exclusion

- [ ] 7.1 Detect subagent-origin sessions (bridge subagent guard signal / session metadata); skip by default.
- [ ] 7.2 Add `--include-subagents` to opt in. Count skips in the summary.

## 8. Tests

- [ ] 8.1 `scrub.test.ts`: secrets/PII/paths redacted; `image` blocks dropped; `secretScan` fails-closed on a planted key; a scrubbed chunk passes.
- [ ] 8.2 `index-only.test.ts`: a fixture session with all five signal classes produces 5 kb chunks with correct metadata; re-run produces 0 new chunks (idempotent).
- [ ] 8.3 `recurrence-decoupling.test.ts`: a single verified artifact is indexed but NOT promoted to skill/memory.
- [ ] 8.4 `lifecycle-trigger.test.ts`: LiveIdle-after-`T_idle` and Ended both fire exactly one index run (lock holds); crash-grace waits `T_crash`.
- [ ] 8.5 `subagent-exclusion.test.ts`: subagent session skipped by default, included with the flag.
- [ ] 8.6 Existing `session-distiller` suite (46 tests) stays green; `--apply` path unchanged.

## 9. Documentation

- [ ] 9.1 Delegate to a docs subagent (caveman style): add a `docs/` note on the automatic session KB index (trigger model, scrub gate, `kb_search` filter by `signal`), and `ctx_index` it.
- [ ] 9.2 Update `packages/session-distiller/AGENTS.md` + `packages/kb/AGENTS.md` rows for the new files (`scrub.ts`, kb ingestion entry) directly (source tree, not docs subagent).
- [ ] 9.3 Update `.pi/skills/distill-session-knowledge/SKILL.md` to note the new automatic `--index-only` path vs. the manual `--apply` semantic-sink path.
