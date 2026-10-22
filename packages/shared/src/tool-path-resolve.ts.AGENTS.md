# tool-path-resolve.ts — index

Shared pi-parity path resolver: `resolveToolPath`, `resolveReadTarget`, `canonicalizeTarget` (realpath nearest ancestor; follows DANGLING symlinks component-wise from the link's real parent, 40-hop bound, throws on loop), `isWithinRoot`/`isPathWithinRoots` (component-wise, exact-first, volume-probe fold). Injectable `ResolveEnv` (`isSymlink?`/`readlink?` optional → legacy literals unchanged). Used by extension path-gate + `path-containment-guard`. See change: add-path-containment-guard-extension.
