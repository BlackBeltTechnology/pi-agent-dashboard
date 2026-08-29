# Design — collapse-pairing-into-gateway

## D1. One pairing surface, named in the spec

The current spec says *"The dashboard web client SHALL provide an operator-side
pairing view"* — indefinite. Two components each read that as a mandate, which
is how the duplication survived review.

The spec is amended to name the surface: the Gateway **"Connect a device"**
surface (`GatewayPairQR`), rendered by both the Gateway settings page and the
toolbar Gateway dialog. Indefiniteness is the defect being fixed; a second
compliant implementation appearing later is still a regression.

**Use that name everywhere.** An earlier revision called it "Gateway ▸ Access &
QR" — but that is the *dialog tab* label (`GatewayDialog.tsx:100`), and the
Gateway settings page has no tabs. A surface identified by a label that exists
on only one of its two hosts reintroduces exactly the ambiguity D1 exists to
remove. The component's own eyebrow text, "Connect a device", is the name that
holds on both hosts.

## D2. Security keeps a link, not a stub component

Rejected: shrink `PairingView` to a link-only component.

A stub component is a re-entry point for the duplication — the next pairing
feature has an obvious file to grow into. `SettingsPanel` renders the link
inline under the existing `settings.pairDevice` section title, and the file is
deleted.

The section title stays. An operator looking for "Pair a device" under Security
finds the words they expect and one click to the act.

## D3. Port before delete — and port to the right CONDITION

`GatewayPairQR`'s empty state is a single sentence. `qr-device-pairing` requires
more:

```
#### Scenario: No secure road → empty state
- WHEN  GET /api/pair/payload returns no_reachable_endpoint
- THEN  … explain that a tunnel or publicly-trusted TLS URL is required
- AND   … offer an action to start a tunnel
- AND   … note the http://localhost escape hatch
```

`PairingView` satisfies all three (`pairing-start-tunnel` button + the localhost
paragraph). `GatewayPairQR` satisfies only the first. Deleting first would
regress a shipped requirement.

### The trigger is the payload error, NOT the endpoint count

The naive port — "add the action and the note to the `state === "empty"` block"
— is **wrong**, and would ship a silent regression. `GatewayPairQR.load()`:

```js
} else if (res.error === "no_reachable_endpoint") {
  setPayload(null);           // no TLS road
  setCopyStr("");
}
const { pairing, link } = splitEndpoints(eps);
setState(pairing.length + link.length === 0 ? "empty" : "ready");
```

`state === "empty"` means **zero endpoints of any kind**. The spec scenario
triggers on the **API error**. Those are different sets, and the difference is
the common case:

| endpoints present | payload | `state` | spec clause required? | naive port renders it? |
|---|---|---|---|---|
| none at all | — | `empty` | yes | yes |
| **link only (http LAN/mesh), no TLS** | `no_reachable_endpoint` | **`ready`** | **yes** | **NO** |
| TLS present | ok | `ready` | no | n/a |

The middle row is a plain LAN-only deployment. Today `PairingView` covers that
journey because it keys its empty state off `res.error`, not off an endpoint
count. After the delete, nobody would: the operator sees link-mode (a bare URL
and "no pairing, no secret") with no explanation of why pairing is unavailable,
no action, and no localhost note.

**Decision:** the explanation + action + localhost note render whenever
`getPairPayload()` returned `no_reachable_endpoint`, independent of `state`. In
the link-only case it renders **alongside** the link-mode panel, not instead of
it: the link QR is still a legitimate thing to use, it just is not pairing.

**Carry the condition in its own flag — do NOT infer it from `payload === null`.**
An earlier revision of this design proposed `payload === null && state !== "error"`.
That is wrong: `payload` is initialised `null` and `state` is initialised
`"loading"` (`GatewayPairQR.tsx:264-265`), so the predicate is true on every
mount and every Regenerate, and the "no secure road" block would **flash on a
perfectly healthy TLS deployment** before the fetch resolves. Tests that await a
settled state would never catch it.

