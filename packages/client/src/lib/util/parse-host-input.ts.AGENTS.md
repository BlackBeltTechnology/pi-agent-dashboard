# parse-host-input.ts — index

Pure parser: user-supplied host string → `{ host, port }`. Exports `parseHostInput(input, defaultPort=8000)`. Accepts full URLs, `host:port`, bracketed IPv6 `[::1]:8000`, bare hostnames; rejects bare multi-colon IPv6 (requires brackets); returns `null` on unparseable input.
