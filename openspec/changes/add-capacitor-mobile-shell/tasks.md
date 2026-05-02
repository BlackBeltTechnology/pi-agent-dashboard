# Tasks

## 1. Preconditions

- [ ] 1.1 Confirm `add-server-push-notifications` is merged and `/api/push/register` is live with `transport: "fcm"` support.
- [ ] 1.2 Generate Android upload keystore via `keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`. Back up to 1Password AND offline storage. Encode base64 for `secrets.ANDROID_KEYSTORE_BASE64`.
- [ ] 1.3 Set up Apple Developer account ($99/yr). Create App ID `io.blackbelt.pi-dashboard` with Push Notifications capability enabled.
- [ ] 1.4 Create Firebase project. Enable Cloud Messaging. Download `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) and the server-side service-account JSON. Document where each file lives.
- [ ] 1.5 Configure GitHub secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `IOS_CERT_BASE64`, `IOS_CERT_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- [ ] 1.6 Read `packages/client/src/App.tsx:87-89` and confirm the `DEFAULT_WS_URL` derivation is the only place that assumes a meaningful `window.location`.
- [ ] 1.7 Read `packages/client/src/components/NetworkDiscoverySection.tsx` and confirm the `KnownServerCandidate` shape used by both the server-side scan and the manual-add form.
- [ ] 1.8 `npm test` baseline green; capture in `/tmp/mobile-baseline.log`.

## 2. Workspace package scaffold

- [ ] 2.1 Create `packages/mobile/package.json` with `"private": true`, dependencies on `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/push-notifications`, `@capacitor/preferences`, `@capacitor/browser`, `@capacitor/splash-screen`, plus a chosen zeroconf plugin (start with `capacitor-zeroconf`; spike-test it works).
- [ ] 2.2 Create `packages/mobile/capacitor.config.ts` with `appId: "io.blackbelt.pi-dashboard"`, `appName: "Pi Dashboard"`, `webDir: "www"`, `bundledWebRuntime: false`, `server: { androidScheme: "https" }`. NO `server.url`.
- [ ] 2.3 Create `packages/mobile/.gitignore` for `node_modules/`, `www/`, build artifacts, `android/build/`, `ios/build/`, `android/.gradle/`, etc.
- [ ] 2.4 Add `packages/mobile` to the workspace glob in root `package.json`. Run `npm install` and verify resolution.

## 3. Web sync script

- [ ] 3.1 Create `packages/mobile/scripts/sync-web.sh` that:
  1. Builds `packages/client` (`npm run build -w @blackbelt-technology/pi-dashboard-web`).
  2. Removes `packages/mobile/www/` if present.
  3. Copies `packages/client/dist/` → `packages/mobile/www/`.
  4. Runs `npx cap sync` from `packages/mobile/`.
- [ ] 3.2 Add npm script `mobile:sync` to root `package.json` invoking the script.

## 4. Capacitor detection helper + client integration

