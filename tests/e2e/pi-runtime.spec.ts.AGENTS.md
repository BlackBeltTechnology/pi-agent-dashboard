# pi-runtime.spec.ts — index

L3 spec: version-neutral pi runtime verification vault (test-plan #F1/F2/F3/F4/#X12) — reads `piCompatibility.minimum`/`.recommended` from `packages/server/package.json` at test time, so a pi bump needs NO spec edit (the file carries no pinned-version literal). Asserts `/api/health` = pinned runtime, minimum === recommended (lockstep), no skew error/hint, and probe-agrees-with-pin (ghost-version guard). Renamed from `pi-084-runtime.spec.ts` (change: update-pi-core-0-85-adopt-apis task 9.1).
