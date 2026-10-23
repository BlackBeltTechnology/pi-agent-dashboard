# approval-refusal.ts — index

`describeApprovalRefusal(request, {loginAvailable, configPort, hostAdmitted, localTrust?})`: pure; `null` when Host not admitted (legacy 2-key body), `device-credential` → `[]`, else ordered `authorize-browser` (transport-local + `isLauncherOrigin` Host) / `approve-on-host` / `sign-in` (thunk try/catch). Emits no request-derived value. See change: fix-pairing-approval-credential.