- [ ] 4.1 Create `packages/client/src/lib/capacitor-detect.ts` exporting `isCapacitorNative(): boolean` (returns `(globalThis as any).Capacitor?.isNativePlatform?.() === true`). No type imports — runtime check only.
- [ ] 4.2 Unit test in `packages/client/src/lib/__tests__/capacitor-detect.test.ts` covering web (returns false) and stubbed-native (returns true) paths.
- [ ] 4.3 Modify `packages/client/src/App.tsx:87-89`: gate the `DEFAULT_WS_URL` derivation behind `!isCapacitorNative()`. When native, initial `wsUrl` is `null`. The existing `ServerSelector` flow handles the "no server selected" state.
- [ ] 4.4 Verify the existing `ConnectionStatusBanner` does not flash a misleading "disconnected" state on a fresh native install (where the user hasn't picked a server yet). Adjust if needed.
- [ ] 4.5 Manual smoke test: load the client in a desktop browser; confirm zero behavior change.

## 5. Native push registration

- [ ] 5.1 In `packages/client/src/hooks/usePushSubscription.ts` (added by `add-server-push-notifications`), add a branch on `isCapacitorNative()`:
  - Call `PushNotifications.requestPermissions()`.
  - On grant, `PushNotifications.register()`.
  - Listen for `'registration'` event → got FCM/APNs token.
  - POST to `/api/push/register` with `{deviceToken: token, transport: "fcm"}`.
  - Listen for `'pushNotificationReceived'` and `'pushNotificationActionPerformed'`. The latter routes to `payload.url` via `wouter` navigation.
- [ ] 5.2 Tests for the native branch using a stubbed `@capacitor/push-notifications` module.

## 6. Native mDNS

- [ ] 6.1 Spike-test `capacitor-zeroconf` in a tiny throwaway project; confirm it resolves Bonjour `_pi-dashboard._tcp` advertisements emitted by an existing dashboard server.
- [ ] 6.2 Modify `packages/client/src/components/NetworkDiscoverySection.tsx`: when `isCapacitorNative()`, use the zeroconf plugin to perform the scan; map results into the existing `KnownServerCandidate` shape; render via the same UI.
- [ ] 6.3 If `capacitor-zeroconf` is unmaintained or broken, fork into `packages/mobile/plugins/zeroconf-bridge/` (thin wrapper with our own minimal Java/Swift). Spec stays the same; only the implementation source differs.
- [ ] 6.4 Manual test: phone on same Wi-Fi as a dashboard server; open Network Discovery; confirm the server appears within 5 s.

## 7. OS-keychain credential storage

- [ ] 7.1 Create `packages/client/src/lib/secure-store.ts` exporting `get(key)`, `set(key, value)`, `remove(key)`. On native, delegates to `@capacitor/preferences`. On web, falls back to `localStorage`.
- [ ] 7.2 Refactor every `localStorage.setItem("pi-dashboard-token", ...)` / `getItem` call to use `secure-store`. Migration: if `localStorage` has the key but `secure-store` doesn't (post-install), copy across and clear `localStorage` (one-time migration on web; on native, `localStorage` is the WebView's, not user-accessible from Android Settings, so this is fine).
- [ ] 7.3 Tests for both backends.

## 8. Android-specific config

- [ ] 8.1 `cd packages/mobile && npx cap add android`. Commit only the files we own — `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/`, `android/app/build.gradle` if customized.
- [ ] 8.2 Add `android/app/src/main/res/xml/network_security_config.xml` permitting cleartext for RFC1918 + link-local ranges only.
- [ ] 8.3 Reference `network_security_config.xml` from `AndroidManifest.xml` (`android:networkSecurityConfig="@xml/network_security_config"`).
- [ ] 8.4 Place `google-services.json` in `android/app/`. Apply the `com.google.gms.google-services` Gradle plugin.
- [ ] 8.5 Add app icon resources via `npx capacitor-assets generate` (or hand-place into `android/app/src/main/res/mipmap-*/`).
- [ ] 8.6 Verify `applicationId` matches `appId` from capacitor.config.ts.

## 9. iOS-specific config

- [ ] 9.1 `cd packages/mobile && npx cap add ios`. Commit only the files we own.
- [ ] 9.2 Add `Info.plist` ATS exceptions for RFC1918 cleartext (or use `NSAllowsArbitraryLoadsInLocalNetworks` + `NSAllowsLocalNetworking`).
- [ ] 9.3 Place `GoogleService-Info.plist` in `ios/App/App/`.
- [ ] 9.4 Enable Push Notifications capability in the Xcode project. Add `Signing & Capabilities` entry.
- [ ] 9.5 Configure signing identity + provisioning profile to match the App ID created in 1.3.
- [ ] 9.6 Add app icon resources to `ios/App/App/Assets.xcassets/AppIcon.appiconset/`.

## 10. Android build script

- [ ] 10.1 Create `packages/mobile/scripts/build-android.sh`:
  1. Run `mobile:sync`.
  2. `cd android && ./gradlew assembleRelease bundleRelease`.
  3. Sign uses keystore from env (Gradle reads from `~/.gradle/gradle.properties` or env).
  4. Output `android/app/build/outputs/apk/release/app-release.apk` and `app-release.aab`.
