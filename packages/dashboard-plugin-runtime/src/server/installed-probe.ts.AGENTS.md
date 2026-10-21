# installed-probe.ts — index

`createIsPiExtensionInstalled({listGlobal, listLocal, now?, ttlMs?})` — host factory for the `isPiExtensionInstalled` capability (design D2). Answers from the UNION of global+local scopes (superset of the probe's global-only wiring), matched with `installedMatchesName` (id/name/displayName/source incl. `sourcesMatch`). Boolean-only; success-only cache (~30s TTL, mirrors `requirement-probes.ts`); a scan failure REJECTS — never resolves `false` — and is never cached. See change: add-blackhole-session-pipeline.
