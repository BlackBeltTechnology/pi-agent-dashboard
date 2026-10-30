---
name: peers
scope: Probe pi-flows via tier-1/tier-2; detect name-skew.
symptoms:
  - flow engine not found
  - pi-flows missing
  - peer not resolving
depends-on:
  - pi-resolution
derives-from:
  - packages/shared/src/pi-package-resolver.ts (tier-2 model, live)
  - ~/.pi/agent/settings.json#packages[] (live)
  - resolved peer package.json name + version (live)
---

## SCOPE
Probe the `pi-flows` peer via tier-1 then tier-2, report the resolving tier, and
detect published-name skew after a rescope.

## KNOWLEDGE
Two resolution tiers:
- **Tier 1** — `createRequire(cwd+'/_').resolve(spec)`, anchored at the session
  launch cwd. Finds peers only in a `node_modules` ancestor of that cwd.
- **Tier 2** — `resolvePiPackageEntry(spec)` (`pi-package-resolver.ts`), walks
  `packages[]` in user + project `settings.json`. Makes an npm/git/local
  pi-installed peer resolve even when tier-1 misses.

A peer is PRESENT if tier-1 OR tier-2 resolves it.

Name-skew: a consumer may probe a peer name that no longer resolves after a
rescope (legacy alias vs the live scoped name). The current package resolves;
the stale name does not.

`pi-anthropic-messages` is no longer a peer: the dashboard's Claude subscription
compat switch (flows-plugin bridge) replaced it. An installed copy is harmless
but can be uninstalled. See change: retire-anthropic-messages-bridge.

## CHECKS
- `probePeer("pi-flows", { cwd })` — record tier + resolved path + version.
- Confirm the pi-flows `package.json` name is `@blackbelt-technology/pi-flows`
  (NOT the unrelated unscoped `pi-flows`).
- `detectNameSkew([...candidates], { cwd })` — `resolvedName` is the live
  package, `staleNames` the dead aliases.

## FIX ROUTING
- pi-flows missing → add `@blackbelt-technology/pi-flows` (≥0.3.2 npm or local
  develop) to `packages[]`; respawn the session.
- name-skew → adopt a release that probes the current package name, or load the
  local source.

## DERIVES-FROM
Live: `pi-package-resolver.ts` tier model, `settings.json#packages[]`, resolved
peer `package.json`. Hash sidecar: `peers.knowledge.hash`.