- [ ] 10.2 Local test: with a dev keystore, run the script. Verify APK installs on a real device or Android Studio emulator.

## 11. iOS build script

- [ ] 11.1 Create `packages/mobile/scripts/build-ios.sh`:
  1. Run `mobile:sync`.
  2. `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release archive -archivePath build/App.xcarchive`.
  3. `xcodebuild -exportArchive -archivePath build/App.xcarchive -exportPath build/ipa -exportOptionsPlist ios/ExportOptions.plist`.
  4. Output `build/ipa/App.ipa`.
- [ ] 11.2 Create `packages/mobile/ios/ExportOptions.plist` for TestFlight export (`method: app-store`, `signingStyle: manual`).
- [ ] 11.3 Local test on macOS with developer signing identity.

## 12. CI: Android lane

- [ ] 12.1 Add `mobile-android` job to `.github/workflows/publish.yml`:
  - `runs-on: ubuntu-latest`
  - `needs: [prepare, publish]`
  - `strategy.fail-fast: false`
  - Steps: checkout, `setup-java@v4` JDK 17, `setup-android@v3`, decode `ANDROID_KEYSTORE_BASE64` to file, write `gradle.properties` with signing config, run `scripts/build-android.sh`.
  - Upload `app-release.apk` to the GitHub Release via `softprops/action-gh-release@v2`.
  - Upload `app-release.aab` as a workflow artifact.
- [ ] 12.2 Update `packages/shared/src/__tests__/publish-workflow-contract.test.ts` to require the new job's `needs` array contain both `prepare` and `publish` AND `fail-fast: false`. Mirror the electron contract.

## 13. CI: iOS lane

- [ ] 13.1 Add `mobile-ios` job:
  - `runs-on: macos-latest`
  - `needs: [prepare, publish]`
  - `strategy.fail-fast: false`
  - Steps: checkout, install Xcode (typically pre-installed on `macos-latest`), decode signing assets from secrets, install certs into a temporary keychain, run `scripts/build-ios.sh`, run `xcrun altool --upload-app -f build/ipa/App.ipa -u $APPLE_ID -p $APPLE_APP_SPECIFIC_PASSWORD`.
- [ ] 13.2 Document the Apple-side TestFlight propagation delay (typically 5–30 min after upload).

## 14. Documentation

- [ ] 14.1 Create `docs/mobile-builds.md` covering keystore generation/backup, Firebase setup, Apple Developer setup, GitHub secret population, local dev workflow (`mobile:sync` + `cap run android` / `cap run ios`).
- [ ] 14.2 Add "Mobile shell" section to `docs/architecture.md` with a diagram of Capacitor → bundled client → server REST/WS, plus the FCM token registration path.
- [ ] 14.3 Add Key Files entries to `AGENTS.md` for every new file in `packages/mobile/src/` (capacitor.config.ts, sync-web.sh, build-android.sh, build-ios.sh) and the new client files (`capacitor-detect.ts`, `secure-store.ts`).
- [ ] 14.4 Add "Mobile (Android APK / iOS TestFlight)" subsection to `README.md` Installation.

## 15. Verification

- [ ] 15.1 `npm test` green.
- [ ] 15.2 Manual Android: install APK on a phone, open app, see ServerSelector, scan mDNS, find a real dashboard server on LAN, connect, verify chat loads and websocket works.
- [ ] 15.3 Manual Android: enable push in app Settings, run a session that fires `ask_user`, verify push lands.
- [ ] 15.4 Manual Android: kill app, fire push trigger, verify push wakes the device and tapping opens the right session.
- [ ] 15.5 Manual iOS via TestFlight: same flow as 15.2-15.4.
- [ ] 15.6 Manual: cleartext WS to LAN works on Android (`ws://192.168.x.x:8000`).
- [ ] 15.7 Manual: token-paste auth flow on first launch.
- [ ] 15.8 CI: green on a release tag; APK attached to GitHub Release; TestFlight build appears in App Store Connect.
- [ ] 15.9 Run `openspec validate add-capacitor-mobile-shell --strict` and fix any spec/scenario gaps.
