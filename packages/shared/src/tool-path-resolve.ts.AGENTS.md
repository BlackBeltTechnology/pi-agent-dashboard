# tool-path-resolve.ts — index

Shared pi-parity path resolver: `resolveToolPath`, `resolveReadTarget`, `canonicalizeTarget` (realpath nearest ancestor; follows DANGLING symlinks component-wise from the link's real parent, 40-hop bound, throws on loop), `isWithinRoot`/`isPathWithinRoots` (component-wise, exact-first, volume-probe fold). Injectable `ResolveEnv` (`isSymlink?`/`readlink?` optional → legacy literals unchanged). Used by extension path-gate + `path-containment-guard`. See change: add-path-containment-guard-extension.

harden-agent-tool-guards: `ResolveEnv.lexists?` (non-throwing, non-following existence probe; the default env supplies it) lets `canonicalizeTarget` skip the throwing `realpathSync` for a missing path; `defaultVolumeProbe` is exported (path-gate carve-out case probe). See change: harden-agent-tool-guards.
