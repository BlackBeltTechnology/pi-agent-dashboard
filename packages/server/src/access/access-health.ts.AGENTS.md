# access-health.ts — index

`/api/health` counters (design D11, task 9.3): `snapshotAccessGrantHealth(deps)` + `AccessGrantHealth` = `prompting` {enabled, killSwitch, hostGateMode, operatorChannels}, `registry` (every transition counter, degrade and flood reasons counted SEPARATELY so per-channel starvation is told apart from the global cap, plus `pending`), `yolo` {active, source, unscoped, roots, expiresAt, cumulative autoAllowed / refusedByPriorRefusal}, `refusals`. Lets an operator tell "prompting off" / "report mode" / "rate-limited" / "YOLO answering" apart without reading logs. See change: add-access-grant-dialog.

`AccessGrantHealth.provisioning?: ProvisionStats` (`{pending, created, approved, rejected, dismissed, expired, refused, droppedResponses}`; cumulative except `pending`). Present only when `deps.provisioning()` is wired; additive, readers ignore when absent. See change: add-access-provisioning.
