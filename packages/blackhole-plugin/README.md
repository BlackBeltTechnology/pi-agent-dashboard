# @blackbelt-technology/pi-dashboard-blackhole-plugin

Dashboard settings surface for the [`pi-blackhole`](https://www.npmjs.com/package/pi-blackhole)
extension — unified algorithmic compaction plus observational memory.

## Surfaces

One `settings-section` claim, mounted at `/settings/plugins/blackhole`:

1. **Scalar settings** — grouped accordions over the compaction behaviour, the
   observational-memory switches, the trigger thresholds, the token budgets, and
   the runtime/diagnostic knobs.
2. **Model fallback chains** — a ranked, keyboard-operable editor for the
   `observer` / `reflector` / `dropper` chains. List position *is* resolution
   order: index 0 is `<worker>Model`, the rest are `<worker>FallbackModels`. The
   shared resolution tail (`base model → session model`) is displayed but is not
   an entry of any chain, and renders the session model as excluded when
   `sessionFallback` is `false`.

The per-session pipeline surface is **not** part of this package; it lives in the
`add-blackhole-session-pipeline` change.

## Files read and written

All under `<agentDir>/pi-blackhole/`, where `agentDir` is `PI_CODING_AGENT_DIR`
when set and `~/.pi/agent` otherwise — mirroring the extension's own resolution.

| File | Access |
|------|--------|
| `pi-blackhole-config.json` | read + write (read-modify-write) |

Writes are a read-modify-write: the server re-reads the file **within the
request**, layers only the managed keys over it, and writes temp-then-rename.
Keys the plugin does not manage — `_comment`, `_notes`, `skipForProviders`,
`dropperPoolFullnessThreshold`, anything a newer blackhole adds — keep their
values and their position in the file.

An unparseable config **fails closed**: `GET` returns a parse-error result
carrying the parser message instead of defaults, `PUT` refuses to write, and the
page renders the error plus recovery actions rather than a fabricated form.

Blackhole writes this file too (`/blackhole configure`, load-time migration) and
no cross-process lock exists. Re-reading immediately before the write narrows the
race but does not close it; the save response reports
`externalWriteDetected` rather than claiming exclusive access.

## No dependency on `pi-blackhole`

The package declares `requires.piExtensions: ["pi-blackhole"]` — an **install
prompt** for the Packages page, *not* an activation gate. An unsatisfied
`requires` leaves a plugin loaded with its claims mounted, so the settings
component renders its own not-installed state, driven by pi's installed-package
registry (`GET /api/plugins`) rather than by the presence of blackhole's
directory, which only means "has run at least once".

There is no npm or git dependency on `pi-blackhole` in any dependency section
(asserted by `src/__tests__/manifest.test.ts`). The filesystem is the entire
integration surface: blackhole re-reads its config after every write, so there is
no function to import. `src/shared/blackhole-config.ts` therefore **re-declares**
the config shape behind a `SOURCE-VERSION PIN` comment, guarded by a drift test
against a vendored snapshot of blackhole's `example-config.json`.

## Routes

| Route | Behaviour |
|-------|-----------|
| `GET /api/plugins/blackhole/config` | effective value + default + `isDefault` per managed key, the resolved path, and the unmanaged keys present in the file. `409` with a `parse-error` result when the file cannot be parsed. |
| `PUT /api/plugins/blackhole/config` | validates every submitted key against the field descriptors **before any disk access**, rejects the whole request atomically on any violation (`400`), then read-modify-writes. `409` when the file is unparseable. |

Server-side validation is the security boundary — the client form is a
convenience, and a raw `PUT` that bypasses it hits exactly the same validator.
