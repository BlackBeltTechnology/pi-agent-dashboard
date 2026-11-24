# DOX — packages/client/src/lib/live-preview

Files in this directory. One row per source file. See change: improve-canvas-html-and-url-ux.

| File | Purpose |
|------|---------|
| `exposure-store.ts` | External store for the WS `preview_exposure_changed {epoch}` push (`notifyExposureChanged`, `subscribeExposure`, `getPushedExposureEpoch`). |
| `cookie-reset.ts` | 10.6: `installCookieResetFetch()` (innermost fetch wrapper, observes 400 `duplicate_dashboard_cookie`), `noteDuplicateCookieRefusal`, `useCookieResetEpoch`, `isCookieTossTier` (2/3). `LiveFrame` blanks tier-2/3 frames to `about:blank` + banner when the epoch passes the one it opened under; only Reload/reopen re-mints. |
| `frame-guard.ts` | D6(b): `isDashboardBootBlocked(win)` (framed with `data-pi-live-frame` or `frameElement===null` ⇒ the SPA boots nothing: `bootClient` + `main.tsx` gate), `isFrameSameOriginReadable(frame)` (post-`load` probe ⇒ viewer blanks + "Preview navigated to the dashboard; blocked"), `LIVE_FRAME_ATTR`. |
| `preview-policy.ts` | Pure: provenance→egress, `sandboxFor` (D3 table, never allow-same-origin), `wantedPolicy`/`needsRunScripts`, `parsePresetPath` (`live:`/`static:`), `classifyAddress` (shared `validateAddressPath`), `isLocalOperator`, `localTargetUrl`. |

- `mint-response.ts`: `validateMintResponse(json, ownOrigins)` — the ONLY mint shapes the viewer frames (tier 1/2/4 origin + `/`, tier 3 origin + `/?k=`, tier 5 `/preview/<pid>/` with no origin/base, legacy `/live/<id>/~c/<token>/`; an origin equal to the dashboard's own is rejected). `preview-policy.ts`: `frameSrc(apiBase, cap, deep)` (origin+base+deep, tier-3 `?k=&to=` hop, else API base + path), `sandboxFor(policy, tier)` (`allow-same-origin` only tiers 1-4 with scripts). See change: serve-live-previews-on-capability-origin.
