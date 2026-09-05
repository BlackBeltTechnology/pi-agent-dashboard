# useAuthStatus.ts — index

Fetches `GET /auth/status` into `authStatus: AuthStatus | null` (`authenticated`, `authEnabled`, `user`) with `loading`. Falls back to `{ authenticated: true, authEnabled: false }` on 404. Exports `redirectToLogin()` — redirects to `/auth/login?return=`.
