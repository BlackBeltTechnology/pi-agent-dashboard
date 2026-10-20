## Context

`packages/hermes-memory-plugin` mirrors the external `pi-hermes-memory`
`MemoryConfig` without depending on it (design D3 of
`add-hermes-memory-settings-plugin`; pin comment at
`packages/hermes-memory-plugin/src/shared/hermes-config.ts:11`). The installed
extension is `pi-hermes-memory@0.9.10`
(`~/.pi/agent/npm/node_modules/pi-hermes-memory/package.json`).

Current write path (paths relative to `packages/hermes-memory-plugin/`):

- Client `buildResolvedConfig` iterates `KNOWN_KEYS` only and emits every known
  key's effective value — overridden value, else the default — skipping keys
  with an `undefined` default and empty overridden strings
  (`src/client/settings-model.ts:78`). So every save writes every defaulted
  field, and after one save every field reads `isDefault: false`.
- PUT validates the body (`validateHermesConfig`, unknown body keys → 400,
  `src/shared/hermes-config.ts:217`) then writes the **body verbatim** over the
  file (`src/server/index.ts:64`, `writeResolvedConfig` at
  `src/server/config-io.ts:69`). Any on-disk key outside `KNOWN_KEYS` is lost.
- `readRaw` maps absent, unreadable (the `readFileSync` is inside the `try`),
  malformed and non-object JSON all to `{}` (`src/server/config-io.ts:30`).
