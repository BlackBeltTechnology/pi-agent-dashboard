## ADDED Requirements

### Requirement: Capacitor packaging without forking the client
The mobile app SHALL be a Capacitor wrapper around the existing React client at `packages/client/`. There SHALL be no forked client code, no native-only screens, no parallel React tree. The mobile package (`packages/mobile/`) SHALL consume `packages/client/dist/` via a sync script and produce signed Android and iOS artifacts. Behavior differences (Capacitor detection, native push, native mDNS, OS-keychain storage) SHALL be implemented as runtime branches in the existing client, gated by a single `isCapacitorNative()` predicate.

#### Scenario: Web build behavior unchanged
- **WHEN** the client is built and served as the standalone web app
- **THEN** `isCapacitorNative()` SHALL return `false`
- **AND** all behavior SHALL be identical to the pre-change client

#### Scenario: Native build behavior gated
- **WHEN** the client is loaded inside the Capacitor shell on Android or iOS
- **THEN** `isCapacitorNative()` SHALL return `true`
- **AND** all native-specific paths (push, mDNS, keychain) SHALL activate
- **AND** the React component tree SHALL render the same UI as the web build (modulo data-source differences for mDNS)

### Requirement: First-launch landing screen is the server picker
On a fresh native install with no previously-saved server, the app SHALL NOT default `wsUrl` to a `window.location`-derived value (which is meaningless inside a `capacitor://` shell). Instead, it SHALL render the existing `ServerSelector` / known-servers / mDNS-discovery UI as the landing screen.

#### Scenario: Fresh install, no saved server
- **WHEN** the user opens the app for the first time
- **THEN** the landing screen SHALL be the server-selection UI
- **AND** no "disconnected" error banner SHALL flash before the user has selected a server

#### Scenario: Returning user with a saved server
- **WHEN** the user has previously added a server and it is reachable
- **THEN** the app SHALL connect automatically on launch using the persisted entry

### Requirement: Native push registration via Capacitor plugin
On native platforms, the client SHALL acquire a push token via `@capacitor/push-notifications`, request OS permission, and register the token with the dashboard server via `POST /api/push/register` with `transport: "fcm"`. The server contract is unchanged from `add-server-push-notifications`.

#### Scenario: User grants permission
- **WHEN** the user enables push in Settings on a native platform
- **THEN** the app SHALL call `PushNotifications.requestPermissions()`, on grant call `register()`, capture the FCM (Android) or APNs-via-FCM (iOS) token from the `'registration'` event, and POST to `/api/push/register` with `transport: "fcm"`

#### Scenario: User denies permission
- **WHEN** the user denies the OS permission prompt
- **THEN** the Settings UI SHALL display a clear "Push permission denied — re-enable in OS settings" message
- **AND** no token registration SHALL occur

#### Scenario: Notification tap routes to session
- **WHEN** the user taps a delivered push notification with `payload.url = "/session/abc-123"`
- **THEN** the app SHALL launch (or foreground) and navigate to the corresponding session view

### Requirement: Native mDNS discovery
On native platforms, the `NetworkDiscoverySection` SHALL use a native mDNS plugin (Capacitor zeroconf or equivalent) to scan for `_pi-dashboard._tcp` advertisements on the local network. Discovered servers SHALL be mapped into the existing `KnownServerCandidate` shape and rendered through the same UI used by the server-side scan path.

#### Scenario: Native scan finds a server on LAN
- **GIVEN** a phone and a dashboard server are on the same Wi-Fi network
- **WHEN** the user opens Network Discovery on the phone
- **THEN** the discovered server SHALL appear in the list within 5 seconds
- **AND** tapping "Add" SHALL persist it to known-servers via the same code path the manual-add form uses

#### Scenario: Web build does not perform native scan
- **WHEN** Network Discovery is opened in a desktop browser
- **THEN** the existing browser-side scan path SHALL be used (delegated to the server)
- **AND** the native mDNS plugin SHALL NOT be referenced

#### Scenario: Manual-add fallback still present on native
- **WHEN** the native scan finds zero servers
- **THEN** the existing manual-add form SHALL be visible exactly as it is on web

### Requirement: OS-keychain credential storage
On native platforms, the dashboard auth token SHALL be stored via `@capacitor/preferences` (Keychain on iOS, EncryptedSharedPreferences on Android). On web, the existing `localStorage` path SHALL remain. A wrapper helper `secure-store.ts` SHALL abstract the difference so callers do not branch.

#### Scenario: Token persisted to Keychain on iOS
- **WHEN** the user saves an auth token in Settings on iOS
- **THEN** the token SHALL be stored via `@capacitor/preferences` (which uses Keychain underneath)
- **AND** the value SHALL NOT be present in `localStorage`

