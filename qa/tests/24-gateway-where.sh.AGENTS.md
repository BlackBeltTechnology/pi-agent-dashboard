# 24-gateway-where.sh — index

L2 (test-plan #F7 → task 12.43). Spawns a REAL pi session in a throwaway `$HOME` with `keeperLog.capturePiOutput` on, sends `/dashboard-where` as a prompt, and reads the reply out of `keeper-<transport>.log` — the same switch an operator needs, since the handler writes to pi's stderr. Asserts all three facts: the endpoint names this instance's socket, `instance:` equals `/api/health.instanceId` (explicitly rejecting `unverified`), and a socket-pinned session reports `pinned: yes`. Skips when `pi` is absent. See change: add-pi-gateway-transport-identity.
