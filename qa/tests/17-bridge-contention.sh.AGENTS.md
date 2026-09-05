# 17-bridge-contention.sh — index

L2 (test-plan #X10). Two sockets claim one session id on the pi gateway; asserts the duplicate receives `register_rejected` naming the id + reason, is closed, the incumbent stays OPEN, and `/api/health` exposes `bridgeContentionCount` + `contendedSessionIds`. Env: `DASHBOARD_PORT`, `PI_GATEWAY_PORT`. See change: fix-duplicate-bridge-registration.
