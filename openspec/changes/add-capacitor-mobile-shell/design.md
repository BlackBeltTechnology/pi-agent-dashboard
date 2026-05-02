## Context

The dashboard's React client is already decoupled from the server it talks to: `App.tsx` derives `wsUrl` from `window.location` by default, but the entire `ServerSelector` / known-servers / mDNS-discovery infrastructure exists to override that default. This makes Capacitor packaging a *thin* exercise — the client doesn't fork, doesn't grow a native-only branch, just learns to ask the user for a server URL when `window.location` is meaningless (because we're inside a `capacitor://` shell).

The push-notification work in `add-server-push-notifications` defines the server contract: `POST /api/push/register` with `{deviceToken, transport: "fcm"}`. Capacitor's `@capacitor/push-notifications` plugin produces exactly this token via FCM on Android and APNs-via-FCM on iOS (Firebase forwards APNs through). One client-side adapter; everything else reuses the server.

**Stakeholders**: client maintainers (small App.tsx + hooks changes), CI maintainers (new Android + iOS lanes), release maintainers (keystore + Apple cert custody), end-users (gain APK + TestFlight builds with native push).

**Dependencies**:
- `add-server-push-notifications` MUST be implemented before this change. This change depends on `/api/push/register`, `pushDispatcher`, and the `transport: "fcm"` adapter.
- A Firebase project + service-account JSON. Required at server-side for FCM dispatch (per the push change). Required at client-side for FCM token acquisition (Capacitor plugin reads `google-services.json` for Android and `GoogleService-Info.plist` for iOS).
- An Apple Developer account ($99/yr). Required for iOS signing, push capability, TestFlight distribution.
- An Android upload keystore (free, generated locally once). Required for APK signing.

## Goals / Non-Goals

**Goals:**
- Single source of UI truth: the React client at `packages/client/src/` serves both web and mobile. No fork. No native-only screens.
- Distribution via GitHub Releases (Android APK) and TestFlight (iOS) without requiring Play Store / App Store accounts in v1.
- Native FCM token acquisition on Android and iOS, fed into the existing `/api/push/register` server endpoint.
- Native mDNS discovery on both platforms, replacing the empty-on-browser experience.
- OS-keychain credential storage on both platforms, replacing `localStorage` for the auth token.
- CI lanes that produce signed artifacts on every release tag, attached to the GitHub Release (Android) or uploaded to TestFlight (iOS).
- The signing keystore for Android MUST be the same key forever — losing it orphans every installed APK.

**Non-Goals:**
- Replacing or removing the PWA. The PWA continues to serve users who don't want to install an APK / TestFlight build. The mobile shell is additive distribution.
- A native UI layer. We are NOT writing Kotlin / Swift screens; everything stays React.
- Embedded server. The mobile shell is a remote client, not a self-contained dashboard.
- Multi-account or per-user push routing. v1 is single-user; same as the rest of the dashboard.
- Web Push on Capacitor. We use FCM on native; Web Push remains for the actual web PWA.

## Decisions

### Decision 1 — One `packages/mobile/` workspace, not a top-level project

**Why**: keeps build artifacts inside the monorepo, lets `npm install` from the root work for everyone, and matches the existing package layout (`packages/client`, `packages/server`, `packages/electron`, etc.). The `mobile` package consumes `packages/client/dist/` via a sync script — no compile-time dependency, just a copy step.

**Tradeoff**: `node_modules/` size grows. Capacitor + plugins is ~50 MB; rounding error vs. the existing electron tooling.

### Decision 2 — Bundled web assets, no `server.url` in `capacitor.config.ts`

**Why**: shipping `server.url: "https://..."` would make the APK a thin loader that fetches the dashboard client over HTTP at launch, which (a) breaks offline, (b) has worse cold-start performance, (c) creates a same-origin / CORS / cleartext-LAN nightmare. Bundling the JS/CSS into `www/` makes the WebView load from a `capacitor://` origin and the WebSocket / REST calls go to a separately-configured server URL. This is the model Capacitor itself recommends for "remote-controlled" clients.

**Tradeoff**: every release ships a full client bundle inside the APK. Bundle size today is ~1.5 MB gzip. Acceptable.

### Decision 3 — Token-paste auth in v1, defer OAuth deep-link

**Why**: OAuth in WebViews is blocked by Google and ill-advised by Apple. The right pattern (`@capacitor/browser` + deep-link callback) is well-defined but adds a `pi-dashboard://` URL scheme registration on both platforms, deep-link handlers in the React app, and a server-side callback redirect target — a non-trivial slice. Token-paste reuses the existing `config.secret` field that already auths every dashboard install. v1 audience is technical; this is fine.

**Rejected**: API-key only with no token-paste UI — too rough; users would have to manually edit `localStorage`.

### Decision 4 — Same Android signing key for sideload and Play Store

**Why**: if a user installs the GitHub-Releases APK and we later list the same `appId` on Play Store with a different signing key, those users CANNOT upgrade — Android refuses the install ("signatures don't match"). They'd have to uninstall + reinstall, losing local state. Solution: generate the keystore once, use it for both. Document the backup process. Optionally: enable Play App Signing later (Google holds the app key; we keep the upload key) — but that's a one-way migration.

