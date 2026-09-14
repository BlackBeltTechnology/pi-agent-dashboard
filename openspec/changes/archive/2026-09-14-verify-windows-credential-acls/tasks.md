# Tasks — verify-windows-credential-acls

Carries tasks 5.5, 5.6 and 12.53 from `add-pi-gateway-transport-identity`,
archived unfinished. The parent change proved everything a hosted runner CAN
prove; what remains needs a host where a second user can actually log in.

Manifest: `test-plan.md`.

> **Outcome.** The observation the parent could not obtain was obtained — on
> `windows-latest`, not the `qa/` VM matrix. All three credentials are
> **OBSERVED READ-DENIED** by a genuine second STANDARD user. The parent's
> `infeasible` verdict was a **harness bug, not a runner limitation**: the probe
> wrote its verdict into the session owner's `%TEMP%` while granting the second
> user only `(RX)`, and a standard user cannot traverse another user's profile at
> all — so even a successful impersonation produced no output. Fixing that (task
> 1.3) is what produced the verdict, which also falsifies the premise the
> `manual-only` deferral rested on. All tasks below are therefore genuinely done.

## 1. Observe, on a real host

- [x] 1.1 Run `qa/tests/28-gateway-windows.ps1` on a real Windows host with a second STANDARD (never Administrator) OS user
  - **DONE on `windows-latest`, NOT via the `qa/` VM matrix.** The task's intent is a real Windows host with a genuine second standard user; that is what the arm obtains, and it is now reproducible in CI. `make test-windows` was NOT run — this worktree has no `qa/` VM built, `qa/packer/vars/win-11.pkrvars.hcl` still holds `REPLACE_WITH_`, and no Windows ISO is present. Recorded explicitly so the distinction is not lost.
  - Evidence: `ci-gateway-platform.yml` run 34823022229, job `loopback fallback + credential ACLs (windows-latest)`, 4m45s, PASS. The arm hard-fails if the second user lands in `Administrators`; there was no such failure, so the principal was standard.
- [x] 1.2 Record the §4 verdict as `READ-DENIED` or `READ-SUCCEEDED` — `infeasible` means the run did not answer the question and does not count
  - **VERDICT: `READ-DENIED` for all three.** `local/token`, `identity.key` and `paired-devices.json` each returned `UnauthorizedAccessException` from the impersonated read. Cross-check that it was the second user and not the owner: the files are owned by `BUILTIN\Administrators`, so a read by the runner's own principal would have SUCCEEDED — a denial can only come from a different, less-privileged principal.
  - ACL inspection agreed, per file: no `Everyone`, no `BUILTIN\Users`, no `Authenticated Users`; owner `BUILTIN\Administrators`.
- [x] 1.3 Extend the same read attempt to `identity.key` and `paired-devices.json`; they share the tree and the inheritance, and were never examined
  - §4 builds a three-target list, mints whatever is absent through the PRODUCT's own writers, inspects each DACL separately, and read-attempts all three in ONE impersonated run, so a surprise on the first file cannot leave the other two unexamined.
  - Net-zero mint: `paired-devices.json` is created via `PairedDeviceRegistry` and the QA row is revoked again, so a run costs an operator none of their paired devices. On the CI run all three were absent and all three were minted by the product's writers.
  - **Harness bug found and fixed.** Verdict moved from the owner's `%TEMP%` (second user granted only `(RX)`, and unable to traverse another profile) to `C:\ProgramData\qa-acl-<pid>` with `(M)` for the second user, removed in `Cleanup`. The blanket `icacls $env:TEMP /grant` loosening is gone with it. This fix is what made `READ-DENIED` observable at all.
  - Local verification before the CI run: script parses clean under PowerShell 7.4.6; the REAL `$probeBody` was extracted, substituted and executed against a fixture of one readable + two unreadable files (correct per-file verdicts, correct partition); the REAL mint script was extracted and executed under a throwaway `$HOME` (three files, mode `0600`, registry left `[]`).

## 2. Act on the verdict

- [x] 2.1 Every read is DENIED: record it in `docs/architecture.md`, and drop the `infeasible` branch from the arm's skip path
  - **Recorded** in `docs/architecture.md` § *Genuine-local trust — D10, narrowed*: Windows trust rests on inherited NTFS ACLs, **OBSERVED** on `windows-latest` (run 34823022229, 2026-09-14) via `qa/tests/28-gateway-windows.ps1` §4.
  - **`infeasible` branch DROPPED.** It used to print a `NOTE` and PASS when no verdict was produced. A hosted runner demonstrably CAN produce one, so that pass could only ever hide a broken harness. A missing verdict is now a **hard FAIL** naming the untested claim — and deliberately worded as an *evidence* failure, not a leak, so a red run is never mistaken for a security finding. The message names the three things to check: `seclogon` running, `New-LocalUser` succeeded, and the second user being able to READ and WRITE the probe directory.
- [x] 2.2 Any read succeeds: scope the fix PER FILE; explicit ACLs where the files are CREATED, never at read time
  - **NOT APPLICABLE — no read succeeded.** No ACL fix authored, and none is owed.
- [x] 2.3 If 2.2 applies, add a regression arm that fails on a broad-principal DACL
  - **NOT APPLICABLE (2.2 did not apply).** The guard anyway exists and now covers ALL THREE files: a broad-principal DACL is reported per file, and the arm fails outright when every file must be read and none could be.

## 3. Close the loop

- [x] 3.1 Update the parent change's archived note to point at the verdict
  - `openspec/changes/archive/2026-08-24-add-pi-gateway-transport-identity/tasks.md` — tasks 5.5 and 12.53 now carry the observed `READ-DENIED` verdict and the `windows-latest` evidence pointer, instead of "stays OPEN".
- [x] 3.2 `openspec archive verify-windows-credential-acls`
  - `Specs updated successfully.` → `pi-gateway-auth` synced; change archived as `2026-09-14-verify-windows-credential-acls`.
  - The delta was a LOSSY `MODIFIED` block as planned: it dropped the scenarios `Windows local bridge without the token is refused` (losing "SHALL NOT be able to register any session id") and `Local credential is not readable by other users`, and rewrote the token scenario to lose "HOME-derived location" + "constant-time comparison". `openspec archive` replaces the whole requirement block and has no override flag, so shipping it as authored would have deleted real coverage permanently. Both scenarios and all dropped clauses were restored verbatim into the delta before archiving — a strict superset: 5 original scenarios + 1 new, nothing deleted.
