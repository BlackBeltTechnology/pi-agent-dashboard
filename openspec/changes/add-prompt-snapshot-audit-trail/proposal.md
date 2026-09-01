## Why

"What did the model actually see?" is currently unanswerable — by the dashboard, and by pi itself.

Investigation (session `01a03ab6`) established three facts:

1. **pi never persists it.** A scan of 3 446 session JSONL files (1.6 GB) under `~/.pi/agent/sessions` found **zero** occurrences of a stored system prompt or tool catalog. Record types are `message`, `custom`, `model_change`, `thinking_level_change`, `session`, `session_info`, `compaction`. The prompt is assembled, sent, and discarded.
2. **The model proxy cannot supply it.** `packages/server/src/model-proxy/` is an *inbound* API for external clients (`pi-proxy-*` keys, zrok tunnel, `GET /v1/models`). Dashboard-managed pi sessions talk to providers directly and never traverse it. `request-log.ts` also carries a standing policy: metadata only, no bodies. Capturing there would audit everyone except the sessions we care about.
3. **The extension API does expose it.** `before_agent_start` carries `event.systemPrompt` (the full chained prompt) and `event.systemPromptOptions.selectedTools` (the complete active tool catalog, including tools never called) — pi's docs, `docs/extensions.md:538-565`. This is a near-exact match for the audit payload, and the bridge already has the enrichment idiom for it.

So the capability is reachable, from exactly one place, and nowhere else.

## What Changes

The bridge captures the model-visible prompt state at each agent run and records it **losslessly, outside the event store**, addressed by content hash.

- **Capture.** On `before_agent_start`, the bridge assembles a snapshot: rendered system prompt, full tool catalog, and the effective model/sampling config (the bridge already enriches `model_select` with `thinkingLevel`).
- **Diff, not snapshot-per-request.** The snapshot is hashed. Unchanged since the previous run → emit the hash alone. Changed → persist the blob and emit hash plus a change kind (`initial | system | tools | system-and-tools`). This mirrors the reference implementation's `RequestPromptChange` shape, which is a *storage* strategy, not a UI convenience.
- **Blob store, not the event store.** This is the load-bearing decision. `memory-event-store` is deliberately lossy — `DEFAULT_MAX_STRING_SIZE` truncates every string field to **4 KB**, plus a 256 KiB per-event ceiling, LRU trim, and superseded-update collapse. A measured snapshot for this repo is **~60–120 KB** (`AGENTS.md` 13.7 KB + 130 skill descriptions 50.6 KB + ~45 tool schemas). Routed through the event store it would arrive **truncated to 4 KB with the middle elided** — a mutilated artifact that looks fine until someone tries to audit with it. Audit needs lossless; the event store is architecturally the opposite. Raising the caps would degrade what that store is genuinely good at.
- **Pull on demand.** The event carries only `{ hash, kind }` (~200 bytes — trivially under every cap, survives trimming). The client fetches the blob when the inspector opens, mirroring the established subagent push/pull split (`architecture.md`: intermediate ticks do not carry the cumulative payload).
- **Timing telemetry, same path.** `tool_execution_start`/`_end` give per-tool durations; `message_start` → first delta → `message_end` gives TTFT-vs-decode. These make the deferred waterfall honest.
- **Retention.** Content-addressing is what makes this affordable. The prompt changes only on skill load/unload, tool toggle, or context-file change — a handful of distinct snapshots per session, not one per request. A 200-request session: ~20 MB naive versus ~0.5 MB deduped.

## Capabilities

### New Capabilities

- `prompt-snapshot-capture`: the bridge-side hook — what is captured, hashing and change-kind derivation, what happens when a run starts before the previous snapshot is written, and behavior when capture fails (never block the agent run).
- `prompt-snapshot-store`: the lossless content-addressed blob store — layout, dedup, lifecycle, growth bounds, and eviction. Explicitly NOT the event store, and the spec must say why so a later change does not "simplify" it back in.
- `prompt-snapshot-retrieval`: the pull path — request/response contract, cache-miss and evicted-blob handling, and the guarantee that a retrieved blob is byte-identical to what was captured or is reported as unavailable. Never partial, never silently truncated.
- `request-timing-telemetry`: per-tool durations and the TTFT/decode split.

### Modified Capabilities

- `trajectory-inspector`: gains Payload and Schema tabs backed by retrieved snapshots, plus prompt-diff rendering between consecutive change records.
- `session-trajectory-view`: records gain a `Request #N` grouping, which only becomes derivable once runs are observable.

## Impact

- `packages/extension/src/` — the `before_agent_start` hook, snapshot assembly, hashing.
- `packages/server/src/persistence/` — the new blob store. Deliberately adjacent to, and independent of, `memory-event-store.ts`.
- `packages/server/src/routes/` — the retrieval endpoint.
- `packages/shared/src/protocol.ts` — the `{ hash, kind }` event and the retrieval contract.
- `packages/client/src/components/trajectory/` — Payload/Schema tabs, diff view.
- **Security — the central risk.** pi's own docs (`docs/extensions.md:1104`) flag `systemPromptOptions` as sensitive: *"may include full context file contents, so treat it as sensitive extension-local data and avoid exposing it through command lists, logs, or autocomplete metadata."* This change takes precisely that data and persists it to disk, serves it over a WebSocket, renders it in a browser, and makes it reachable through a **public zrok tunnel**. That is a material change to the dashboard's data-at-rest and data-in-transit profile. The user's decision on this proposal was *always-on, full fidelity, accepting the profile* — that decision is recorded here deliberately so it is reviewed on its merits rather than inherited silently. The blob-retrieval endpoint must inherit the dashboard's existing authorization posture with no new bypass, and tunnel exposure needs an explicit verdict before this ships.
- **Growth**: unbounded capture is a disk-growth path. The store needs a bound and an eviction policy specified up front, not discovered later — see `fix-runaway-keeper-log-growth` for what unbounded growth already costs in this system.

## Discipline Skills

- `security-hardening` — the defining concern. Sensitive prompt and context-file content newly persisted, newly served, and newly tunnel-reachable. Threat-model before implementing.
- `doubt-driven-review` — the blob-store-versus-event-store split and the always-on posture are the irreversible decisions; stress-test both before the specs stand.
- `performance-optimization` — hashing 60–120 KB on every agent run sits on the hot path. It must not delay a run; budget it.
- `observability-instrumentation` — capture failures, dedup hit rate, store growth, and retrieval misses all need to be diagnosable. "The payload tab is empty" must have a readable cause.
- `review-code` — spans extension, server, shared, and client.
- `systematic-debugging` — content-addressed dedup with a lossy neighbour store is fertile ground for guess-and-fail; evidence first.