### Decision 5 — TestFlight is the iOS distribution mechanism for v1

**Why**: Apple does NOT permit `.ipa` files distributed via GitHub Releases for general users. The only realistic non-store distribution paths are TestFlight (Apple-blessed beta), Enterprise Distribution ($299/yr, restricted use), or AltStore-style sideloading (user-hostile, breaks weekly). TestFlight is free with the $99/yr developer account, supports up to 100 internal testers and 10 000 external testers, and reviews are typically <24 hours.

**Tradeoff**: every iOS build needs a fresh TestFlight upload (90-day expiry per build means we re-release every 3 months minimum, which our release cadence likely exceeds anyway).

### Decision 6 — `@capacitor/push-notifications` for both Android FCM and iOS APNs (via Firebase)

**Why**: one plugin, one configuration, one server-side transport. Firebase forwards APNs through their infrastructure, so iOS push lands at the same FCM endpoint our server already uses. This is exactly what `add-server-push-notifications` design.md Decision 3 anticipated.

**Rejected**: direct APNs from the server. Would require a second server-side transport adapter and an Apple Push key (.p8) in addition to the Firebase service-account JSON. Not justified for v1.

### Decision 7 — Native mDNS via Capacitor plugin, with manual-add fallback

**Why**: Browsers cannot do mDNS, full stop. On native, it's a 50-LOC Java/Swift wrapper around `NsdManager` / `NetServiceBrowser`. We evaluate `capacitor-zeroconf` (community plugin); if it's unmaintained or buggy, we fork or write our own. The existing `NetworkDiscoverySection.tsx` already has a "manual add" form (per the change `diagnose-empty-mdns-scan`); native mDNS just feeds the same data source.

### Decision 8 — `network_security_config.xml` allows cleartext for RFC1918 ranges only

**Why**: a phone on a home Wi-Fi connecting to `ws://192.168.1.10:8000` is the common case. Allowing cleartext globally is bad. Allowing for RFC1918 (10/8, 172.16/12, 192.168/16) and link-local (169.254/16) covers LAN without opening up the internet.

```xml
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">192.168.0.0/16</domain>
    <!-- ...10/8, 172.16/12... -->
  </domain-config>
  <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```

iOS uses ATS exceptions in `Info.plist` for the same effect.

### Decision 9 — CI lanes are `needs: [prepare, publish]` and `strategy.fail-fast: false`

**Why**: matches the electron job pattern. `needs: publish` ensures we build the mobile app against the just-published npm packages (the bundled client is built from `packages/client`, which is fine, but if we ever want runtime version checks against published server packages, this is a free win). `fail-fast: false` keeps an iOS signing failure from canceling Android.

## Risks / Trade-offs

- **Apple review surprises**. An "agent dashboard" app could trip Apple's "executes arbitrary code" rule. We must be ready to argue: "this app DISPLAYS a remote agent that runs entirely on the user's own machine; it does not execute code locally." Mitigation: comprehensive App Store metadata, demo account credentials in the review notes, screen recording showing the app is read-only-with-prompts.
- **Keystore loss = catastrophic**. Document, back up, store in 1Password AND a separate offline backup. This is the single most important non-code asset we own.
- **TestFlight 90-day expiry**. If we release infrequently (>90 days between iOS builds), TestFlight users get cut off. Mitigation: at least one iOS build per quarter, even if just a no-op version bump.
- **Capacitor plugin drift**. `capacitor-zeroconf` is maintained by a single hobbyist; if it goes stale we own a small native plugin. Acceptable; the surface area is tiny.
- **`google-services.json` is a public-but-not-secret file**. Committed to the repo for the mobile build to find. Firebase explicitly designs this file to be safe to embed; the secret is the server-side service-account JSON, not the client-side google-services.
- **First-launch UX**. The user opens the app, sees no server, must add one. We must make this onboarding friction-free. Existing `NetworkDiscoverySection` + manual-add covers it but deserves polish — flagged as a UX task.
- **Cleartext to LAN can leak via VPN**. If a user is on a VPN that exposes their phone to a hostile LAN, cleartext to 192.168.x.x is risky. Documented in `docs/mobile-builds.md`; mitigated by the trusted-networks server-side gate (already present).
- **iOS push requires an entitlement**. The Apple App ID must have Push capability enabled. One-time setup; documented.

## Migration Plan

This is purely additive distribution:

1. Land `add-server-push-notifications` server-side. PWA users gain Web Push. No mobile change yet.
2. Generate signing keystore (Android) and Apple cert + provisioning profile (iOS). Store in GitHub secrets.
3. Land `add-capacitor-mobile-shell` client + CI changes. First release tag triggers Android APK + iOS TestFlight builds.
4. Document install instructions in README. Users sideload APK or accept TestFlight invite.
5. (Future) Submit to Play Store. The same APK + signing key just need a Play Store listing.
6. (Future) Submit to App Store. The same TestFlight build is "promoted" to App Store via App Store Connect.

No data migration. PWA users continue using the PWA. Mobile shell is opt-in.
