# DOX — packages/server/src/acp-bridge

Files in this directory. One row per source file. ACP session driver (transport-agnostic core + hosts) — only test scaffolding exists so far. See change: add-acp-session-driver.

| File | Purpose |
|------|---------|
| `__tests__/fake-acp-agent.d.mts` | Types for `fake-acp-agent.mjs`: `FakeAgentKnobs`, `runFakeAgent`. |
| `__tests__/fake-acp-agent.mjs` | Scripted fake ACP agent (NDJSON JSON-RPC). `runFakeAgent({input, output, protocol 1\|2, knobs, fixture?})` in-process, or CLI `--protocol --knobs '<json>'`. Replays shared `querymt-v{1,2}.json`. Knobs: delayMs, withhold[], echoUser before/after/none, nonJson, longLine, rejectPrompt, requestFs, hostileSessionId, unknownVariant, permission, initializeVersion, acceptedMessageId. Deterministic. |
| `__tests__/fake-acp-agent.test.ts` | Self-test of the fake: handshake, v1/v2 turn shape, determinism, every knob. In-process PassThrough (no child process). |
