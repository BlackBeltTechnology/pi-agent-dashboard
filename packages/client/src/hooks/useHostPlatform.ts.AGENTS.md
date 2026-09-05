# useHostPlatform.ts — index

One-shot probe of `/api/health` `platform` field. Returns host OS (darwin\|win32\|linux) for Settings → Tools install-hint filtering. `browserPlatformFallback()` reads `navigator.userAgentData.platform` when probe misses. Module-scope cache like `useLaunchSource`. See change: register-bash-and-tool-install-help.
