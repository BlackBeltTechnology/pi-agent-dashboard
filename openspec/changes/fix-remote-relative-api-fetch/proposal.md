## Why

When the client is switched to a remote dashboard via `ServerSelector`, the page stays on the local origin and only `wsUrl` changes. `App.tsx` derives `apiBase` from `wsUrl` (`packages/client/src/App.tsx:462-466`), and core REST helpers prefix it (`getApiBase()` / `useApiBase()`, `packages/client/src/lib/api/api-context.ts`). Any `fetch("/api/...")` that skips the prefix silently hits the **local** server instead.

Observed: the Quota dialog on a client connected to a remote showed the local server's providers (Anthropic + Codex) and never the remote's OpenCode Go — `useQuota` calls `fetch("/api/quota")` (`packages/quota-plugin/src/client.tsx:153`).

Scope of the defect:
- **Plugins** — no plugin can obey the `cross-origin-client` prefix rule: the plugin SDK exposes no API base. Relative `/api/` fetches in 11 plugin client packages (quota, demo, flows, flows-anthropic-bridge, goal, grammar, hermes-memory, kb, roles, subagents, team). `blackhole` and `context-mode-settings` take an `apiBase = ""` parameter every caller leaves empty.
- **Core** — 9 relative calls violate the existing rule, incl. `usePluginEnabledSet` and `useHostPlatform` (`/api/health`), so even the enabled-plugin set and host platform come from the wrong server.

## What Changes

- Add one idempotent host-level `window.fetch` wrapper (`installApiBaseFetch`) in `packages/client/src/lib/api/`: a request whose input is a **root-relative string or `URL`** with path under `/api/` is rewritten to `${getApiBase()}${path}` when `getApiBase()` is non-empty. Absolute URLs, `Request` objects, non-`/api/` paths, and same-origin mode (`""`) pass through untouched.
- Install it **outermost** (after `installDeviceAuthFetch` and `installGrantChannelFetch` in `packages/client/src/main.tsx`) so the existing same-origin wrappers see the rewritten cross-origin URL and do NOT attach the local device bearer / grant-channel header to the remote.
- Rewritten requests receive exactly the auth treatment core prefixed calls already get (parity, no new credential path).
- No plugin code change required; plugin calls start honouring the selected server automatically.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `cross-origin-client`: "All REST calls use API base prefix" now also holds for plugin client code and any un-prefixed root-relative `/api/` call, enforced by a host fetch rewrite; adds the credential-isolation invariant.

## Discipline Skills

- **`security-hardening`**: the change decides which origin receives a request and sits in front of two credential-attaching fetch wrappers. Must prove local bearer / grant capability never reach the remote.
- **`doubt-driven-review`**: global `fetch` monkey-patch affects every request in the client; review before it stands.
- **`review-code`**: before commit.
- Not triggered: `performance-optimization` (one string check per fetch), `observability-instrumentation` (no new endpoint/job).

## Impact

- Code: `packages/client/src/lib/api/` (new wrapper + tests), `packages/client/src/main.tsx` (install order).
- Behaviour: same-origin and local mode unchanged. Remote-via-ServerSelector mode: plugin + 9 core relative calls now reach the selected remote.
- Compatibility: additive; no API, protocol, or config change. Server untouched.
- Rollback: revert the install line in `main.tsx`.
- Distribution: client rebuild; Electron/remote users need an updated build.
