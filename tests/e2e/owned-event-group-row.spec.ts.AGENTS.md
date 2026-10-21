# owned-event-group-row.spec.ts — index

L3 #F4. Subagents plugin toggled off; 40 synthesized owned `subagent_tick` WS frames (`{type:"event",sessionId,seq,event}`) pushed through `page.routeWebSocket` → ONE collapsed "N type events — … plugin unavailable" row, 0 `<pre>` until expand, 40 on expand. `subagent_tick` because core still consumes `subagent_entry` until Phase 3 (swap `OWNED_TYPE` then). Plugin re-enabled in `finally`. Written, not yet run (needs docker harness). See change: decouple-plugins-from-core.
