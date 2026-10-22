# DOX — openspec/changes/group-servers-by-identity/mockups/server-identity-pairing

Explore-mode board adopted into this change. Covers both `group-servers-by-identity` (S0–S6) and `device-key-mutual-check` (S7–S10). Open `index.html`. No app code touched.

| File | Purpose |
|---|---|
| `AGENTS.md` | Per-file record for this dir. See change: group-servers-by-identity. |
| `icons.js` | `ICON` map from `@mdi/js`, copied from add-access-provisioning + appended glyphs. See change: group-servers-by-identity. |
| `index.html` | Explore-mode board: server list keyed by identity fingerprint, addresses as routes (loopback/LAN/mDNS/zrok/public) proven via `POST /api/pair/challenge`, pair action on unpaired rows. `index.html` S0 model, S1 header selector as-built vs proposed, S2 Settings ▸ Servers merged cards + route table, S3 LAN knock flow (confirm/waiting/approved/refusals/TOFU), S4 tunnel-only pair-with-code, S5 client matrix, S6 decisions D1 route delegation / D2 paired-state via device key / D3 browser knock target. Device-key explore: S7 mutual check (`POST /api/pair/challenge` optional `device:{pub,ts,sig}` → `device.status` paired/unknown/revoked + decision table), S8 approval dialog + Device key row + status-only companion key callout, S9 device row states + bearer→key migration, S10 server Paired devices with key/companion, revoke toast + Undo, Revoked devices list (90-day hold, Undo revoke / Delete now). Decided: revoke undoable 90 days, companion opt-in (unticked), plain-http status relay accepted, split into two changes. Toolbar theme/frame/client (electron/browser/mobile); query `theme`,`width`,`client`. `srv.css` recipes tokens only; `tokens.css`/`mockup.css`/`probe.js` copied from add-access-provisioning; `icons.js` + appended MDI glyphs. See change: group-servers-by-identity. |
| `mockup.css` | Base reset, `.pill`, `.seg`, `.p-*` recipes. Copied unchanged from add-access-provisioning. See change: group-servers-by-identity. |
| `probe.js` | Contrast + size probe (`window.__probeRoot`). Copied unchanged. See change: group-servers-by-identity. |
| `srv.css` | Board recipes: route chips `.rc`, server card `.srv`, route table `.rt`, dialog `.dlg`, matrix `.mx`, decision `.opt`. Tokens only, container queries. See change: group-servers-by-identity. |
| `tokens.css` | Theme tokens (base dark/light, nord dark). Copied unchanged. See change: group-servers-by-identity. |
