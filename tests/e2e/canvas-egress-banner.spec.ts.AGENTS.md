# canvas-egress-banner.spec.ts — index

L3 F16/F18: auto-opened CDN mockup lists the origin in the egress banner (no dialog), Allow once → pill; Allow for this project → dialog → Access lists it → Revoke. Faux `canvas-html-cdn`. Written, not yet run. See change: improve-canvas-html-and-url-ux.

F3 (fix-csp-report-delivery): faux `canvas-html-egress-report` page fetches `https://example.invalid/x`; banner row source reads `reported by this page` (violation reaches the preview `report-uri` sink, no header rewrite). See change: fix-csp-report-delivery.