#### Scenario: Token persisted to localStorage on web
- **WHEN** the user saves an auth token in Settings in a desktop browser
- **THEN** the token SHALL be stored in `localStorage` via the same helper

### Requirement: Cleartext to LAN, no cleartext to internet
The Android `network_security_config.xml` SHALL permit cleartext (`http://`, `ws://`) traffic ONLY to RFC1918 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) and link-local (169.254.0.0/16). The base config SHALL deny cleartext for all other domains. iOS `Info.plist` SHALL use `NSAllowsLocalNetworking` for the equivalent constraint.

#### Scenario: WebSocket to LAN server works
- **WHEN** the app attempts to connect to `ws://192.168.16.202:8000`
- **THEN** the connection SHALL succeed (modulo server reachability)

#### Scenario: WebSocket to public cleartext IP is blocked
- **WHEN** the app attempts to connect to `ws://example.com:8000` (public IP)
- **THEN** the connection SHALL be blocked by the OS with a clear error
- **AND** the user SHALL be advised to use `wss://` or zrok

### Requirement: Signed Android APK in GitHub Releases
Every `v*` release tag SHALL produce a signed Android APK (`app-release.apk`) and an Android App Bundle (`app-release.aab`). The APK SHALL be attached to the GitHub Release. The AAB SHALL be uploaded as a workflow artifact for later Play Store submission. Both SHALL be signed with the same upload keystore stored in `secrets.ANDROID_KEYSTORE_BASE64`.

#### Scenario: Release tag triggers signed APK
- **WHEN** a `v*` tag is pushed (or `workflow_dispatch` is invoked)
- **THEN** the `mobile-android` job SHALL produce `app-release.apk` signed with the configured keystore
- **AND** the APK SHALL be attached to the GitHub Release for that tag

#### Scenario: Keystore secret missing
- **WHEN** the `mobile-android` job runs without `ANDROID_KEYSTORE_BASE64` configured
- **THEN** the job SHALL fail with a clear error
- **AND** other matrix jobs SHALL continue (`fail-fast: false`)

### Requirement: TestFlight upload for iOS
Every `v*` release tag SHALL produce a signed iOS `.ipa` and upload it to TestFlight via `xcrun altool` (or fastlane equivalent). The build SHALL be signed with the configured Apple Developer certificate and provisioning profile.

#### Scenario: Release tag triggers TestFlight upload
- **WHEN** a `v*` tag is pushed
- **THEN** the `mobile-ios` job SHALL produce a signed `.ipa` and upload it to App Store Connect
- **AND** the build SHALL appear in TestFlight within the Apple-determined propagation window

#### Scenario: iOS lane failure is isolated
- **WHEN** iOS signing fails (e.g. cert expired)
- **THEN** the `mobile-ios` job SHALL fail
- **AND** the `mobile-android` job SHALL still complete and attach its APK
- **BECAUSE** `strategy.fail-fast: false` is set

### Requirement: CI lanes block on publish
Both `mobile-android` and `mobile-ios` jobs SHALL declare `needs: [prepare, publish]` so they run AFTER the npm publish step has completed. The `publish-workflow-contract.test.ts` SHALL be extended to assert this contract (mirroring the electron-job contract).

#### Scenario: Publish must succeed first
- **WHEN** the publish job fails for any reason
- **THEN** neither mobile job SHALL run
- **BECAUSE** `needs: publish` gates them

#### Scenario: Contract test catches misconfiguration
- **WHEN** a developer removes `publish` from the mobile jobs' `needs` array
- **THEN** the publish-workflow-contract test SHALL fail the build with a citation to this change name

## ADDED Requirements

### Requirement: Token-paste auth in v1
The v1 mobile shell SHALL authenticate via the existing `config.secret` token-paste mechanism. On native platforms, the token SHALL be stored via the OS keychain (per the credential-storage requirement). OAuth deep-link flow is explicitly out of scope for v1 and SHALL be tracked as a separate change.

#### Scenario: User pastes a token
- **WHEN** the user enters a server URL and a secret token in the Settings UI
- **THEN** subsequent REST and WebSocket requests SHALL include the token as the auth credential
- **AND** the token SHALL be persisted to the OS keychain via `secure-store`

#### Scenario: OAuth attempt is documented
- **WHEN** the user expects to log in via Google or GitHub on the mobile shell
- **THEN** the Settings UI SHALL display a clear "OAuth on mobile is coming soon — use a token for now" message linking to the desktop token-generation flow
