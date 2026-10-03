## ADDED Requirements

### Requirement: Unified jiti resolution via `ToolResolver` anchored at earendil pi

`ToolResolver.resolveJiti({ anchor?, resolver? })` SHALL be the single source of truth for resolving pi's `jiti-register.mjs`. Resolution order: managed pi install (`~/.pi-dashboard/node_modules/<pi-pkg>` for `@earendil-works/pi-coding-agent` only) → system pi via `which("pi")` → caller-supplied `opts.anchor` walked up to nearest `node_modules` → `process.argv[1]` walked up. For every anchor, the inner walk SHALL try `JITI_PACKAGES = ["jiti", "@mariozechner/jiti"]` (upstream first, namespaced-jiti fallback; `@mariozechner/jiti` is a loader package, unrelated to the dropped pi fork). Returns the register hook as a `file://` URL string (preserving the Windows drive-letter URL-wrapping contract documented on the prior `buildJitiRegisterUrl` helper) or null. The optional `resolver` parameter SHALL be the `JitiResolver` test-injection seam.

#### Scenario: Managed pi present (upstream)

- **WHEN** `~/.pi-dashboard/node_modules/@earendil-works/pi-coding-agent` exists and resolves `jiti/package.json`
- **THEN** `resolveJiti()` returns a `file://` URL pointing at the upstream `jiti/lib/jiti-register.mjs`

#### Scenario: Managed legacy fork is not an anchor

- **WHEN** `~/.pi-dashboard/node_modules/` contains only `@mariozechner/pi-coding-agent`
- **THEN** `resolveJiti()` SHALL NOT anchor at it
- **AND** resolution SHALL continue with system pi, `opts.anchor`, then `process.argv[1]`

#### Scenario: System pi only

- **WHEN** managed pi is absent but `which("pi")` resolves and pi's tree contains jiti
- **THEN** `resolveJiti()` returns the system pi's `jiti-register.mjs` as a `file://` URL

#### Scenario: Anchor walk-up (Electron packaged)

- **WHEN** `process.argv[1]` is empty or a flag (packaged Electron) and `opts.anchor` is a valid `cliPath` inside a `node_modules` tree containing jiti
- **THEN** `resolveJiti({ anchor: cliPath })` returns the jiti URL resolved from that tree

#### Scenario: Windows drive-letter wrapping

- **WHEN** the resolved jiti path begins with `B:\` or any other URL-scheme-colliding drive letter
- **THEN** `resolveJiti()` returns `file:///B:/.../jiti-register.mjs` (drive letter URL-wrapped, backslashes normalised to forward slashes)

#### Scenario: All sources missing

- **WHEN** none of managed, system, anchor, or argv yield a jiti path
- **THEN** `resolveJiti()` returns null
- **AND** `launchDashboardServer` raises `JitiNotFoundError` when its caller did not supply a usable anchor

## REMOVED Requirements

### Requirement: Unified jiti resolution via `ToolResolver`
**Reason**: The `@mariozechner/pi-coding-agent` fork is no longer a supported pi; the old block's fork-specific scenarios cannot be dropped through MODIFIED.
**Migration**: Replaced by "Unified jiti resolution via `ToolResolver` anchored at earendil pi". Fork-only machines install `@earendil-works/pi-coding-agent`.
