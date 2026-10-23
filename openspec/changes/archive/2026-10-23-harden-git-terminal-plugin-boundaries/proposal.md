## Why

Split out of `close-residual-audit-findings`, which closes
`security-boundary-audit`. That umbrella was too large to ship in one pass.
This change takes the **server-side git, terminal and plugin boundary**
findings: B20, B1r, R1, S1r and B15r. They share one trust surface (server
routes and seams that accept caller-supplied paths, refs, cwds and event
types) and one set of overlapping changes (`extract-git-as-plugin`,
`add-plugin-capability-routes`, `close-container-loopback-impersonation`).

The umbrella keeps the auth, CORS, CSP, bridge, media and Electron items and
still closes the rest of the audit. Citations below are carried from the
umbrella's proposal and design; `design.md` is authoritative where they differ.

## What Changes

- **B20 · Redact error bodies.** Git error paths return raw stderr, e.g.
  `GitCommitError(..., staged.stderr.trim())`
  (`packages/server/src/git-worktree/git-operations.ts:328,333,357`), and the
  routes echo `err.message` to the client (`routes/git-routes.ts:188,210,228,314`).
  Redact absolute paths, URL userinfo and specific token shapes before they
  reach a response body; commit SHAs survive.
  `fix-git-checkout-command-injection` put this out of scope. Redaction runs
  after server-side mapping and relativizes to the operation's repository root
  (design D12).
- **S1r · Plugin cwd allowlists + hot-load caveat.** `add-universal-network-guard`
  deferred per-plugin cwd hardening to the audit
  (`archive/2026-09-19-add-universal-network-guard/proposal.md:80-83`). The
  automation plugin still takes `body.cwd` verbatim as its scope base
  (`packages/automation-plugin/src/server/routes.ts:36-37`, `/create` `:262`).
  The flows plugin's `/flow-inputs` uses `q.cwd ?? process.cwd()`
  (`packages/flows-plugin/src/server/index.ts:66-68`). Validate
  cwd against known + pinned dirs. The 12 generated MCP automation tools
  (`mcp-server-plugin/src/server/generated/tools.ts`) call these routes: their
  manifest marks `cwd` required for folder-scope tools, and a folder-scope call
  without cwd gets 400 `cwd_required`. A non-string `cwd` gets 400
  `invalid_cwd`; a refused flow id gets 400 `invalid_flow_id`. Also record the
  guard caveat: routes registered after `ready()` are not covered
  (`packages/server/src/server.ts` ~3004-3006), so any future plugin hot-load
  must re-guard.
- **B1r · git option injection.** `checkoutBranch` now uses argv
  (`packages/server/src/git-worktree/git-operations.ts:512-520`), but the branch
  is still unvalidated. `routes/git-routes.ts:198` checks only that it is truthy.
  Reject a leading `-`, empty and control-character refs (C0 `0x00–0x1F` and
  DEL `0x7F`) with 400 `invalid_ref`, including derived and optional git
  arguments and every caller-supplied ref or path (validator only; no
  `--end-of-options`).
- **R1 · Terminal cwd.** `packages/server/src/browser-handlers/terminal-handler.ts:52,73`
  spawns at `msg.cwd` unchecked. Validate it against known + pinned dirs.
  Refusals send `terminal_error` to the requesting socket only; inline
  terminals spawn at the session's own cwd and ignore `msg.cwd`.
  `harden-server-capability-bounds` declares this out of scope.
- **B15r · Plugin event allowlist.** Plugin events flow server → bridge: a
  plugin calls `ctx.emitEventToSession`, the server seam refuses only reserved
  prefixes (`packages/server/src/plugin-event-seam.ts:11-25`), and the bridge
  relays any non-empty `eventType` (`packages/extension/src/bridge-handlers/dispatch.ts:326-332`).
  `emits` exists only on automation action registrations, enforced inside the
  automation engine (`packages/automation-plugin/src/server/engine.ts:128`).
  Add a static manifest `emits` field enforced at the server seam; automation
  passes through events its registered actions declare. For an
  `automation.action.<source>` key the provider plugin id must equal
  `<source>`, else the provide is refused and logged; `consumeAll` entries gain
  a `provider` field.

## Capabilities

### Modified Capabilities

- `git-operations-api` (B20, B1r)
- `terminal-emulator` (R1)
- `plugin-cwd-admission` and `trusted-networks` (S1r)
- `dashboard-plugin-loader` and `automation-action-registry` (B15r)
- `bridge-extension` (B15r)

## Impact

- Server: `git-worktree/git-operations.ts`, `routes/git-routes.ts`,
  `browser-handlers/terminal-handler.ts`, `browser-handlers/session-action-handler.ts`
  (B1r `baseHint`), `plugin-event-seam.ts`, `server.ts` (provide / consumeAll,
  post-start registration test). Shared: `browser-protocol.ts` (`terminal_error`).
- Extension: `bridge-handlers/dispatch.ts` (relay stays; spec delta only).
- Plugins: `automation-plugin`, `flows-plugin`, `mcp-server-plugin` (regenerated
  tool manifest), `dashboard-plugin-runtime` (manifest validator). Client:
  `hooks/useMessageHandler.ts` (`terminal_error` notice).
- **Overlaps with active changes.** Sequence or coordinate with each:
  - `extract-git-as-plugin` moves `git-operations.ts` + `routes/git-routes.ts`
    into `packages/git-plugin/` (B20, B1r). Whichever lands first, the other
    re-applies at the new path; citations here are pre-move.
  - `add-plugin-capability-routes` touches `localhost-guard.ts` and
    `auth-plugin.ts` (S1r). It does not modify trusted-networks "Network guard
    threaded to all protected routes".
  - `close-container-loopback-impersonation` MODIFIES `trusted-networks` (other
    requirements). Our block is written on baseline text; whichever archives
    later rebases the shared requirements on the earlier one's text. It does
    not modify "Network guard threaded to all protected routes".
- **Compatibility:**
  - S1r: MCP automation tools need `cwd`. Agents relying on the server-cwd
    fallback must pass `cwd`; the regenerated tool manifest marks it required
    for folder-scope tools. CHANGELOG note.
  - B15r: out-of-tree plugins that emit events need a manifest `emits` entry;
    otherwise one warning per (plugin, eventType) and the emit is refused.
    CHANGELOG migration note.
  - R1: old clients' inline terminals open at the session cwd, not the
    `msg.cwd` they sent; old clients ignore `terminal_error`.
  - B20: `stderr` stays in bodies (hook output is useful UX) but is redacted.
- **Rollback:** each item is an independent local revert (redaction boundary
  call, ref validator, terminal handler, admission calls, seam check). No data
  migration; manifests with `emits` stay harmless after a seam revert.

## Discipline Skills

- `security-hardening` — every item hardens an untrusted-input, exec or
  plugin-trust boundary.
- `doubt-driven-review` — the B15r allowlist (provider attribution, key
  ownership, out-of-tree breakage) and S1r `cwd_required` compatibility (MCP
  agents, client callers) affect compatibility; review each before it stands.
- `performance-optimization` — B20 redaction runs on every git error body and
  needs a measured budget (p99 < 10 ms at 100 KB, linear at 1 MB).
