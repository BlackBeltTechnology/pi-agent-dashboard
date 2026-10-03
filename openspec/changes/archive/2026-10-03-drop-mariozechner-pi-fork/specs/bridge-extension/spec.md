## ADDED Requirements

### Requirement: Bridge anchors jiti loader resolution at the active earendil pi cli

The bridge extension SHALL resolve pi's TypeScript loader (jiti) by anchoring `createRequire` at `process.argv[1]` (the active pi cli's entry point) and probing the following package names in order:

1. `jiti` — the un-namespaced upstream package shipped by `@earendil-works/pi-coding-agent`.
2. `@mariozechner/jiti` — the namespaced jiti package, retained as a loader fallback. It is a separate package from the dropped `@mariozechner/pi-coding-agent` fork.

The bridge SHALL NOT probe `@oh-my-pi/jiti`. If neither name resolves, the bridge SHALL surface the error message "Cannot find pi's TypeScript loader (jiti). Is `@earendil-works/pi-coding-agent` installed?" — naming only `@earendil-works/pi-coding-agent`, never `@mariozechner/pi-coding-agent` or `@oh-my-pi`.

#### Scenario: Earendil pi resolves bare jiti

- **WHEN** the bridge runs inside `@earendil-works/pi-coding-agent`'s Node.js process
- **THEN** `createRequire(piCli).resolve("jiti/package.json")` succeeds
- **AND** `@mariozechner/jiti` is never probed

#### Scenario: Namespaced jiti fallback

- **WHEN** the bare `jiti` package is not resolvable from the active pi cli and `@mariozechner/jiti` is
- **THEN** the bare-jiti probe fails fast
- **AND** `createRequire(piCli).resolve("@mariozechner/jiti/package.json")` succeeds

#### Scenario: Error message names only the earendil pi package

- **WHEN** neither jiti name resolves (e.g., pi is not installed)
- **THEN** the thrown error message SHALL name `@earendil-works/pi-coding-agent`
- **AND** SHALL NOT mention `@mariozechner/pi-coding-agent` or `@oh-my-pi/pi-coding-agent`

## MODIFIED Requirements

### Requirement: Bridge SHALL NOT register a TUI multiselect arm that consumes `originals.custom`

The bridge extension's TUI PromptBus adapter (registered in `packages/extension/src/bridge.ts` when `ctx.hasUI === true`) MUST NOT contain an `else if (prompt.type === "multiselect" && ... originals.custom ...)` arm that calls `await originals.custom(...)` and uses its resolution to drive a `bus.respond(...)` call.

The reason: pi 0.70's RPC mode (used by every dashboard-spawned headless session) defines `ExtensionUIContext.custom` as an unconditional no-op:

```javascript
async custom() {
    // Custom UI not supported in RPC mode
    return undefined;
},
```

(source: `~/.nvm/.../@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js`)

Any TUI adapter arm that awaits `originals.custom(...)` in dashboard headless mode will therefore receive `undefined` synchronously (one event-loop tick), interpret it as cancellation, and call `bus.respond({ cancelled: true, source: "tui" })`. The PromptBus's first-response-wins semantics will then dismiss the dashboard's already-rendered `MultiselectRenderer` before the user can interact with it.

The bridge's `ctx.ui.multiselect` PromptBus patch (added by the predecessor change `fix-multiselect-auto-cancel-on-dashboard`) already routes multiselect through the bus to the `DashboardDefaultAdapter`, which renders a working browser dialog via the registered client `MultiselectRenderer`. No TUI adapter participation is needed for dashboard sessions, and pure-TUI sessions on pi 0.70 RPC have no working `ctx.ui.custom` path to participate through anyway. The TUI multiselect arm is therefore prohibited until pi-coding-agent restores `ctx.ui.custom` in RPC mode.

This requirement is enforced by a repository-level lint test (`packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts`) that scans `bridge.ts` and fails if the source contains the co-occurrence of `originals.custom` AND `prompt.type === "multiselect"`. Either substring alone is permitted — the prohibition is on the combination.

#### Scenario: Lint passes when `bridge.ts` does not contain the offending co-occurrence
- **WHEN** the lint test reads `packages/extension/src/bridge.ts` source
- **AND** the source does NOT contain `originals.custom` and `prompt.type === "multiselect"` together
- **THEN** the lint test SHALL pass

#### Scenario: Lint fails if a contributor re-adds the TUI multiselect arm
- **WHEN** a future refactor adds back the `else if (prompt.type === "multiselect" && ... originals.custom)` arm
- **THEN** the lint test `no-tui-multiselect-arm-regression.test.ts` SHALL fail with a message that includes the file path, the matched lines, and a one-line pointer to this change name

#### Scenario: `originals.custom` capture without consumption is permitted
- **WHEN** `bridge.ts` captures `originals.custom = ctx.ui.custom?.bind(ctx.ui)` (e.g., for a *different* future use that does not include `prompt.type === "multiselect"`)
- **THEN** the lint test SHALL pass — the prohibited pattern is the co-occurrence, not either substring alone

#### Scenario: `prompt.type === "multiselect"` outside the TUI adapter is permitted
- **WHEN** `bridge.ts` references `type: "multiselect"` in the `(ctx.ui as any).multiselect = (title, options, opts) => bus.request({ type: "multiselect", ... })` patch
- **THEN** the lint test SHALL pass — that string is in the patch site, not in the TUI adapter, and is part of the working bus-routed primary path

## REMOVED Requirements

### Requirement: Bridge anchors jiti loader resolution at the active pi cli
**Reason**: The `@mariozechner/pi-coding-agent` fork is no longer a supported pi; the old block's fork-specific scenarios cannot be dropped through MODIFIED.
**Migration**: Replaced by "Bridge anchors jiti loader resolution at the active earendil pi cli". Fork-only machines install `@earendil-works/pi-coding-agent`.
