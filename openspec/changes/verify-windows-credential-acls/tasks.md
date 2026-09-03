# Tasks — verify-windows-credential-acls

Carries tasks 5.5, 5.6 and 12.53 from `add-pi-gateway-transport-identity`,
archived unfinished. The parent change proved everything a hosted runner CAN
prove; what remains needs a host where a second user can actually log in.

## 1. Observe, on a real host

- [ ] 1.1 Run `qa/tests/28-gateway-windows.ps1` on a real Windows host via the `qa/` VM matrix (`make test-windows`), with a second STANDARD (never Administrator) OS user
- [ ] 1.2 Record the §4 verdict as `READ-DENIED` or `READ-SUCCEEDED` — `infeasible` means the run did not answer the question and does not count
- [ ] 1.3 Extend the same read attempt to `identity.key` and `paired-devices.json`; they share the tree and the inheritance, and were never examined

## 2. Act on the verdict

- [ ] 2.1 If every read is DENIED: record it in `docs/architecture.md` (Windows trust rests on inherited NTFS ACLs, OBSERVED on <host/build>), and drop the `infeasible` branch from the arm's skip path
- [ ] 2.2 If ANY read succeeds: stop treating it as this change's bug — it is pre-existing across all three files. Set explicit ACLs where the files are CREATED (`local-token.ts` and the identity/paired-device writers), never at read time
- [ ] 2.3 If 2.2 applies, add a regression arm that fails on a broad-principal DACL, so the fix cannot rot back

## 3. Close the loop

- [ ] 3.1 Update the parent change's archived note to point at the verdict
- [ ] 3.2 `openspec archive verify-windows-credential-acls`
