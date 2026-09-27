## Why

Several planned features need fast, cheap, typed decisions (`choice` / `score` / `noul`) instead of a full LLM turn:
- context-manager triage (`unify-context-manager` D11);
- a pi-warden wrapper (`add-pi-warden-plugin`);
- attention and push priority, stuck-session detection, automation wake gates, and bash failure classification (research dossier §16, rows A–F).

Several backends speak the same `POST /v1/systemone` wire: hosted TypeSafe Jev, open-weight Von and Laya, and Kev. They differ sharply in:
- accuracy (dossier §17: jabr v2 Jev 0.966, Von 0.704, Laya 0.583 zero-shot);
- context size (Laya 512 tokens, Jev 32k);
- option limits;
- whether data leaves the machine.

Without one shared registry, every consumer would ship its own client, key prompt, thresholds and picker. D11 currently scopes the adapter to the context manager only. This change makes the adapter one shared, user-controlled service before any consumer is built. It also lets the user decide globally whether session text may leave the machine.

## What Changes

- **New library `packages/system-one/`** (no dashboard dependency, usable from pi extensions and the server):
  - `predict({ consumer, state, questions })` over `choice` / `score` / `noul`, where `consumer` is a self-declaration (id, failure policy, requirements, fixtures);
  - backend kinds: `http` (hosted, remote or managed-local `/v1/systemone`) and `llm` (asks a pi-ai model referenced by a role, e.g. `@fast`, for the same structured answers);
  - an ordered fallback chain, and a failure policy declared per consumer (`fail-open`, `fail-closed`, `deterministic`);
  - a capability check per request: state size, option count, primitive support (language is a settings-UI filter only);
  - HTTP requests with redirects disabled and only `http:`/`https:` URLs;
  - a global "no data off-machine" switch enforced inside the adapter;
  - a decision log that records probabilities, backend, model version and latency, but never the state text.
- **New config `~/.pi/agent/system-one.json`** plus a restricted project override `.pi/system-one.json` (applied only for callers that pass a trusted project). The file holds backends, presets (built-in `hosted` and `local-only`), per-consumer overrides and calibration records. Thresholds are keyed by backend and consumer together; switching a consumer's backend drops it back to shadow mode.
- **API keys** are never stored in the config. They come from an env var, or from an owner-only key file `~/.pi/agent/system-one/auth.json`. They move to the plugin credential store once `expose-plugin-credential-and-oauth-seams` lands.
- **New dashboard plugin `packages/system-one-plugin/`**, as a settings section with:
  - a backend catalog carrying capability metadata;
  - a global default chain, preset switcher and per-consumer overrides;
  - hiding or warning about backends that can't meet a consumer's requirements;
  - a per-consumer **Test** button that runs labelled fixtures and shows accuracy, AUC, latency p50/p90 and estimated cost;
  - lifecycle for managed local Von/Laya servers (start, stop, health, RSS, port ≠ 8000) via `uv`;
  - a key entry field (hidden input, write-only).
- **Consumer declaration:** consumers declare themselves on each `predict` call. The library records them under `~/.pi/agent/system-one/consumers/`, which the settings UI lists. This works for consumers in both pi extensions and the server, and needs no plugin-manifest change. A built-in `system-one:selftest` consumer and its fixtures prove the whole path end to end. No product consumer is wired in this change.
- **Amend `openspec/changes/unify-context-manager/design.md` D11** so the context manager consumes this adapter instead of owning one. This changes D11's planned semantics: "nothing configured → default LLM" becomes "the consumer's failure policy, plus an `llm` entry if the user adds one to the chain". D11 is unshipped planning text, so no shipped behaviour changes.

No breaking changes. With no config file, every `predict` call resolves to the consumer's failure policy, and no request leaves the machine.

## Capabilities

### New Capabilities
- `system-one-adapter`: the `predict` contract, backend kinds, fallback chain, capability check, failure policies, off-machine enforcement, shadow/enforce mode and the decision log.
- `system-one-config`: config file layout and precedence, project-override limits, presets, per-consumer overrides, calibration records keyed by backend and consumer, and key sources.
- `system-one-settings-ui`: the settings section, backend catalog with capability metadata, compatibility filtering, per-consumer Test/eval, and key entry.
- `system-one-managed-backends`: dashboard-managed local Von/Laya servers on macOS and Linux (install detection, start/stop, health, port selection, orphan cleanup). Windows is `unsupported-platform` in this change.

### Modified Capabilities
None. No existing spec's requirements change. D11 lives in an open change's `design.md`, not in `openspec/specs/`.

## Impact

- **New:** `packages/system-one/`, `packages/system-one-plugin/`.
- **Changed:** `openspec/changes/unify-context-manager/design.md` (D11; planning semantics as above).
- **Server:** the plugin mounts `/api/system-one/*` routes. Mutating routes use `networkGuard`. The plugin spawns and supervises managed backend child processes.
- **Extension-side consumers** read the config file directly, so they work with the dashboard down; managed backends are then unreachable and the fallback chain applies.
- **Distribution:** `packages/system-one` is published as `@blackbelt-technology/pi-system-one` (public, like `pi-dashboard-session-distiller`). The plugin ships in Electron (`resources/plugins/`) and npm-global installs, where its dependencies resolve from npm, so a private library cannot back it (decided during implementation).
- **Dependencies:** no npm runtime dependency for the wire (plain `fetch`). Managed backends need `uv` on PATH (Docker deferred) (detected; not bundled here; see `bundle-python-runtime`).
- **Data egress:** only through `http` backends whose host is not loopback, or through `llm` backends on a remote provider. Both are blocked when the off-machine switch is off.
- **Compatibility:** Node ≥ 22.19, pi peer `>=0.87.1`.
- **Rollback:** remove both packages and delete `~/.pi/agent/system-one*`. Consumers must treat a missing library or config as their failure policy.
- **Not in this change:** in-process `laya-ts` backend, fine-tuning pipelines, product consumers (attention, stuck, wake, triage), pi-warden wiring (`add-pi-warden-plugin`).

## Discipline Skills

- `security-hardening`: API keys, off-machine egress, project-override trust (a repo must not redirect judgments to a remote URL), user-supplied backend URLs, and child-process spawning for managed servers.
- `observability-instrumentation`: decision log, backend health, fallback and failure counters, shown in the settings UI.
- `performance-optimization`: the adapter will sit on hot paths (`tool_call` gates); per-request timeout and overhead budgets are in the specs.
- `doubt-driven-review`: the config schema and consumer contract become public surfaces that other changes build on. Review them before they stand.
- `review-code`: before commit.
