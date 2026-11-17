# oauth-open-enrolment.spec.ts — index

L3 (change: close-security-map-high-findings, D3). E110: github session cookie rejected (401 + cleared) while allowlist empty, accepted after. F5: Settings ▸ Security banner + refused login page, cleared after allowlist. F6: open browser + terminal sockets close after reload refuses github; `/auth/status` false. Restores seeded `allowedUsers` in `afterEach`.
