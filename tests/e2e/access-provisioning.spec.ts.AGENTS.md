# access-provisioning.spec.ts — index

L3 for access provisioning (change: add-access-provisioning, tasks 5.3-5.10; test-plan #F1, #F2, #F4, #F5, #F6, #X9, #X11, #X12). NOT YET VERIFIED in the harness; tasks stay unchecked until green.

- Roles: agent = `request` fixture (HTTP, no capability, can propose never settle). Operator = browser context; `openOperator` waits for the capability (Access page `access-provision-readonly` gone).
- Setup: `beforeAll` `narrowTrust` hostGate=enforce + raw in-container `accessGrants.promptEnabled`; `afterAll` restores config.json. All folders/roots under `/srv/fixtures-outside/__prov-e2e__/`, one per test (D6 per-root limits). `afterEach` revokes spec grants (real DELETE route) and dismisses leftover pending.
- D6 global limit 3 creations/10 min/process, in-memory: `ensureBudget` restarts the server (`POST /api/restart`, waits new pid) before a test that would exceed it. Test order F1,F2,F5 | F4 | F6,X9,X12 fits 2 restarts.
- F2/F4: modal provision dialog covers the Access page, so `pressBehindDialog` dispatches the click to the control (real handler + route). Proves convergence, not human reachability.
- F2 reloads B: AccessSection loads grants on mount only.
- X9: proves pending survives operator close + `409 no-operator` + reconcile for a later browser; does NOT wait the 10 min expiry (L1 #X7 covers it).
- X11/X12: real session via faux scenario `tool-read-provisioned` (`qa/fixtures/faux-scenarios.ts`); `.pi/access.json` written in-container, read back and POSTed in the skill's shape (the skill itself is prose, not run). X11 proves the profile alone gates the read; X12 approved folder silent, rejected still prompts, Access row `access-entry-via-provision` + `access-entry-requested-for`.

Summary (moved from directory AGENTS.md row): L3 provisioning F1/F2/F4/F5/F6, X9, X11, X12.