- GET `raw` is built from `KNOWN_KEYS` only (`src/server/config-io.ts:53`).
- The raw-JSON dialog renders the client's `buildResolvedConfig(values,
  overridden)`, not GET `raw` (`src/client/HermesMemorySettings.tsx:264`).
- The client treats `isDefault: false` as overridden and sends the on-disk
  value; for `isDefault: true` it sends `DEFAULTS[key]`
  (`src/client/HermesMemorySettings.tsx:65-68`, `settings-model.ts:78`).
- Compose + write are synchronous; the PUT handler has no `await` before the
  write (`src/server/index.ts:54-65`).
- Field labels/help live in `src/client/field-groups.ts` as presentation data,
  explicitly NOT i18n keys (`src/i18n.ts:11`).
- An inline `EXPECTED_KEYS` list asserts `KNOWN_KEYS`
  (`src/shared/__tests__/hermes-config.test.ts:13`, assertion `:77`).

Upstream facts, 0.9.10 (`pi-hermes-memory/src/`):

- `THINKING_LEVELS` adds `"max"` (`config.ts:29`).
- Constants (`constants.ts:37-84`): `DEFAULT_CONSOLIDATION_TIMEOUT_MS = 180000`
  (0.8.1: `60000`), `DEFAULT_CONSOLIDATION_CHUNK_CHARS = 4000`,
  `CONSOLIDATION_CHUNK_CHARS_MIN = 500`, `DEFAULT_OVERFLOW_GRACE_MS = 180000`,
  `DEFAULT_SESSION_RETENTION_DAYS = 0`, `DEFAULT_FLUSH_COMPACT_TIMEOUT_MS = 60_000`.
- `loadConfig` accepts `flushCompactTimeoutMs` as any finite number, with `<= 0`
  meaning disable. `overflowGraceMs` and `sessionRetentionDays` accept any
  finite number `>= 0`, fractions included. `consolidationChunkChars` is
  ignored below 500.
- An explicit `memoryOverflowStrategy` wins over `autoConsolidate`; without it,
  the strategy is derived from `autoConsolidate` (`config.ts:234-237`).
- `llmModelOverride` may also be a string array (first entry = primary, rest =
  fallbacks). `llmModelFallbacks` and `fallbackModels` are legacy aliases of
  `llmFallbackModels` (`config.ts:205-225`).
- The extension only reads the file; it never writes it.
- `paths.ts` is byte-identical between 0.8.1 and 0.9.10 (checked via
  `npm pack pi-hermes-memory@0.8.1`).

## Goals / Non-Goals

**Goals:**
- Field set, enums, defaults and accepted bounds equal 0.9.10, or are stricter
  and documented.
- A dashboard save never drops an on-disk key the plugin does not know.
- Upstream default changes reach users who saved from the dashboard.
- An inconsistent re-mirror (keys or defaults edited in one place only) fails
  a test.

**Non-Goals:**
- Depending on `pi-hermes-memory`.
- Validating unknown on-disk keys.
- Form fields for the legacy aliases or for array-form `llmModelOverride`.
- Locking against concurrent dashboard PUTs (last write wins, unchanged).
- CI-side detection of a *new* upstream release. The drift guard catches
  inconsistency; a local-only check catches mismatch against the installed
  tree (D5).

## Decisions

### D1 — Written object = preserved unknown keys + non-default body fields

The server composes the written object from the on-disk object `disk` and the
validated body:

1. `unknown` = own entries of `disk` whose key is NOT in `KNOWN_KEYS`. They are
   copied as-is.
2. `known` = body entries, except:
   - those whose value JSON-equals its `DEFAULTS` entry;
   - an empty `llmFallbackModels` array (upstream treats `[]` as unset).

   `memoryOverflowStrategy` is exempt and always written when present (see
   below).
3. Legacy heal (D6) may drop `consolidationTimeoutMs`.
4. Written = `{ ...unknown, ...known }`.

A known key absent from the body, or equal to its default, is never carried
over from `disk`. This keeps *Clear to inherit* and per-field reset working:
an omitted key reads back as absent. It also stops pinning defaults, so an
upstream default change flows through. Rejected alternatives:

- Full merge `{ ...disk, ...body }` resurrects cleared overrides.
- Client-side omission is skipped by any other PUT caller.

**`memoryOverflowStrategy` exemption:** upstream derives the strategy from
`autoConsolidate` only when the strategy is absent. If the default
`"auto-consolidate"` were omitted next to `autoConsolidate: false`, the
effective strategy would flip to `reject` while the form still showed
auto-consolidate. Always writing the strategy keeps it authoritative, matching
the form and today's behaviour (write-all always wrote it).

**Legacy `autoConsolidate`-only files (GET derivation):** when the on-disk
file has no `memoryOverflowStrategy` but a boolean `autoConsolidate`,
`readEffectiveConfig` reports `fields.memoryOverflowStrategy` as
`{ value: autoConsolidate ? "auto-consolidate" : "reject", isDefault: false }`,
mirroring upstream `config.ts:236-237`. Conversely, when a **valid**
`memoryOverflowStrategy` is on disk, `fields.autoConsolidate` reports
`value: strategy === "auto-consolidate"` (`isDefault` stays `true` only when
`autoConsolidate` is absent on disk and the derived value equals the default,
so a no-touch save pins nothing — test-plan E14), mirroring
`config.ts:234-235`, so the toggle never shows a value upstream overrides. An
on-disk strategy outside the enum is reported verbatim; no derivation runs,
and it falls under R4. The client then treats it as
overridden and sends the derived value, so a no-touch save keeps the effective
strategy instead of flipping `reject` to `auto-consolidate`. The
`autoConsolidate` toggle is otherwise ignored upstream whenever a strategy is
present. Its help text says so: "Legacy alias — ignored while Overflow
strategy is set". Removing the control would modify the *every field renders*
requirement, so it stays (R9).

Trade-off: a user can no longer pin a value equal to today's default to guard
against a future upstream default change. Rejected: no form affordance existed
for that intent.

The pure compose function lives in `config-io.ts`. Invariant: compose and
write stay synchronous (no `await` between the disk read and the rename), so
in-process PUTs cannot interleave.
`writeResolvedConfig(filePath, body)` reads `disk`, composes, then does the
atomic write unchanged. The route stays validate→write.

### D2 — Body boundary unchanged; preserved keys come only from disk

- Unknown keys in the PUT **body** still 400 (existing *Reject invalid config*).
  The preserve path cannot smuggle a key: preserved keys originate only from
  the file already on disk, never from request input.
- Preserved values are not validated; hermes owns their meaning.
- **Prototype safety (write AND read):** `unknown` is built with
  `Object.fromEntries(Object.entries(disk).filter(…))`, then merged by object
  spread. Both define own data properties (CreateDataProperty), so an on-disk
  `"__proto__"` key round-trips as data. Plain assignment (`out[k] = v`) is
  forbidden: it invokes the `__proto__` setter and silently drops the key.
  Verified in Node. The same rule applies to GET `raw` (D4), so GET and PUT
  agree. This deliberately departs from `system-one-config`, which *drops*
  `__proto__` keys: that file is dashboard-owned, while this file is
  hermes-owned and the dashboard must not delete its content (R10).
  Tests must build `__proto__` fixtures from JSON text (`JSON.parse`) or
  `Object.fromEntries`, never from an object literal (a literal sets the
  prototype).
- "Preserved" means JSON-value round-trip. Formatting, key order and
  non-representable numbers (`1e400` → `null`, integers > 2^53) are not
  byte-identical (accepted).

### D3 — Unreadable vs malformed on-disk file

One strict read helper serves both GET and PUT; the catch-all `readRaw` and
its `existsSync` pre-check are retired. The helper calls `readFileSync` in a
`try` and branches on `err.code`. It returns the bytes it read, and any
quarantine copies **that buffer**, never a re-read (read→copy TOCTOU), as the
server helper does:

- **`ENOENT`** → `disk = {}`, `exists: false`.
- **Any other read error** (`EACCES`, `EIO`, `EISDIR`, …) → HTTP 500 on GET
  **and** PUT, with body
  `{ error: "hermes config file unreadable", code: "<errno code>" }`. PUT does
  **not** write. The form shows its existing load-error / save-error notice
  (`putConfig` surfaces `error`). The log records path + code, never values
  (parent D9).
- **Readable but not a JSON plain object** (empty, parse error, `null`, array,
  scalar; a leading BOM is **not** stripped, matching upstream `loadConfig`,
  which then also falls back to defaults). This is an explicit exception to
  the `provider-auth-server` convention, which strips the BOM: here the
  dashboard's view must equal hermes's view:
  - GET → tolerant, every field reads default (today's behaviour, and what
    hermes itself sees).
  - PUT → **quarantine**, then write with `disk = {}`. Quarantine follows the
    repo convention of `provider-auth-server` › *auth.json corrupt-content
    recovery* (`packages/server/src/auth/locked-json-file.ts:179-195`), except
    for the BOM rule above:
    - copy the bytes (never rename) to
      `hermes-memory-config.json.corrupt-<YYYYMMDDTHHMMSSsssZ>` in the same
      directory;
    - flag `wx`, mode `0600`; `-1`, `-2`, … appended on `EEXIST`;
    - log one line with the quarantine path and the reason (`unparseable` |
      `not-an-object`).
  - If the copy fails → 500
    `{ error: "hermes config quarantine failed", code }`, no write.
  - The in-process SHA-256 dedup of the server helper is omitted: quarantine
    runs only on a user-initiated save, never on repeated reads (R8).
- The server helper is module-private (plugins cannot import server
  internals), so the plugin carries a small local copy.

### D4 — GET `raw` also carries preserved unknown keys

`raw` = `{ ...unknownOnDisk, ...resolvedKnown }`, built with `Object.fromEntries`
+ spread (D2). The raw-JSON dialog renders
`{ ...unknownKeysOf(effective.raw), ...buildResolvedConfig(values, overridden) }`,
so it shows what a save will preserve; `unknownKeysOf` also uses
`Object.fromEntries` (D2). `raw` is **display-only**: it is not a
valid PUT body when it carries unknown keys (body unknown keys → 400). `fields` is unchanged (known keys only); the client
builds the PUT body from `fields`, never from `raw`, so unknown keys never
enter a body (`src/client/settings-model.ts:78`).

### D5 — Drift guard: fixture replaces the inline list + local upstream check

- Fixture `src/shared/__tests__/fixtures/hermes-0.9.10-fields.json`:
  `{ "version": "0.9.10", "keys": [...44], "defaults": {...} }`. It is generated
  once at change time by a throwaway extraction from the installed upstream
  tree and committed; it is not a runtime dependency.
- The inline `EXPECTED_KEYS` assertion is rewired to `fixture.keys` (one
  source). A second assertion checks `DEFAULTS` equals `fixture.defaults`.
  A failure names the missing/extra keys.
- Local-only check, `it.skipIf(!upstreamInstalled)`: parses the
  `interface MemoryConfig` key names from
  `~/.pi/agent/npm/node_modules/pi-hermes-memory/src/types.ts`. It asserts that
  set equals `fixture.keys` **when** the installed `package.json` version
  equals `fixture.version`; otherwise it fails with "upstream is X, fixture is
  0.9.10 — re-mirror". Parsing is block-scoped: only the
  `interface MemoryConfig { … }` body is read (`types.ts` declares other
  interfaces), and the count is asserted to be 44.
- The same local check loads upstream `src/config.ts` and asserts
  `loadConfig("<nonexistent path>")` (which returns `{ ...DEFAULT_CONFIG }`,
  34 keys) equals `fixture.defaults`.
  - Load with a **dynamic** `createJiti(…).import(<abs path>)` after an
    `existsSync` gate, never a static import. Native Node refuses to
    type-strip TS under `node_modules`
    (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), and a static import would
    fail collection on machines without hermes.
  - jiti 2.7.0 is already hoisted in the workspace and verified to load it.
    Declare it as a plugin `devDependency` if the workspace dependency check
    requires.
- Enum sets and numeric bounds are not machine-checked (upstream does not
  export them); a re-mirror reviews them by hand (R1). CI has no hermes
  install, so the local check skips there.

### D6 — One-time legacy heal of `consolidationTimeoutMs`

Files saved by the 0.8.1-era plugin pin `"consolidationTimeoutMs": 60000` (the
old default). Under D1, 60000 ≠ 180000, so it would stay pinned and upstream
would warn on every load. Heal rule, server-side in compose:

> drop `consolidationTimeoutMs` from the written object **iff** `disk` is a
> legacy write-all file, `disk.consolidationTimeoutMs === 60000` and
> `body.consolidationTimeoutMs === 60000`.

- **Legacy write-all signature:** `disk` contains every key in
  `LEGACY_0_8_1_DEFAULTED_KEYS` — the 23 keys that had a defined default in the
  0.8.1 mirror, i.e. the current `DEFAULTS` key set, frozen as a constant.
  Under D1 a new-code save omits default-valued fields, so the signature no
  longer holds and the heal never fires again.
- Body value equal to disk value means the user did not edit the field in this
  save. A user who changes it in the same save keeps their value.
- After the first new-code save, the signature is gone unless every one of the
  22 other legacy keys holds a non-default value (see residual risks).
- Residual risks (accepted, narrow):
  - A user who deliberately kept 60000 under the old plugin is healed to the
    180000 default once; upstream warns below 180000 anyway.
  - A file whose 22 other legacy keys all hold non-default values keeps the
    signature, so a deliberate 60000 there is healed on every save.
  - A PUT body that omits `consolidationTimeoutMs` (non-form caller) drops the
    key anyway under D1(c), since known keys come only from the body.

### D7 — Descriptors + defaults for the 12 new fields

| Key | Descriptor | Default |
|---|---|---|
| `lazyInitialization` | boolean | `false` |
| `flushCompactTimeoutMs` | number, integer: false, no lower bound (`<= 0` = disable) | `60000` |
| `quickCheckOnOpen` | boolean | `true` |
| `llmFallbackModels` | stringArray | unset |
| `overflowGraceMs` | number, integer: false, min 0 | `180000` |
| `consolidationChunking` | boolean | `false` |
| `consolidationChunkChars` | number, integer: false, min 500 | `4000` |
| `usageHitTrackingEnabled` | boolean | `true` |
| `consolidationUsageSignals` | boolean | `true` |
| `autoConsolidationWarnOnFailure` | boolean | `true` |
| `standingInstructionsEnabled` | boolean | `true` |
| `sessionRetentionDays` | number, integer, min 0 (`0` = no pruning) | `0` |

- `llmThinkingOverride` enum gains `"max"`.
- `consolidationTimeoutMs` default → `180000`.
- "No lower bound" is `min: Number.NEGATIVE_INFINITY` within the existing
  `number` descriptor, so the `FieldDescriptor` union gets no new kind.
- For the 12 new fields, bounds equal upstream `loadConfig`, with two
  deliberate exceptions:
  - `consolidationChunkChars`: upstream silently ignores values below 500; the
    plugin rejects them, so the form never saves an ignored value.
  - `sessionRetentionDays`: integer, min 0. A fractional value such as `0.001`
    (about 1.4 minutes) would let a typo prune almost all history at the next
    startup.
- **Standing strictness (pre-existing, unchanged):** the 11 existing
  `NON_NEG_INT` fields stay integer ≥ 0, although upstream accepts any number.
  `projectsMemoryDir` stays a plain string, although upstream rejects absolute
  or `..` paths and silently falls back to the default (`paths.ts:34-57`).
  `memoryDir` upstream only drops an empty string (`paths.ts:20-27`). Listed
  in R4.

### D8 — Form placement + copy (presentation data, no i18n keys)

Labels and help text go in `field-groups.ts` only, matching every existing
field (`src/i18n.ts:11`). Copy must avoid "spawn/spawned/respawn"
(`openspec/specs/ui-terminology/spec.md`).

Placement:

- Prompt & policy: `lazyInitialization`, `standingInstructionsEnabled`.
- Flush on compact / shutdown: `flushCompactTimeoutMs` (help: "0 or less
  disables the timeout").
- Overflow & consolidation (existing `autoConsolidate` help becomes "Legacy
  alias — ignored while Overflow strategy is set"; D1): `overflowGraceMs`, `consolidationChunking`,
  `consolidationChunkChars`, `consolidationUsageSignals`,
  `autoConsolidationWarnOnFailure`.
- Child LLM: `llmFallbackModels` (one `provider/id` per line).
- Storage & search: `quickCheckOnOpen`, `usageHitTrackingEnabled`,
  `sessionRetentionDays`. Its help text must state that a positive value
  **permanently deletes** sessions older than N days at startup.

Controls derive from descriptors via the existing renderers; no new control
kind.

### D9 — Array-form `llmModelOverride` normalized on GET

Upstream 0.9.10 accepts `llmModelOverride: string[]`: the first entry is the
primary, the rest are fallbacks (`config.ts:205-212`). Sending it back through
the string-only `model` descriptor would 400 every save. GET therefore
normalizes exactly like upstream:

- `fields.llmModelOverride.value` = the first trimmed non-empty entry.
- The remaining entries are prepended (deduplicated) to
  `fields.llmFallbackModels.value`, and both read `isDefault: false`.

The next save writes the canonical string + array, which has the same
effective upstream config. An all-empty array reads as unset.

**Legacy fallback aliases:** upstream also unions `llmModelFallbacks` and
`fallbackModels` into `llmFallbackModels` (`config.ts:218-226`). GET mirrors
the union: `fields.llmFallbackModels` = dedupe(canonical ∪ array tail ∪
aliases), in upstream order, `isDefault: false`. The alias keys themselves
stay preserved unknown keys, so a save is effective-neutral. Limitation:
clearing the textarea cannot remove alias-provided entries, because upstream
re-adds them from the preserved alias keys. The user removes the alias keys
by hand (R4).

## Risks / Trade-offs

- **R1 drift recurs.** D5 makes the next re-mirror a reviewed fixture diff, and
  the local check fails on a mismatched install. Extraction stays manual
  (parent D3 stands).
- **R2 stale unknown keys accumulate** (e.g. a key upstream removed). They are
  now visible in the raw view (D4) but the dashboard never removes them.
  Harmless: `loadConfig` ignores unknown keys.
- **R3 known-key resurrection.** Prevented by D1. Covered by a regression test.
- **R4 hand-written values the validator rejects lock form saves** (pre-existing
  class: one invalid field makes the whole PUT 400). Reachable examples:
  - non-integer or negative values in the 11 `NON_NEG_INT` fields;
  - `consolidationChunkChars` in `(0, 500)`;
  - `sessionSearch` with extra keys (upstream ignores them);
  - fractional `sessionRetentionDays`;
  - an on-disk `memoryOverflowStrategy` outside the enum.

  The opposite direction also exists (pre-existing): `""` /
  whitespace-only entries in `llmModelOverride`, `llmFallbackModels` and
  `childExtensionPaths` pass validation but are dropped by upstream.
  Alias-provided fallbacks cannot be cleared from the form (D9).

  Accepted: the dashboard never produces these, and the 400 names the field
  so the user can fix it by hand. Separately, a `memoryDir` /
  `projectsMemoryDir` that upstream rejects is shown as set but is ignored by
  hermes (looser than upstream, pre-existing). Array-form `llmModelOverride`
  is **resolved** by D9.
- **R5 `llmFallbackModels: []`** — resolved: compose omits it (D1).
- **R6 `llmFallbackModels`** is a textarea, not the shared model selector, so
  there is no existence check. Accepted: list editing in the selector is out of
  scope.
- **R8 third quarantine copy** (`packages/server/src/auth/locked-json-file.ts:195`,
  `packages/server/src/routes/provider-routes.ts:109`, now the plugin), without SHA-256 dedup.
  Accepted; candidate for a later shared-helper extraction.
- **R9 dead `autoConsolidate` toggle.** It is ignored upstream whenever a
  strategy is written, which D1 always does. Pre-existing; mitigated by its
  help text only. The display is truthful (D1 GET derivation).
- **R10 `__proto__` kept as data**: a deliberate departure from the
  `system-one-config` drop rule (D2).
- **R7 cross-process write race.** In-process PUTs cannot interleave (the D1
  sync invariant). A hand-edit or another dashboard process writing between
  the read and the rename is lost; last write wins. Accepted.

## Migration / Rollback

- **Migration:** none beyond D6's one-shot heal. The file format is owned by
  hermes and only gains preserved keys and loses default-valued keys, which
  upstream fills from `DEFAULT_CONFIG`.
- **Rollback:** revert. Files written by the new code stay readable by the old
  plugin, with two caveats:
  1. The old plugin would again drop unknown keys and pin defaults on its next
     save.
  2. A file holding `llmThinkingOverride: "max"` makes the old plugin's
     validator 400 every save until that value is edited by hand.
  3. The old plugin's `DEFAULTS` still say `consolidationTimeoutMs: 60000`
     (`src/shared/hermes-config.ts:138`). On a file where the new code omitted
     it, the old plugin reports 60000 as the default and pins it on its next
     save. That changes the effective value from 180000 to 60000; re-set it
     by hand after a rollback.
