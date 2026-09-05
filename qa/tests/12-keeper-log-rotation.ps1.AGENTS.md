# 12-keeper-log-rotation.ps1 — index

Windows keeper-log rotation smoke (test-plan #E16, VM cadence only — NOT a CI gate): drives real `keeper.cjs` (64 KiB cap, capture ON, mock-pi flood); asserts size drops below cap, no rename/generation, fd still live, RPC still forwarded over the named pipe. See change: fix-runaway-keeper-log-growth.
