## Context

See proposal.md - Why. Two refresh paths in the bridge:
- `credentials_updated` (`bridge.ts`): `reloadProviders(pi)` -> scoped `refresh({providers: touched})` -> push `models_list`. Skips refresh when `touched` empty.
- `request_models` (`command-handler.ts`): `authStorage.reload()` -> `refresh({})` -> return `models_list`. Never calls `reloadProviders`.

pi `ModelRuntime.refresh()` reloads `models.json`, rebuilds providers, recomputes availability from credentials. `registerProvider`/`unregisterProvider` update the snapshot synchronously. Spike: full local refresh ~6 ms.

## Goals / Non-Goals

**Goals:** selector open self-heals any missed broadcast; credential-only change updates the list immediately.

**Non-Goals:** file watchers on `providers.json`/`auth.json`; broadcast replay/ack; server `/v1/models` registry; client changes.

## Decisions

- **D1 Re-diff on open.** `request_models` awaits `reloadProviders(pi)` before refresh. Diff is idempotent (no-op when snapshot matches), costs one JSON read. Alternative: fs watcher per bridge — rejected, adds lifecycle + cross-platform watcher quirks for a case the selector-open path already covers. Needs `pi` (ExtensionAPI) reachable from command-handler options — pass a `reloadProviders` callback via existing options bag rather than importing `pi`.
- **D2 Full local refresh when diff empty.** `credentials_updated` with empty `touched` runs `refresh({allowNetwork:false})`. Changed provider is unknown (auth.json diff not tracked), so scoping is impossible; existing "Scoped provider refresh" scenario applies only when the provider is known. Removal-only diffs also take this path (harmless, sync unregister already applied).
- **D3 Local-only on open.** `request_models` uses `refresh({allowNetwork:false})`. Selector open runs on the serialized bridge pump; a cold catalogue cache would otherwise fetch every provider's remote catalogue each open (bounded only by 10 s `REFRESH_TIMEOUT_MS`). Remote catalogue refresh remains at session start.

- **D4 Serialize `reloadProviders`.** `request_models` is an IMMEDIATE (unpumped) type, so it can interleave with `credentials_updated` and other opens. `registerEntry` records `lastRegistered` before awaiting discovery, so an overlapping call would see "no diff" and push a list missing the in-flight provider. Chain calls through a module-level promise: each caller awaits its own run, which starts after the previous completed. Alternative: share one in-flight promise (single-flight) - rejected, a caller arriving mid-run could miss a file change written after that run's read.
- **D5 Custom-provider discovery on a real diff only.** Registering an added/changed custom provider fetches its `<baseUrl>/models` (10 s timeout). Permitted on selector open only when the re-sync finds a diff (the missed-broadcast heal); unchanged `providers.json` makes zero requests. pi remote catalogues stay off (D3).

## Risks / Trade-offs

- [`reloadProviders` re-registration triggers pi's internal `void refresh()`] -> only on a real diff; same as today's broadcast path.
- [D3 hides newly published remote models until session restart] -> acceptable; was never a selector-open guarantee. Revisit if users ask.
- [`reloadProviders` throws] -> catch + log, continue with refresh (degraded, never broken; matches `reportRefresh`).