The port therefore introduces an explicit `noSecureRoad` boolean, set only in the
`res.error === "no_reachable_endpoint"` branch of `load()` and cleared at the top
of every `load()`. Render on that flag. Derived-state shortcuts are what produced
the original two-implementation drift; this one gets a name.

## D3a. The setup action is never absent (it has a default)

The action's target differs by host:

| host | action |
|---|---|
| `GatewayDialog` (toolbar) | switch to the **Setup** tab |
| `GatewayPage` (settings) | focus the provider section — already on the page |
| any other / prop omitted | `navigate("/settings/gateway")` |

Rather than branch on host, the component takes an optional
`onSetupRequested?: () => void`. The dialog passes `() => setTab("setup")`; the
page passes a focus handler.

**The prop is optional; the ACTION is not.** An earlier revision of this design
said "absent the prop, the action is not rendered" — that would let the surface
D1 names as *the* pairing view render without an affordance the spec says it
SHALL offer. Instead the component falls back to `navigate("/settings/gateway")`,
a route that already exists (`TunnelButton.tsx:48`). A host may redirect the
action; no host may remove it.

**The fallback must not be a no-op on the page host.** `navigate("/settings/gateway")`
is correct from the dialog, but `GatewayPage` **is** `/settings/gateway` — an
unwired page host would render an action that navigates the operator to where
they already stand. That satisfies the letter of the SHALL while defeating it.
So: `GatewayPage` passing `onSetupRequested` is **required**, not optional
(task 2.6), and the fallback additionally scrolls the provider section into view
when the current route is already `/settings/gateway`, so even an unwired future
host does something real.

## D4. The Approve-at-zero defect dies with the file

`PairingView` disables Approve on `expired`. `GatewayPairQR` does not. No fix
task is needed: the violating line is deleted along with its component. The
spec's *"Advisory countdown does not gate approval"* scenario is retained
verbatim in the delta so the surviving surface stays pinned to it, and a
regression test asserts the surviving control is enabled at zero.

## D5. `QrCodeDialog` removal is folded in, not separated

It is a distinct concern (an orphan from `add-tunnel-providers`), but it is the
same blast radius — the same directory, the same QR subject, and the same
reviewer. Splitting it would mean two changes that both touch
`connectivity/AGENTS.md` and both need the same review context.

Evidence it is orphaned: `rg QrCodeDialog` outside markdown returns exactly
three source files — the component, its own test, and a stale comment in
`PairingView.tsx` (itself being deleted). **No component imports it.**

Two corrections to an earlier revision of this section:

- It is **not** "the same `AGENTS.md` file". Both components live in
  `connectivity/` (rows + `*.tsx.AGENTS.md` sidecars there), but both tests live
  in `components/__tests__/`, which carries no per-test rows. The doc work is
  therefore: two rows removed from `connectivity/AGENTS.md`, two sidecars
  deleted. Verified — `components/__tests__/` has no `AGENTS.md` rows for either.
