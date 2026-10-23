# nav-intent-routes.ts — index

`registerNavIntentRoutes` — `POST /api/nav-intent` (mint for the caller's own principal; blocked url-view target → 400) and `POST /api/nav-intent/verify` → `{ok}`; behind the network guard + mutation-origin gate. See change: harden-client-sinks.
