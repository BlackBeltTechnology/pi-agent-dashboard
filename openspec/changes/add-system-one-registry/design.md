## Context

See proposal.md, Why. Research: `docs/research/typesafe-system-one-decision-points.md`, §12–§19. The bake-off numbers come from `docs/research/unified-context-manager-exploration.md`, §16–§17.

Constraints found in the repo:
- **Consumers run in two process types.** In-session pi extensions (gates, output judges) and the dashboard server (fleet decisions) both need decisions. Extensions must keep working with the dashboard down (same reasoning as `packages/roles-plugin/src/server/roles-routes.ts` reading `~/.pi/agent/providers.json` directly).
- **Role refs are chat models.** They resolve through `model:resolve` (`packages/extension/src/provider-register.ts`) to pi-ai chat models, which is not the System-1 wire.
- **No shared credential store yet.** `expose-plugin-credential-and-oauth-seams` (0/70 tasks) will provide the plugin credential store; it doesn't exist yet.
- **No bundled Python runtime.** `bundle-python-runtime` (0/42) is not landed, so managed backends depend on `uv` on PATH.
- **Prior art exists.** `pi-typesafe` (MIT) already provides a key store, daily caps and a calibrate module for the hosted path. Its backend enum is closed (`typesafe | openrouter`).

## Goals / Non-Goals

**Goals:**
- One library that every consumer imports, with no dashboard runtime dependency.
- One config file shared by both process types, and one settings UI.
- Egress controlled centrally and enforced before any bytes are sent.
- Enforcement never happens on an uncalibrated backend/model pair.

**Non-Goals:**
- In-process `laya-ts` (ONNX in Node). Deferred; it needs a worker boundary and model download UX. It can be added later as a third backend kind without changing any spec'd surface except the kind union.
- Fine-tuning, the shuffled-evidence control, and label mining. These are follow-ups on top of the decision log.
- Any product consumer. The first real consumers are separate changes.
- Spend caps. Deferred, since the hosted cost is small ($0.042/MTok); revisit if a consumer runs per tool call fleet-wide.

## Decisions

### D1. A separate registry, not a `@system1` role
- **Choice:** a new config file and library.
- **Alternative:** add a role to `roles-plugin`. Rejected for three reasons:
  - role resolution would need a non-chat special case;
  - local backends have a lifecycle (download, start, health, port);
  - calibration is per backend.
- **What we reuse:** the `llm` backend kind references a role (`@fast`), so the LLM fallback follows the user's role presets. UI patterns come from `ui:model-selector` and blackhole's `ChainEditor`.

### D2. Library + plugin split
- **`packages/system-one`** (published as `@blackbelt-technology/pi-system-one`) holds `predict`, config load and merge, the catalog, the capability check, egress classification and the decision log. It depends only on Node built-ins. Extensions import it directly.
- **`packages/system-one-plugin`** holds the server routes, managed process supervisor, eval runner and settings client. It imports the library.
- **Alternative:** a server-side HTTP service that extensions call. Rejected because extensions must work with the dashboard down, and a hop would add latency on `tool_call` paths.

```mermaid
flowchart LR
  subgraph lib[packages/system-one]
    P[predict] --> C[config cache<br/>mtime-checked]
    P --> K[capability check]
    P --> E[egress classifier]
    P --> L[decision log]
    P --> H[http backend]
    P --> M[llm backend<br/>via injected LlmCaller]
  end
  CFG[(~/.pi/agent/system-one.json<br/>+ .pi/system-one.json)] --> C
  EXT[pi extension consumers] --> P
  SRV[server consumers] --> P
  subgraph plugin[packages/system-one-plugin]
    UI[settings section] --> API[/api/system-one/*]
    API --> CFG
    API --> SUP[managed process supervisor]
    API --> EV[eval runner] --> P
  end
  SUP --> LOC[von serve / laya-serve<br/>127.0.0.1:184xx]
  H --> LOC
  H --> JEV[api.typesafe.ai]
```

