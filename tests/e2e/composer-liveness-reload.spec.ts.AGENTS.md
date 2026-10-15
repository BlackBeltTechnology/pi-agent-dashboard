# composer-liveness-reload.spec.ts

L3 composer liveness after reload. Synthetic bridge (register + `session_heartbeat{agentRunning:true}`, no `agent_start`) → server `streaming` / reducer `idle`; reload; asserts Stop + card + StatusBar + mobile strip agree, Stop / stop-after-turn reach the bridge, transcript not fabricated, active→streaming + streaming→idle heals, dropped `agent_end` frame, ended never shows Stop, real faux run ends with Send. Gateway port from `/api/health`. See change: fix-composer-liveness-on-reload.
