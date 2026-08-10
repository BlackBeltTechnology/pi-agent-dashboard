# mobile-depth.ts — index

Computes `MobileShell` nav depth from route-match flags. Exports `MobileDepthInput`, `getMobileDepth(input)` — depth 2 for overlay/pi-resource routes, 1 for session/folder/settings/folder-settings/tunnel, 0 otherwise. URL-driven after overlay-url-routing; plugin overlays excluded. See change: overlay-url-routing.
