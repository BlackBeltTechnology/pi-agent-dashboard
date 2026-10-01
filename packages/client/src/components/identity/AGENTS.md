# DOX — packages/client/src/components/identity

Files in this directory. One row per source file. See change: add-multi-user-identity-plane (mockup: `openspec/changes/add-multi-user-identity-plane/mockups/login-logout.html`).

| File | Purpose |
|------|---------|
| `LoginPage.tsx` | Core full-page login at `/login` (mockup v3): fading dot-grid, π tile, one button per provider (D25) → provider `loginUrl?returnTo&challenge`; variants signin / expired / signed-out / error (+ D23 hint). Silent no-click sign-in via `silentProviderFor` (never after sign-out / error / `login_required`). Also `SigningInPage`. Routed by `main.tsx` `AfterBoot`. |
| `LoginGate.tsx` | Optional D16 component-provider gate (`/callback`, `/logout`, start phase). |
| `UserBar.tsx` | D22 user line pinned to the bottom of the session list: avatar initials, name, email · provider, Sign out. `SignedInUserBar` self-loads, uses the provider this page signed in with (`login-session` `providerId`, D25) for label + `signOutTarget`; renders nothing unless identity is enforced. |
