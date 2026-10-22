# pi-trust-live-query.ts — index

Browser-safe wire types for `POST /api/pi-trust/query`. `validatePiTrustQueryBody` (body ≤8 KiB, cwd absolute, no NUL, ≤4,096 chars), `parsePiTrustLiveAnswer`, `PiTrustLiveAnswer` (local: key+sourceKind+dev+ino[+birth]; remote: salt+digest only). See change: mirror-dashboard-trust-live-remote.