### D3. Two backend kinds, where `managed` is config sugar
- `managed` resolves to `http` on loopback, so the adapter has one network path. The supervisor owns only the process.
- `llm` is behind an injected `LlmCaller`, so the library never imports pi-ai. The caller exposes `isLocal(role)`, which is `true` only for on-machine inference. A loopback proxy to a cloud provider (e.g. the dashboard model proxy) is off-machine. The adapter enforces its own timeout whether or not the caller honours the signal. The server passes one built on its pi-ai access; extensions pass one built from their pi context. A caller without one simply skips `llm`.

### D4. The adapter reports, the consumer decides
- The adapter returns `mode` + `thresholds` + `policy`, and never allows or blocks anything itself. This keeps safety policy in reviewable consumer code (the learnjev harness rule: the gate advises, the runtime enforces).
- **Alternative:** thresholds applied inside the adapter. Rejected, because "stricter" means different things per question (a high `noul` can mean danger or safety).

### D5. Calibration key is backend::consumer, plus model string
- Calibration differs per model: Vega found a one-sided escalate/not-escalate asymmetry, and Laya issues show thresholds don't carry over across option counts.
- Keying on the model string returned by the backend drops enforcement automatically when `jev-latest` moves, with no version polling.

### D6. Egress classified by destination, not by vendor
- The rule is loopback vs. not, derived from the URL, so a custom remote Von counts as off-machine. The default is `allowOffMachine: false`.
- Redirects are disabled (`fetch` with `redirect: "error"`), so a loopback server cannot bounce the state to a remote host. Only `http:`/`https:` URLs are accepted.
- The project override is read only when the caller passes `project: { cwd, trusted: true }`, with `trusted` taken from pi's project-trust decision. The library never infers trust itself. A project chain may name only on-machine backends, so a repo cannot move a consumer onto a hosted backend. Server-side callers have no per-session project and use the user config only.
- The project override cannot touch egress or backends (the same trust model as pi-warden's user-file-only keys).

### D7. Keys in an owner-only file for now; credential store later
- The key lives in `~/.pi/agent/system-one/auth.json` (0600, atomic write), with env precedence.
- When `expose-plugin-credential-and-oauth-seams` lands, a follow-up moves it to `ServerPluginContext.credentials`, one-shot, and leaves an env-only path for extensions.
- **Alternative:** reuse `~/.pi/agent/pi-typesafe/auth.json`. Rejected: its format belongs to another project. An "import from pi-typesafe" button can come later.

### D8. Consumers self-declare at call time and register to a file
- Each `predict` carries the consumer's declaration (`id`, `failurePolicy`, `requires`, `fixtures`). The library writes changed declarations to `~/.pi/agent/system-one/consumers/<sha256(id)>.json`, one file per consumer, so concurrent processes never race on a shared file. The settings UI lists that directory.
- This gives the library the failure policy it must return, and it covers consumers inside extension processes that the server cannot see.
- **Alternative:** a `systemOne.consumers` field in the plugin manifest. Rejected: `validateManifest()` (`packages/dashboard-plugin-runtime/src/manifest-validator.ts`) rebuilds the manifest from a fixed field set and drops unknown keys. It would need a `dashboard-plugin-loader` delta, and extension-only consumers would still be missing.
- Trade-off: a consumer shows up in the UI only after its first call. Accepted, since Test needs real fixtures anyway.

### D9. Decision log stores distributions + state hash, never state
- This is enough for calibration drift and backend comparison. It's also enough to join outcome labels later by `consumerId` + time and correlation fields the consumer logs itself.
- Storing state would duplicate session transcripts with secrets in them.

### D10. Amend `unify-context-manager` D11
- D11 keeps its per-step routing and query-shape rules (atomic nouls, anchored scores), but its adapter becomes this library.
- D11's "one primary + fallback chain per step" maps to per-consumer overrides, with one consumer id per triage step (e.g. `context-manager:is_lesson`).

### D11. Managed backends: POSIX + uv only in v1
- Engines are installed with `uv tool install` into a dashboard-owned tool directory and spawned directly, so the child PID is the server rather than a `uv` wrapper. PID files are matched on PID + start time + argv. This is specified for macOS and Linux. Docker is deferred: a detached container breaks the direct-child lifecycle. Windows reports `unsupported-platform`; users can run the engine themselves and add an `http` backend.
- Health uses `GET /v1/models` (Von documents it) and falls back to a one-`noul` request, because `laya-serve` serves only `/health` and `/v1/systemone` (verified laya 0.3.20, task 6.11).

### D12. Config trust hygiene and write concurrency
- Both config layers parse into null-prototype objects. `__proto__`, `constructor` and `prototype` keys are dropped. Reads use own properties only. This closes prototype pollution from a trusted-but-hostile project file, which would otherwise flip `allowOffMachine`.
- There are three writers: the settings save, the calibration save, and the supervisor's port persist. Each one re-reads inside its request and merges only the keys it owns. The two UI writers carry `baseRevision` (SHA-256 of the file bytes) and get 409 on mismatch. Unknown keys survive every write, as in blackhole's "writes preserve keys the plugin does not manage".
- The settings section follows the blackhole precedent (`useSettingsDraftSource` plus its own route and file), so the `plugin-config-persistence` and `settings-panel` specs are unaffected.

### D13. Settings UI shape follows the approved mockup
- Mockup: `mockups/index.html`, plan and cited rules: `mockups/ui-plan.md`, scripted check: `mockups/ux-probe.cjs` (68/68, axe WCAG 2.2 AA in dark + light).
- The server owns egress classification. `GET /config` returns `offMachine` per backend, `llm` included via `LlmCaller.isLocal`, so the client never re-implements D6.
- A new consumer override starts from the preset chain minus incompatible backends, so the user never starts from a chain the filter would hide.
- Test is refused for a `managed` backend that is not `ready`, in the UI and on the eval route.
- Only the draft (`allowOffMachine`, `backends`, `presets`, `activePreset`) goes through the host Save Bar. Key entry, Start/Stop and calibration saves act immediately, and the UI says so next to each control.
- Thresholds are shown read-only from the run; no editor in v1.
- Threshold derivation (decided by the user during ship-it): per `noul` question with binary `expected`, the eval runner picks the score cut that maximises accuracy on the fixtures (ties → the cut closest to 0.5). `choice` questions get no threshold. The record stores `thresholds[questionId] = cut`.

## Risks / Trade-offs

- [Zero-shot local models are weak (§17)] → The default preset is `local-only` for privacy, but nothing enforces without calibration, and the Test view shows accuracy before anyone saves `enforce`.
- [Hosted API changes shape or pricing] → The adapter validates every response against the declared options. A failure falls through the chain. The catalog price shows as "estimated".
- [`llm` fallback is slow (seconds)] → It carries its own 15 s timeout. Consumers on hot paths should omit `llm` from their override chain; the UI warns when a consumer with `failurePolicy: fail-open` has `llm` in its chain.
- [Child processes leak on crash] → PID files plus orphan termination matched on command line, and no autostart by default.
- [The user-supplied `http` URL could be used for SSRF from the eval runner] → Only an authenticated dashboard user can set it; mutating routes sit behind `networkGuard`; only `http:` / `https:` schemes are accepted.
- [Published library is a public surface] → The `predict` contract and config schema become an npm API. The package ships at the monorepo version with the plugin; breaking changes follow the release SemVer rules. It is published (not private) because the plugin ships in Electron and npm-global installs, where dependencies resolve from npm.
- [Token estimate chars ÷ 4 under-counts CJK] → Accepted. Capability checks are a coarse filter; an over-long state produces a backend error, and the chain falls through.
- [Config drift between the two process types] → One file, mtime-checked reads, and atomic writes, so there's no cross-process cache coherence to manage.

## Migration Plan

- Additive only. First run: no config, so every `predict` returns `no-backend`.
- Rollback: remove the two packages and delete `~/.pi/agent/system-one.json` and `~/.pi/agent/system-one/`. Consumers must handle a missing library as their failure policy.
- D11 amendment: an edit to the planning text only, with no code impact until the context-manager triage phase.

## Open Questions


- Should `kev` have a managed engine entry? It's MLX-based on Mac, with a different launcher. Deferred; the catalog row exists and users can point an `http` backend at it.
