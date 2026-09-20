# DOX — tests/e2e/access-grants-revoke.spec.ts

Per-file detail for one row of `tests/e2e/AGENTS.md`. Pull-only sidecar (its name is not `AGENTS.md`, so pi never auto-injects it).

| File | Purpose |
|------|---------|
| `access-grants-revoke.spec.ts` | L3 for the access-grant remedy journey (change: add-access-grants-and-review, task 8.1 / test-plan F4). Asserts the operator's journey end to end: a refused read offers a remedy → accepting it makes the SAME read admitted with NO restart → the Access tab lists the grant with its scope → revoking from the tab makes the read fail again, still with no restart. Seeds the grant via `docker exec -i <container> node` running a local script, because `POST /api/access/grants` refuses any non-loopback socket peer BY DESIGN (design D15) and a host-driven spec is exactly such a client; the in-container step still goes through the real path (trigger the refusal, take its `denialId`, submit it) rather than writing the store file, so the denial→grant binding is exercised. The probe path is deliberately non-existent: admission reads as 404 `not found` where refusal is 403 `path outside cwd`, so the two outcomes are distinguishable without creating anything on disk. The 403 precondition is asserted, not assumed — if the anchors ever widened, the spec fails loudly instead of passing for the wrong reason. |
