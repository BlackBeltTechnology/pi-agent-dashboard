# __tests__/api-origin-gate.test.ts — index

Mutating-REST Origin gate L1 (#E12-#E17, #X3). Drives the REAL `createMutationOriginGate` hook on stub routes (handler spy proves "never invoked"), plus two real-server wiring checks (`POST /auth/logout` cookie NOT cleared on refusal; `/api/ws-ticket` 403). See change: fix-ws-origin-cswsh.
