# DOX — packages/gmail-plugin/src

Files in this directory. One row per source file. See change: add-gmail-plugin.

| File | Purpose |
|------|---------|
| `__tests__/fake-browser-service.ts` | Fake `browser.dedicated`: records `connect/open/focus/disconnect`, `busyHolder` (+ secret holder instance id), `refuse` reason, scripted `tabOrigin`. See change: add-gmail-auto-setup. |
| `__tests__/fake-console.ts` | `FakeConsole`: Cloud console page model behind a fake CDP socket (`wsFactory`). Role+name AX nodes, scripted transitions, creation dialog with `GOCSPX-` secret, faults (`override`, `denyNavigation`, `hang`, `beforeNavigate`, `dialogReadThrows`, `downloadWorks/Json`), records log/clicks/fills/navigations/keep-alives. See change: add-gmail-auto-setup. |
| `__tests__/fakes.ts` | Test fakes. `memoryCredentials` (in-memory `PluginCredentials`, `update` atomic), `fakeGoogleFetch` (token + revoke endpoints; records `calls`/`revokes`), `idToken`/`validClaims` (unsigned JWT, claims only), `capturingLogger` (`lines` all, `warns` warn-only), `TEST_ENDPOINTS` (loopback, `overridden:true`), `CLIENT`. |
| `__tests__/setup-harness.ts` | `makeHarness` (routes + FakeConsole + fake service, `FAST` timing), `autopilot` (plays the human), `preset`, `startExisting`, `until`, `advanceUntil` (fake timers). See change: add-gmail-auto-setup. |
| `configSchema.json` | Optional string `projectId` + `ownerAccount` (setup wizard); tokens live in the credential store. See change: improve-gmail-plugin-setup-ux. |
| `i18n.ts` | `catalog` — zh-CN + hu leaf keys (parity enforced); English at call sites. |
