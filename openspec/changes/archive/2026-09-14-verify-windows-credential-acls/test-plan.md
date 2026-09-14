# Test Plan — verify-windows-credential-acls

Stage: design   Generated: 2026-09-14   Outcome updated: 2026-09-14

The change carries tasks 5.5 / 5.6 / 12.53 from
`2026-08-24-add-pi-gateway-transport-identity`, which declared 12.53
`(test-plan: manual-only)` and archived it unfinished rather than ticking it.

**Outcome: the empirical half was obtained in CI, so M1–M3 are no longer
`manual-only`.** The parent's `infeasible` verdict was a harness bug, not a
runner limitation — the probe wrote its verdict into the session owner's `%TEMP%`
where the second user held only `(RX)` and could not traverse another profile, so
even a successful impersonation produced no output. Fixing that made the read
observable: `READ-DENIED` for all three credentials on `windows-latest`
(`ci-gateway-platform.yml` run 34823022229, job 103908680316, 4m45s, PASS).
Consequently a run that produces **no** verdict is now a hard FAIL rather than a
NOTE-and-pass.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Every credential file is examined, not just the token | decision-table (3 targets) | L2 | automated | real profile holding `local/token`, `identity.key`, `paired-devices.json` | run `qa/tests/28-gateway-windows.ps1` §4 | one `OBSERVED: … DACL` line PER file and one read verdict PER file; three verdicts reach the terminal, never one |
| E2 | An absent credential file is minted by the product's own writer, not by the arm | EP (null case) | L2 | automated | the profile holds none of the three files | run §4 | all three minted through `ensureLocalToken` / `ensureServerIdentity` / `PairedDeviceRegistry`; `paired-devices.json` net-zero (QA row added then revoked) |
| E3 | Broad-principal DACL with no empirical read cannot pass | fault-injection (capability absent) | L2 | automated | a credential file whose DACL grants `Everyone` / `BUILTIN\Users` / `Authenticated Users` | run §4 | exit 1, naming the offending file(s) — the combination that cannot be called safe |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | A second standard Windows user is refused ALL THREE credentials by the OS | fault-injection (real second principal) | L2 | automated | second local user created via `New-LocalUser`, asserted NOT in `Administrators` (hard fail if so — the test would be vacuous) | run §4 on a real Windows host | `READ-DENIED` recorded for each of `local/token`, `identity.key`, `paired-devices.json` from an actual read attempt. **OBSERVED 2026-09-14 on `windows-latest`:** all three `UnauthorizedAccessException`; files owned by `BUILTIN\Administrators`, so an owner-principal read would have succeeded — only the second user can produce a denial. |
| M3 | The arm does not read a non-verdict as a denial — and does not pass without one | state-partition | L2 | automated | a host where the impersonated run yields a verdict for only some files, or none | run §4 | the unanswered files are NAMED and the arm **FAILS**, worded as an evidence failure ("the claim went UNTESTED"), never as a leak. `READ-DENIED` is only claimed when every target has a verdict. |
| M2 | Verdict-driven remediation | decision-table | — | n/a | M1 returned `READ-SUCCEEDED` for any of the three | after M1 | **NOT APPLICABLE — M1 was DENIED for all three.** No explicit-ACL fix authored, none owed. Had a read succeeded, the fix belonged where the files are CREATED (`auth/local-token.ts`, `auth/identity.ts`, `pairing/paired-devices.ts`), never at read time. |

---

## Coverage summary

- Requirements covered: 1/1 — the MODIFIED `pi-gateway-auth` requirement. Its
  POSIX scenarios (`0600` socket, `0700` dir, cross-user connect refused) and the
  Windows token-transport scenarios are covered by
  `qa/tests/29-gateway-posix-no-tcp.sh` and `28-gateway-windows.ps1` §1–§3.
- Scenarios by class: edge 3 · perf 0 · frontend 0 · error 3
- Scenarios by level: L2 5 · n/a 1
- Scenarios by disposition: automated 5 · manual-only 0 · not-applicable 1

## Verification evidence

- `ci-gateway-platform.yml` run 34823022229, job `loopback fallback + credential
  ACLs (windows-latest)`, PASS in 4m45s. Console: `credentials minted by the
  product's own writers (3 of 3 were absent)`; three `OBSERVED: no broad
  principal … (owner BUILTIN\Administrators)` lines; three `READ-DENIED
  (UnauthorizedAccessException)` lines; `PASS … all three credential ACLs were
  observed to hold`.
- Pre-CI local verification (no Windows host in the authoring worktree): script
  parses under PowerShell 7.4.6; the REAL `$probeBody` was extracted from the
  script, substituted, and executed against a fixture of one readable + two
  unreadable files (correct per-file verdicts and partition; zero-output →
  0 leaked / 3 unanswered); the REAL mint script was extracted and executed
  under a throwaway `$HOME` (three files, mode `0600`, registry left `[]`).

## New infra needed

- none. The `qa/` VM matrix (`make build-windows` + `make test-windows`) remains
  a supported way to run this section on a private host, but is no longer
  required for the claim — `windows-latest` now yields the verdict, and the
  unfilled `vars/win-11.pkrvars.hcl` ISO placeholders were never exercised.
