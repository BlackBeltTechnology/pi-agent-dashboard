## Why

`add-lan-knock-pairing` ships the knock (`POST /api/pair/request`) and the banner's Request access action, but defers the `request-access` remedy on `operate_required` refusals: `surface-operate-required-remedy` (not archived when the knock shipped) owns the `remedies` list, and a MODIFIED delta against `operate-required-remedy` cannot validate until that change archives.

## What Changes

- Add a `request-access` entry to the `remedies` list of an `operate_required` refusal, per `add-lan-knock-pairing` design D10: include it iff the caller presents **no verified credential** AND the knock's pre-switch gates pass for it — Host admission (enforce semantics; a tightening of D10, see design D3) and `knock_not_lan` (private, on-link, no forwarding header). The rule never reads `pairing.acceptLanRequests` or knock state, so it discloses only the verdict the public knock route already returns to the same caller (Host admitted? on-link?). It reaches the credential-less callers a trusted-network entry admits; untrusted LAN browsers get `network_not_allowed` and the banner's Request access instead (design: Reachable population).
- ADDED requirement in `trust-and-credential-boundaries` recording that this is the one deliberate **exception** to `canDiscloseAccessPosture` ("Access-posture disclosure keeps its existing predicate"), not an application of it. ADDED rather than MODIFIED because two in-flight changes already rewrite the requirement holding that sentence; it states its precedence over that sentence explicitly (design D6). The remedy follows the knock gates when `retire-trusted-networks-bypass` widens them (design: Coordination).
- The restated requirement scopes "every route" to the vault and services families (the message table already covered only those) and corrects its `reason` / `re-pair` text to match shipped code for login sessions. `packages/obs-studio-plugin` keeps its pre-existing remedy-less refusal (out of scope).
- Client: render the remedy in the Vault callout as a link to the refusing server's `/pair?request` (same origin → navigate; another server → open that server's own page without an opener), sharing the target rule with the banner's Request access.

**Unblocked:** `surface-operate-required-remedy` and `add-lan-knock-pairing` are archived; the `operate-required-remedy` main spec exists.

## Capabilities

### Modified Capabilities
- `operate-required-remedy`: gains the `request-access` remedy and its presence rule.
- `trust-and-credential-boundaries`: records the disclosure exception (ADDED requirement).

## Discipline Skills

- `security-hardening` — a new disclosure of the caller's network position to an unauthenticated caller; confirm it reveals nothing beyond what the caller already knows.
- `doubt-driven-review` — the exception to `canDiscloseAccessPosture` must be stress-tested before it stands.
- `review-code` — before commit.

## Impact

- Server: `operate-required` refusal builder (`packages/server/src/auth/operate-required.ts`) and its remedy list; the knock's pre-switch gates extracted as `knockPeerGate()` in `pairing/knock-admission.ts` and shared; `shared/src/operate-required.ts` remedy type/order; `server.ts` wiring.
- Client: `OperateRequiredCallout.tsx` row; new `lib/pairing/request-access-target.ts` shared with `ConnectionStatusBanner.tsx`; i18n keys (`hu`, `zh-CN`).
- Rollback: drop the remedy entry; the banner / Network Discovery / `/pair?request` routes to the knock are unaffected.
