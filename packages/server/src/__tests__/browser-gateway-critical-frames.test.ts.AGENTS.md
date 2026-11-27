# __tests__/browser-gateway-critical-frames.test.ts — index

Bounded critical-frame delivery suite (E1–E6, X6, P1): pending-prompt replay exempt past MAX_WS_BUFFER under the 4-frame cap + 5 MB ceiling; transcript/notify still shed; split drop counters; real gateway + `DrainingFakeWs` with a control-run delta. See change: fix-pending-prompt-lost-on-replay.
