# preview-egress.ts — index

Pure, browser-safe origin helpers. `canonicalHttpsOrigin`, `isUngrantableEgressOrigin(origin, own)`, `isPrivateIpv4/6` (exported), `isPublicUnicastAddress(ip)` (fail-closed: private + 192.88.99/24, 198.18/15, TEST-NETs, `100::/64`, Teredo, ORCHID, doc, 6to4, NAT64, mapped/SIIT/compat, site-local, multicast; zone-ID stripped; unparseable → false). See change: improve-canvas-html-and-url-ux (D7), rich-chat-links (D12 — frame-policy probe vetting).
