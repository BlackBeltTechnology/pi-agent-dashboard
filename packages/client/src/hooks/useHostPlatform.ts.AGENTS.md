# useHostPlatform.ts — index

One-shot probe of `/api/health` `platform` field. Returns host OS (darwin\|win32\|linux) for Settings → Tools install-hint filtering. `browserPlatformFallback()` reads `navigator.userAgentData.platform` when probe misses. Module-scope cache like `useLaunchSource`. See change: register-bash-and-tool-install-help.

See change: simplify-add-folder-picker — adds `browserIsMacLike()`: BROWSER (not host) Apple keyboard family (`mac|iphone|ipad|ipod` in `userAgentData.platform ?? navigator.platform`; iPadOS reports MacIntel). Drives Command vs Control as add-to-selection modifier in `PathPicker`.
