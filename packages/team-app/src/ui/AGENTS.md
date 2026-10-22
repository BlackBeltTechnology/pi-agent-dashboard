# DOX — packages/team-app/src/ui

One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `dialogs.tsx` | Native `<dialog>` `ConfirmDialog` and `TextDialog`; ConfirmDialog focuses Cancel on open (opener captured pre-focus), focus returns to the opener on close. See change: add-team-plugin. See change: add-team-skill-access. |
| `icons.tsx` | `Icon` (authored stroke paths), `Avatar` (gallery / initials). See change: add-team-plugin. `Icon` / `Avatar` markup via `trustedStaticSvg(map, key)` (pi-static-svg; key lookup only, own-property check — unknown / prototype keys → empty). See change: harden-client-sinks. |
| `menu.tsx` | APG `MenuButton` (menu / menuitem / menuitemradio, Arrow/Home/End/Escape). See change: add-team-plugin. |
| `toast.tsx` | `ToastProvider` + `useToast` (toast + polite live region). See change: add-team-plugin. |
| `trusted-static-svg.ts` | `pi-static-svg` Trusted Types policy: input is a KEY looked up in the constant `ICON` / `GALLERY` maps; unknown key → empty markup. Exports `trustedStaticSvg(map, key)`, `StaticSvgMap`. Import allowlisted to `ui/icons.tsx`. See change: harden-client-sinks. |
