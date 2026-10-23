# csp-violations-routes.ts — index

`registerCspViolationRoutes` — `POST /api/csp-violations` (network guard, 8 KiB, schema, per-principal burst 3 + 12/min → 429, unknown fields dropped, rejected bodies never logged) and `GET` counters (LRU 500). See change: harden-client-sinks.
