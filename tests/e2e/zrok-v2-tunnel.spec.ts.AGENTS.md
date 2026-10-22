# zrok-v2-tunnel.spec.ts — index

L3 (change: support-zrok-v2, F1/F2/F3). Stubs `/api/tunnel-status` (+`/api/tunnel-disconnect`) via `page.route`: F1 `/tunnel-setup` linux guide (Install/Enroll/Verify + docs.zrok.io + openziti cmd); F2 active `*.shares.zrok.io` → `tunnel-btn` green + v2 URL in title; F3 `gateway-forget-reserved` fires `POST /api/tunnel-disconnect {forget:true}`.

Toolbar `data-tone="internet"` + title; Forget reserved URL via the wizard Public address step. See change: add-remote-access-wizard.

declutter-sidebar-header: F2 now asserts the connection chip's `aria-label` (`remote access internet on`) then opens the connection menu and checks the `tunnel-btn` menuitem (`data-tone=internet`, text `internet on`); new F11: menu → Remote access opens `remote-access-landing` and closes the menu.
