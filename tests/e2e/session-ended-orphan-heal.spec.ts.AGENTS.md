# session-ended-orphan-heal.spec.ts — index

L3 #F6/#F7: a session SIGKILLed mid-`Agent` heals live (synthesized `tool_execution_end`/`subagent_failed` with `healedBy:"session_ended"` on the wire, card leaves `running`, session `ended`) and after `POST /api/restart` + cold transcript hydration (still an error card reading `parent session ended`). Kill via the `force_kill` control message, not heartbeat grace expiry — same `onEnded` seam, minutes cheaper. See change: heal-orphaned-tool-cards-on-session-end.
