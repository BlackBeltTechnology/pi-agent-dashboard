# flow-event-wiring.ts — index

Generic EventBus forwarding helpers + the `dashboard:commands-changed` resend seam. Core maps NO plugin channel: subagent and flow channels are declared by their plugin bridges via `dashboard:register-event-forward` (no `SUBAGENT_EVENT_MAP`, no `FLOW_EVENT_MAP`). Exports `registerCommandsChangedListener`, `forwardBusEvent`, `forwardedBusChannels(extraMaps)`, `registerEventBusForwarding`, `EventBusForwardingDeps`, `EVENT_BUS_MAP_FOR_TEST` (empty). See change: update-flows-plugin, move-subagents-to-plugin.

Forwarding = ONE `pi.events.on` subscription per channel in `extraMaps` (none in `bridge.ts`); returns a dispose releasing them. MUST NOT wrap `pi.events.emit`: pi gives every extension its OWN `events` facade over the shared bus, so an emit patch saw only the bridge's own emissions. `forwardBusEvent` forwards when ready+active; never throws into the emitter. See change: fix-automation-run-lifecycle.

`registerCommandsChangedListener(bc,isSessionReady)` re-sends `commands_list` on the generic `dashboard:commands-changed` bus signal (payload ignored); any plugin emits it (flows: on `flow:rediscover`/`flow:complete`). See change: update-flows-plugin (D4).
