# Pull the handle on the Windows credential door

## Why

`add-pi-gateway-transport-identity` shipped a local-IPC token at
`~/.pi/dashboard/local/token` and leaned on file permissions to keep it from
other OS users. On POSIX that rests on `0600` in a `0700` directory, which the
kernel enforces. On Windows **`chmod` is a documented no-op**, so the same code
path leaves the secret protected by nothing but *inherited NTFS ACLs*.

That parent change asked (task 5.5) for this to be **verified, not assumed**. It
got half an answer, and the half it got is the weaker one:

- **What is known.** `qa/tests/28-gateway-windows.ps1` runs on `windows-latest`
  in `ci-gateway-platform.yml`. It mints the token through the product's own
  `ensureLocalToken()` and inspects the resulting DACL: no `Everyone`, no
  `BUILTIN\Users`, no `Authenticated Users`; owner `BUILTIN\Administrators`.
- **What is NOT known.** The empirical read by a real second user reports
  `infeasible: the impersonated process produced no output`. A hosted GitHub
  runner gives a freshly created standard user no usable logon, so
  `Start-Process -Credential` never produces a verdict.

**The ACL says the door is shut. Nobody has pulled the handle.** An inspected
DACL is a claim about configuration; a refused read is evidence about behaviour,
and only the second one settles a security boundary.

Two adjacent files sit in the same tree under the same inheritance and were
never examined at all: `identity.key` (the server's Ed25519 private key) and
`paired-devices.json` (every paired device's bearer). If inheritance does not
hold, it does not hold for those either — and that would be a **pre-existing**
defect, older than the parent change, not something it introduced.

## What Changes

- Run the existing `28-gateway-windows.ps1` §4 on a **real Windows host** with a
  genuine second standard user (the `qa/` VM matrix, `make test-windows`), so the
  empirical read produces `READ-DENIED` or `READ-SUCCEEDED` rather than
  `infeasible`.
- Extend the same observation to `identity.key` and `paired-devices.json`.
- **If any read succeeds**: treat it as a pre-existing defect across all three
  files and fix it where the files are created — explicit ACLs on the credential
  directory rather than reliance on inheritance.
- Record the verdict in `docs/architecture.md` so the Windows trust story stops
  being an inference.

Out of scope: the POSIX path (kernel-enforced, already covered) and any change
to the token's role — it authorises a *host*, never an *instance* (D14).

## Discipline Skills

- `security-hardening` — the task is a credential-exposure question on an OS
  whose permission model the code does not actually use.
- `systematic-debugging` — if a read succeeds, the cause is inheritance from a
  parent directory nobody chose; guessing at ACL fixes without tracing that is
  how the wrong file gets patched.

## Impact

- Affected: `qa/tests/28-gateway-windows.ps1`, `qa/` VM matrix,
  `packages/server/src/auth/local-token.ts`, `packages/server/src/lifecycle/`
  (identity + paired devices), `docs/architecture.md`.
- Carries tasks **5.5, 5.6 and 12.53** from `add-pi-gateway-transport-identity`,
  which were archived unfinished rather than silently ticked.