- The reference census was incomplete: `TunnelButton.tsx.AGENTS.md` also names
  `QrCodeDialog`, in a `See change:` history note ("dialog swap from
  `QrCodeDialog`"). That is immutable change history, not a live reference — it
  stays.

## D6. i18n keys — sweep AFTER the port, not before

Keys used **only** by `PairingView` retire with it. Keys shared with other
surfaces stay. `settings.pairDevice` stays — it now titles the link section.

The retirement is mechanical: after the delete, every key the component
referenced is grepped across `packages/client/src`; zero-hit keys are removed
from every catalogue (`i18n.tsx`, `i18n-hu.ts`, and any sibling). This must not
be done by eye — `i18n-legacy-aliases.ts` already carries evidence of a prior
rename that left an alias behind.

**Ordering is load-bearing.** The ported empty state *reuses*
`PairingView`-only keys — `tunnel.startATunnel`, `common.localhostEscapeHatch`,
`common.pairingNeedsSecureRoad`. Sweeping before the port would retire keys the
surviving UI needs and silently drop their `hu` / `zh-CN` translations, leaving
English fallbacks. The sweep therefore runs in phase 7, after phases 2 and 5.
The port adds no new keys precisely because it reuses these three; the Security
link's copy is the only genuinely new string budget.

## D7. Display parity — two clauses the survivor does not fully satisfy

D1 names `GatewayPairQR` as *the* operator pairing view, which makes every
clause of the requirement its obligation. Two are currently only partly met, and
`PairingView` — the component being deleted — met both:

| spec clause | `PairingView` (deleted) | `GatewayPairQR` (survivor) |
|---|---|---|
| "SHALL display the server fingerprint `id`" | full `id` (`pairing-fingerprint`) | `id.slice(0, 12)` (line 369) |
| "the list of `urls[]` currently advertised" | `payload.urls.map(…)` (`pairing-url`) | `NetworkSelector` over `getGatewayEndpoints()` |

**Fingerprint.** A 12-char prefix is a reasonable display, but an operator
comparing it against a device showing the full fingerprint sees a mismatch, and
the spec says `id`, not a prefix. Decision: render the full `id` in a
selectable, wrapping element; keep the 12-char form only as the compact caption
under the QR.

**`urls[]`.** The selector lists *gateway endpoints*, which is a different
source from the payload's `urls[]` — the payload is TLS-filtered server-side, so
the two sets can legitimately differ. Rendering endpoints is not the same as
rendering "the list of `urls[]` currently advertised". Decision: the pairing
context panel shows `payload.urls[]` explicitly when a pairing endpoint is
selected. This is what the device will actually try, and it is the set the
security claim is about.

Neither is a redesign — both are small additions to the surviving panel, and
both are required by D1's own premise.

## D7a. Selection coupling — scoped in the spec, not "fixed"

`GatewayPairQR.tsx:326` gates the whole payload panel on the current selection:

```js
const pairingPayload = selected && payload && isPairingEligible(selected) ? payload : null;
```

Select a non-TLS link row while a healthy payload is loaded and the fingerprint,
countdown, copy-string, QR and approval control all disappear. `PairingView` had
no such coupling — it showed the payload whenever one existed.

This is **deliberate**, not drift: it is D14's transport split, and a link
endpoint genuinely has no payload to display. But the requirement body as first
drafted asserted the display clauses unconditionally, which the surviving surface
would then violate in that state. The delta now scopes those clauses to "a
pairing-eligible endpoint is the current selection", and records that the default
selection on open is a TLS endpoint when one exists — so the default state is
compliant and the swap is specified rather than accidental.

**Observed, deliberately not fixed here:** switching selection unmounts the
approval panel, discarding a half-typed confirmation code. Annoying, not unsafe
— the code is read off the device and retypable. Preserving it is a behaviour
change to the selector, which is outside a deletion change. Recorded so it is a
known cost rather than a surprise.

## D8. A new dependency the deleted surface did not have

`PairingView` depended on one call: `GET /api/pair/payload`. `GatewayPairQR`
also calls `getGatewayEndpoints()`, and a throw there lands in the `catch` and
sets `state = "error"` for the whole surface.

After this change that is the *only* pairing surface, so an endpoints-API
failure removes pairing entirely where previously Settings ▸ Security still
worked. Accepted as a trade-off rather than fixed here — hardening the endpoints
fetch is out of scope for a deletion change — but it is recorded, and phase 3
carries a test pinning the behaviour so the degradation is deliberate and
visible rather than discovered in an incident.

The blast radius is narrower than it first looks: `GatewayPairQR` already accepts
a `providedEps` prop (line 276) that bypasses `getGatewayEndpoints()` entirely, so
a host holding endpoints can inject them. That lever exists but no current host
uses it for resilience — noted so a future fix has an obvious hook rather than
needing a redesign.

## Open questions

*(Both were answered during the doubt-review; kept with their answers so the
reasoning is not re-litigated.)*

- **Does any doc point an operator at Settings ▸ Security to pair?**
  `docs/architecture.agent.md` and `docs/qa/archived-frontend-test-cases.md`
  both name `PairingView`. The first needs updating; the second is archived QA
  history and stays. Task 1.1 names both.
- **Does an e2e spec assert the Security pairing testids?** No.
  `tests/e2e/pairing-qr.spec.ts` drives approval through the `request` fixture,
  not the Security UI. Nothing to relocate — phase 5 is a clean delete.
