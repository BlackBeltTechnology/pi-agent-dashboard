# denial-hold.ts — index

The one call a denial site makes (task 6.1-6.3). `installGrantCoordinator` / `holdDenial(facts, target?)` + `HoldTarget`. Reads the prompt capability FROM THE LIVE REQUEST at the site (D6), keys the requester by its capability socket or `source:<ip>`, asks the installed coordinator, and for a held denial keeps the connection alive via `awaitHold`. No coordinator installed = immediate deny, so tests and embedders see exactly today's denial. See change: add-access-grant-dialog. Capability-less channel key = `sourceChannel(ip)` (allocation, not address).
