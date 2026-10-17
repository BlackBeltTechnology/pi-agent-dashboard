# gateway-reserved-name.spec.ts — index

Setup step 3 — the reserved-name control and its typed outcomes. Asserts the operator is TOLD the specific reason (taken vs write-failed vs invalid), that a locally-invalid name never round-trips (each submit is a real reservation on the account), and that replace is confirm-gated and names the exact URL destroyed. See change: add-zrok-custom-reserved-name.

Reserved-name control driven through the wizard Public address step (`helpers/remote-access.ts` `openAddressStep`). See change: add-remote-access-wizard.
