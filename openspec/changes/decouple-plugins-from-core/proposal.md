## Why

Issues:
- https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/931 — dashboard plugins are not decoupled from the core (the core imports plugins directly).
- https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/930 — external plugins can't contribute UI to a stock dashboard.

Both issues are about the same boundary. The host has no supported public API, so the core reaches into plugins, and plugins (in-repo and external) copy or deep-import host internals. #931 fixes the direction of the dependencies. #930 fixes how plugin UI is delivered. Together they make a plugin a separable unit.

Reported evidence (verify during planning):

- **Core → plugin imports (#931):** `client/.../tool-renderers/AgentToolRenderer.tsx` and `client/src/lib/chat/event-reducer.ts` → `pi-dashboard-subagents-plugin/client`; `client/src/lib/package/anthropic-peer.ts` → `flows-anthropic-bridge-plugin/peer-probe`; `server/src/server.ts` and `server/src/auth/radius-mcp.ts` → `mcp-client-plugin/core`. There is also a plugin → plugin dependency: `mcp-server-plugin` → `mcp-client-plugin`. Helpers are mirrored by copy, e.g. `automation-plugin/src/client/folder-encoding.ts` and `automation-card-visuals.ts`.
- **External UI gap (#930):** the server loader (`packages/dashboard-plugin-runtime/src/server/loader.ts`) scans `packages/`, `~/.pi/dashboard/plugins/` and `resources/plugins/`. The client registry is build-time only: `vite-plugin/index.ts` → `discoverPlugins(repoRoot)` scans only `<repo>/packages`, and `client-registry-set.ts` `bundleRootsFor` / `selectClientRegistryPlugins` drop runtime-only roots. Real external plugins (`invoice-bot-dashboard`, `rackinspect-plugin`) ship `claims: []` and work around this with a separate SPA or with no UI.

## What Changes

- **Boundary check:** a lint/CI rule that `packages/{client,server,shared}` SHALL NOT import `*-plugin` packages.
- **Invert existing core → plugin imports** into host extension points (slots, services, types in `shared` or `dashboard-plugin-runtime`). Plugins register into them.
- **Public host UI API:** promote the commonly mirrored helpers (folder encoding, session status visuals, ChatView) to a versioned, supported host API so external plugins stop deep-importing source.
- **External plugin UI delivery:** decide between:
  - **A. Build-time external roots** — widen `bundleRootsFor`; needs Vite dedupe, Tailwind `@source` and `server.fs.allow`. Still requires a client rebuild.
  - **B. Runtime client loading** — a prebuilt ESM client per plugin, served at `GET /api/plugins/<id>/client.js`, loaded with `import()`, with shared React / host API via an import map or host globals, plus a compat check.
  - Or both. B is the only option that helps npm and Electron installs that have no toolchain.
- Phase the work: boundary check + inversions first, then the host API, then external UI loading.

## Capabilities

### Modified Capabilities
- `dashboard-plugin-loader` — client discovery or runtime loading of external roots.
- `plugin-ui-primitive-registry` — public host UI API surface.
- (Possibly a new capability for runtime plugin client loading; decide in design.)

## Non-goals

- Discovery from `~/.pi/agent/settings.json#packages[]`. That is owned by the existing change `external-dashboard-plugins`. Coordinate with it; don't duplicate.
- Moving individual features out into plugins (`extract-git-as-plugin`, `extract-openspec-as-plugin` own those).
- A plugin trust or allowlist model. Plugins keep the same trust as pi extensions.

## Discipline Skills

- `security-hardening` — runtime loading of plugin JS served by the host is untrusted-code delivery. Covers the trust boundary, CSP, and the served-asset path.
- `doubt-driven-review` — a public host UI API is an irreversible public contract, and so is the A vs B delivery decision.
- `performance-optimization` — runtime `import()` of plugin bundles affects first paint and bundle size.
- `review-code` — before commit.

## Impact

- `packages/client`, `packages/server`, `packages/shared` (remove plugin imports), `packages/dashboard-plugin-runtime` (vite-plugin, client-registry-set, loader, host API), the affected plugins (subagents, flows-anthropic-bridge, mcp-client, mcp-server, automation).
- Overlaps active changes `external-dashboard-plugins`, `extract-git-as-plugin`, `extract-openspec-as-plugin`. Sequencing must be decided in planning.
- Compatibility: the host API version must be checked against the plugin's declared version. Existing in-repo plugins keep working through the build-time path. Rollback per phase.
