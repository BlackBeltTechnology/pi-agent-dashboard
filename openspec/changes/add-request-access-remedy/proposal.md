## Why

`add-lan-knock-pairing` ships the knock (`POST /api/pair/request`) and the banner's Request access action, but defers the `request-access` remedy on `operate_required` refusals: `surface-operate-required-remedy` (not archived when the knock shipped) owns the `remedies` list, and a MODIFIED delta against `operate-required-remedy` cannot validate until that change archives.

## What Changes

- Add a `request-access` entry to the `remedies` list of an `operate_required` refusal, per `add-lan-knock-pairing` design D10: include it iff the caller presents **no credential** AND its socket peer passes the knock's `knock_not_lan` gate (private, on-link, no forwarding header). The rule never reads `pairing.acceptLanRequests` or knock state, so it discloses only the caller's own network position.
- MODIFIED delta against `trust-and-credential-boundaries` ("Access-posture disclosure keeps its existing predicate") recording that this is a deliberate **exception** to `canDiscloseAccessPosture`, not an application of it.
- Client: render the remedy as a link to the server's `/pair?request` (same origin → navigate; another server → open that server's own page without an opener).

**Blocked on:** `surface-operate-required-remedy` archiving (it creates the `operate-required-remedy` main spec the delta modifies).

## Capabilities

### Modified Capabilities
- `operate-required-remedy`: gains the `request-access` remedy and its presence rule.
- `trust-and-credential-boundaries`: records the disclosure exception.

## Discipline Skills

- `security-hardening` — a new disclosure of the caller's network position to an unauthenticated caller; confirm it reveals nothing beyond what the caller already knows.
- `doubt-driven-review` — the exception to `canDiscloseAccessPosture` must be stress-tested before it stands.
- `review-code` — before commit.

## Impact

- Server: `operate-required` refusal builder (`packages/server/src/auth/operate-required.ts`) and its remedy list; reuses the knock's peer predicate from `auth/localhost-guard.ts` (`isOnLinkPrivate`).
- Client: the operate-required remedy renderer.
- Rollback: drop the remedy entry; the banner / Network Discovery / `/pair?request` routes to the knock are unaffected.
