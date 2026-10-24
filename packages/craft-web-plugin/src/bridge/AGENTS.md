# DOX — packages/craft-web-plugin/src/bridge

Pi-extension entry of the plugin: the live-control agent tool. See change: add-craft-live-control.

| File | Purpose |
|------|---------|
| `index.ts` | `activate(ctx)` registers `craft_control({path?, method, params?, instance?})` via `pi.registerTool`. Calls `requestPluginServer("craft-web", "craft-web/control", …)`; only the four known fields travel (session id comes from the lane). Success: text `App output (untrusted…)` + envelope `{ok, source:"craft-app", app, untrusted:true, instance, saveRequested?, saveSeq?, result}`; a `jpegBase64` result becomes an `image` part. Errors `error: <code>: <message>`: not-open, not-visible, not-ready, ambiguous, unsupported, busy, timeout (outcome unknown), denied, reply_too_large, request_too_large, rate_limited, app_error, disabled, unavailable, no_handler. Exports `craftControl`, `createCraftControlTool`. See change: add-craft-live-control. |
| `__tests__/bridge.test.ts` | Registration, lane arguments (spoofed `sessionId` dropped), envelope, image part, router errors, lane errors (#X15) incl. `timeout` wording. |
