# Design — bump-pi-compat-to-0-76

## Context

Pi 0.76.0 ships ~6 hours after the 0.75 floor bump landed. The delta is small: one breaking change the dashboard never touches (`xiaomi` provider billing migration), four additive features (`--session-id`, RPC `excludeFromContext`, bounded Codex retries, terminal-editing polish), and ~15 fixes. The dashboard exercises none of these directly today, so the change reduces to tracking the version number forward.

## Decision 1 — Lift floor and recommended together to 0.76.0

The 0.76 line currently has only `0.76.0`. The spec rule "`recommended` SHALL be no more than one minor release behind the latest published" allows `0.75.5` or `0.76.0`. We pick `0.76.0` because the floor is also `0.76.0`, and lockstep avoids the special-case where `minimum > recommended` (which would render the upgrade-hint banner in an awkward state).

When `0.76.1` ships, a follow-up bumps `recommended` only (not floor) to surface the soft upgrade hint without forcing pi 0.75 users into a hard error.

## Decision 2 — No Node engines change

Pi 0.76 did not raise its Node minimum. The 0.75 line already requires `22.19.0`; 0.76 inherits that. The dashboard's `engines.node` (`>=22.19.0 <25` root, `>=22.19.0` server) and `node-guard.ts::isAffectedNode` (refuses `22.x < 19`) remain correct.

## Decision 3 — Bundled-extension peer-deps move in lockstep

Per the spec requirement modified in `bump-pi-compat-to-0-75`, `piCompatibility.minimum` SHALL match the bundled-extension peer-dep constraints. We bump:

- `pi-anthropic-messages/package.json` peer `>=0.75.0` → `>=0.76.0`
- `pi-flows/package.json` peer + dev for `pi-ai` / `pi-coding-agent` / `pi-tui` `^0.75.0` → `^0.76.0`

The catch-all grep covers any new bundled extension that might have landed between this change and the previous one.

## Decision 4 — Ignore the xiaomi breaking change

The dashboard does not register, surface, or test the `xiaomi` provider. Confirmed via `grep -ri 'xiaomi\|mimo'` over `src/` and `packages/` — zero hits. No mitigation needed.

## Decision 5 — Defer adoption of new 0.76 surface

`--session-id`, RPC `excludeFromContext`, `retry.provider.maxRetries` enforcement, and the new Codex transport timeouts are all interesting but additive. Folding adoption into the floor-bump would bloat the diff and delay shipping. Each gets a follow-up issue if user value justifies the work.

## Risks

- **0.76.0 regression discovered post-merge**: If a critical bug surfaces in 0.76.0, pi 0.75 users blocked by our floor have no path forward except waiting for pi 0.76.1. Mitigation: keep `recommended` mobile — bump it to `0.76.1` independently without forcing the floor.
- **Bundled-extension peer-dep mismatch**: a fresh `npm install` of a bundled extension against a host pi 0.75.x would fail peer-dep resolution. This is the intended signal — users running pi 0.75.x cannot use bundled extensions until they upgrade. Matches the floor semantics.

## Rollback

Revert the three manifest edits + the `bundled-node-meets-pi-floor.test.ts` table row. No persisted state to clean up.
