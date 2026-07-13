---
name: peers
scope: Probe pi-flows + anthropic-messages via tier-1/tier-2; detect name-skew.
symptoms:
  - flow engine not found
  - pi-flows missing
  - anthropic peer missing
  - waiting_peers
  - bridge waiting for peers
  - peer not resolving
depends-on:
  - pi-resolution
derives-from:
  - packages/flows-anthropic-bridge-plugin/src/peer-probe.ts (tier model, live)
  - ~/.pi/agent/settings.json#packages[] (live)
  - resolved peer package.json name + version (live)
---

## SCOPE
Probe each peer (`pi-flows`, anthropic-messages) via tier-1 then tier-2, report
the resolving tier, and detect published-name skew after a rescope.

## KNOWLEDGE
Two resolution tiers (mirrors `peer-probe.ts`):
- **Tier 1** — `createRequire(cwd+'/_').resolve(spec)`, anchored at the session
  launch cwd. Finds peers only in a `node_modules` ancestor of that cwd.
- **Tier 2** — `resolvePiPackageEntry(spec)`, walks `packages[]` in user +
  project `settings.json`. Makes an npm/git/local pi-installed peer resolve even
  when tier-1 misses.

A peer is PRESENT if tier-1 OR tier-2 resolves it.

Name-skew: a published bridge may probe a peer name that no longer resolves
after a rescope (e.g. legacy `@pi/anthropic-messages` when the live package is
`@blackbelt-technology/pi-anthropic-messages`). The current package resolves;
the stale name does not → the shipped bridge version carries a dead name.

## CHECKS
- `probePeer("pi-flows", { cwd })` — record tier + resolved path + version.
- Confirm the pi-flows `package.json` name is `@blackbelt-technology/pi-flows`
  (NOT the unrelated unscoped `pi-flows`).
- `detectNameSkew(["@blackbelt-technology/pi-anthropic-messages", "@pi/anthropic-messages"], { cwd })`
  — `resolvedName` is the live package, `staleNames` the dead aliases.
- Neither name resolving → the dependent bridge parks in `waiting_peers`; name
  the failed peer + resolver reason.

## FIX ROUTING
- pi-flows missing → add `@blackbelt-technology/pi-flows` (≥0.3.2 npm or local
  develop) to `packages[]`; respawn the session.
- anthropic peer missing → add the peer to `packages[]`; ensure the loaded
  bridge probes the NEW name first (load local / ≥ released bridge).
- name-skew on a published bridge → cut/adopt a bridge release that probes the
  current package name, or load the local bridge source.

## DERIVES-FROM
Live: `peer-probe.ts` tier model, `settings.json#packages[]`, resolved peer
`package.json`. Hash sidecar: `peers.knowledge.hash`.
