# DOX — packages/team-app/src/shell

One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `Gate.tsx` | Sign-in / redirecting / unavailable / not-admitted views; `Gate` blocks children until identity is authenticated (so no team data before sign-in). See change: add-team-plugin. |
| `TargetSelector.tsx` | `HeaderContext`: APG menu button over own workspace + projects (unavailable disabled with reason), plain label with no projects, locked chip in a folder view. See change: add-team-plugin. |
| `nav.ts` | `withProject`, `agentPath`, `useNav` (`toSkills`, `toSkill` added) — router-base-relative navigation. See change: add-team-plugin. See change: add-team-skill-access. |
| `seam-identity.tsx` | Dashboard login-seam sign-in: `bootSeam` (login-config → none / unavailable / handoff / silent / signedOut), `SeamIdentityProvider` exposing app-kit `Identity`. In-memory bearer via app-kit. See change: add-team-plugin. |
