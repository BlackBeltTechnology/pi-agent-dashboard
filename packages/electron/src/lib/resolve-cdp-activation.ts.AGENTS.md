# resolve-cdp-activation.ts — index

Pure `resolveCdpActivation(argv, env): {enabled, port?}`. Parses `--debug-cdp[=<port>]` flag + `PI_DEBUG_CDP` env. CLI flag wins. Default port 9222. Invalid port → falls back to default (still enabled). Never returns address-binding info. See change: ship-browser-skill-and-electron-cdp.
