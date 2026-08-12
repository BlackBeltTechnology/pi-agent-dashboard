# Root-cause verdict (tasks 1.1–1.4, design D2)

Harness rebuilt from LOCAL source (`docker compose -f docker/compose.yml build`),
port read from `.pi-test-harness.json#dashboardPort` (18296).

## Verdict

The bridge's SERIALIZED inbound pump wedges on `request_models`.

`connection.ts` `drainInbound` awaits each handler to completion.
`command-handler.ts` `request_models` awaits `reportRefresh(registry.refresh({}))`.
In the harness that refresh never settles, so the drain loop never advances:
every later browser message stays queued and is never dispatched.

## Per-leg evidence (instrumented in the running container)

| leg | result |
|---|---|
| browser → server `send_prompt` | ARRIVES (`[PROBE] enter … delivery=steer`) |
| server → bridge `sendToSession` | `result=true` |
| bridge socket `onmessage` | ARRIVES (`CONN in type=send_prompt`) |
| bridge dispatch → command handler | NEVER (`CH send_prompt` absent) |
| pump trace | `PROBE-DRAIN start request_models` with NO matching `end` |
| ack `prompt_received` | never emitted (handler never ran) → `fresh` value moot |
| `message_start` / `agent_start` | never emitted (pi never saw the prompt) |
| same session over REST (no queue involved) | DELIVERED, transcript grew, answered |

Not the ack leg, not the subscriber set, not the bridge socket: a head-of-line
block in the pump.

## Fix (task 3.2)

- `request_models` moved to `IMMEDIATE_TYPES` — a catalogue query must never sit
  at the head of the serialized lane.
- `reportRefresh` gains a bounded wait (`REFRESH_TIMEOUT_MS` 10s) so no refresh
  can block a caller indefinitely; the registry serves its last-known catalogue.

`tests/e2e/faux-text.spec.ts` and `faux-ask.spec.ts` are green after the fix,
settling via the ACK inside the 15s window (`TIMEOUT_MS` is 30s, and the failed
arm never appears).
