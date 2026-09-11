## Why

The blackhole settings page (`packages/blackhole-plugin`) can reorder and remove worker-chain entries but cannot **add** one, cannot edit the base `model`, and identifies models by free-text `provider` / `id` inputs. A `pi-blackhole-config.json` with no chain configured — the shipped default — therefore cannot be repaired from the dashboard at all: the observer silently falls back to the session model (Opus on this instance), one 429 exhausts the one-deep chain, and the session logs `Observational memory: observer failed: Observer: all model candidates exhausted`. Fixing it today means hand-editing JSON with model ids copied from elsewhere.

## What Changes

- **Add-entry control** on every worker chain (`observer`, `reflector`, `dropper`), including on an empty chain. Appends a fallback; on an empty chain the appended entry becomes the primary.
- **Model picker replaces free-text.** Each chain entry's `provider` + `id` are chosen through the shared `ui:model-selector` primitive over the live dashboard model registry (`GET /api/models`), paired with a plugin-local "override thinking level" toggle that reveals `ui:thinking-level-selector` (the shell primitive has no inherit state, so absent-vs-`off` needs the toggle). Levels offered are blackhole's own six (`off`…`xhigh`); a non-reasoning model offers `off` only. Free-text `provider`/`id` inputs are removed. `cooldownHours` and `contextWindow` stay numeric inputs.
- **Base `model` becomes editable** with the same picker (currently display-only in the tail). Clearing it writes the key as absent.
- **"Use recommended defaults" action.** One control stages a resilient starting configuration into the draft: the same ranked flash-class chain (up to 3 entries, `cooldownHours: 1`) for all three workers, plus `debug: true` and `debugLog: true`. Chain candidates are chosen from the live registry by a ranked name heuristic (`flash` → `haiku` → `mini`), preferring distinct providers so one provider's rate limit cannot exhaust the chain, never from a hardcoded vendor list. Disabled with an explanation when the registry yields no candidate. Nothing is written until the host Save Bar saves.
- **Registry unavailable is a visible state**, not a broken picker: when `GET /api/models` fails (or lists zero credentialed models), every registry-dependent control (add, base-model picker, per-entry pickers, defaults) is non-interactive, existing entries still show their stored `provider/id`, and an explanation (with retry on failure) is shown. Other per-entry fields, move and remove keep working.
- **Empty chain has an empty state** naming the base/session tail the worker currently resolves to, with the add control beneath it.
- No server route changes: writes continue through `PUT /api/plugins/blackhole/config` and the existing validator; the on-disk shape is unchanged.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `blackhole-plugin-settings`: "Model fallback chains are editable as ordered lists" — entries are addable (including on an empty chain); `provider`/`id` are chosen from the live model registry instead of typed; `thinking` uses the shared level picker. New requirements: base `model` is editable through the picker; a recommended-defaults action stages a resilient chain + debug logging; registry unavailability degrades visibly.

## Impact

- `packages/blackhole-plugin/src/client/ChainEditor.tsx` — picker-backed entry editor, add control, registry-unavailable state.
- `packages/blackhole-plugin/src/client/BlackholeSettings.tsx` — base-model picker, recommended-defaults action, models fetch.
- `packages/blackhole-plugin/src/client/blackhole-api.ts` — `getModels()` client over `GET /api/models` (maps `provider/id` rows to `ModelInfo`).
- `packages/blackhole-plugin/src/shared/chain-model.ts` — `appendEntry`; new pure `recommendedDefaults(models)` helper.
- `packages/blackhole-plugin/src/i18n.ts` — new keys (add control, entry group label, thinking override toggle, empty state, registry unavailable/empty, defaults action + copy) with `zh-CN`/`hu` parity; removes `mProvider`/`mModelId`.
- Tests: `ChainEditor.test.tsx`, `BlackholeSettings.test.tsx`, `chain-model.test.ts` updated/extended.
- Depends on existing primitives `ui:model-selector`, `ui:thinking-level-selector` and the existing `GET /api/models` route — no server, shared-package, or extension changes.

## Discipline Skills

- `review-code` — non-trivial client change before commit.
- `doubt-driven-review` — the recommended-defaults heuristic writes model choices users will run unattended; stress-test the ranking + the "never hardcode a vendor id" boundary before it stands.
- Not triggered: `security-hardening` (no new untrusted input path — server validator unchanged, client sends the same shape), `performance-optimization`, `observability-instrumentation`.
