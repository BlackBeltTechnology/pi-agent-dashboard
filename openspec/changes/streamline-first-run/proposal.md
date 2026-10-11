## Why

A first-time user has to clear three gates before the first agent reply, and two of them are chores the system could handle.

**The Claude peer is a manual detour.** Signing in with an Anthropic subscription also needs `@blackbelt-technology/pi-anthropic-messages`, the only `status: "required"` entry in `RECOMMENDED_EXTENSIONS` (`packages/shared/src/recommended-extensions.ts:142-155`). Two existing prompts can mention it, but neither fits the moment the user signs in:

- `MissingRequiredBanner` (`packages/client/src/components/session/MissingRequiredBanner.tsx`) offers Install for any required extension that is not active (`activeInPi`). It is mounted **only in the mobile shell** (`packages/client/src/App.tsx:3057`), so desktop and Electron users never see it. It is also generic, unrelated to the sign-in, and dismissible.
- The `anthropic-peer-hint` warning on the provider row is driven by the bridge probe, which is emitted on pi `session_start`. On a first run no session exists yet, so the hint never renders.

**"Add folder" assumes the user already has a project.** Step ② opens the multi-select folder browser (`AddFoldersDialog`, `App.tsx:2733-2747`). A newcomer usually has no folder in mind, and a filesystem browser is a heavy first interaction.

The two planned onboarding changes, `add-persistent-onboarding-card` and `add-welcome-tutorial`, would both build on this three-gate flow. Shrinking the flow first reduces what they have to carry.

## What Changes

**Auto-install the Claude peer on Anthropic sign-in.**
- When the `anthropic` subscription OAuth flow completes in Provider Authentication, the client installs `npm:@blackbelt-technology/pi-anthropic-messages` without an extra click, provided the server reports the peer as not active (`activeInPi`, from `/api/packages/recommended`).
- The install is always global, the same constant source and scope as the existing hint's Install. A probe that reports the peer resolving, or an *import* failure, vetoes it.
- Progress and outcome render on the Anthropic row and on the Landing Step ① done row:
  - deciding or running: an in-progress status;
  - installed: an informational message;
  - failed: a plain-language warning with **Retry install**, and the raw installer output in a collapsed `LogBlock`.
- On the row, this surface takes precedence over the existing missing-peer hint.
- **Fallback when no automatic decision ran** (for example, settings closed before the OAuth finished): the Landing Step ① done row shows a manual **Install** when the Claude subscription is connected and the peer is not active. This works on every platform, unlike the mobile-only banner.

**Step ② becomes "Create your first project".**
- Landing Step ② shows an inline project-name field (default `my-first-project`) and a **Create project** button.
- Create makes `<home>/Projects/<name>` on the server (creating `Projects` if needed) and pins it.
- An existing directory with that name is reused and pinned, and the Step ② done row notes the reuse.
- A secondary **Use an existing folder…** action opens the existing `AddFoldersDialog`, unchanged. It keeps the `onboarding-step-2-cta` test id that the E2E helper (`tests/e2e/helpers/index.ts:18`) and every spec using it rely on.

**Landing becomes a vertical stepper.**
- One ordered list replaces the three-card row, with a "n of 3 done" progress line.
- The active step is expanded and carries the single primary action. Done and locked steps collapse to one line.
- Approved mockup: `mockups/index.html`.

**New server endpoint** `POST /api/browse/create-project { name }` returns `{ path, existed }`.
- It sits behind the network guard and at the `control` route tier, the same as `/api/browse/mkdir`. It is denylisted from the MCP tool manifest as a UI-only convenience; agents keep `file_mkdir`.
- Names must be a single portable segment.
- The resolved target must stay inside the real path of `<home>/Projects`, and the returned path is the real path.
- `/api/browse/mkdir` semantics are unchanged.

**Spec drift fix.** `landing-page-onboarding` and `pinned-directories-ui` still name `PinDirectoryDialog` as the Landing Step ② target. The modified requirements name `AddFoldersDialog`, which the code has used since `redesign-folder-workspace-add-flow`.
- The re-stated Landing scenarios read credentials through `useProvidersReady()`, which the unmodified "Providers-ready detection" requirement already defines (API key or OAuth). This aligns their wording with shipped behaviour; it is not a new done-condition.
- Known drift deliberately left alone:
  - the Step ① CTA route (`/settings/providers` in code vs `/settings?tab=providers` in the spec);
  - the `pinned-directories-ui` "Pin directory dialog uses PathPicker" and "Manual pin dialog" requirements, which still describe `PinDirectoryDialog`. That component still exists for the Packages move-to-local picker.

**Mockups:**
- Mockup: mockups/index.html (in this change).
- Mockup: mockups/extensions-hub (in this change). Adopted from the explore backlog ("unify packages and plugins into one add-ons hub"). It is reference only for this change; no task implements it.

**Not in scope:**
- Inline provider tiles on Landing (Step ① still opens settings).
- Making the tutorial readable before login (owned by `add-welcome-tutorial`).
- Auto-install on other Claude paths (`anthropic-api` keys, 9Router `cc/*`, model-proxy endpoints, `pi /login` outside the dashboard).
- A configurable projects root.
- Changes to the Step ① and Step ③ done-conditions as shipped. The spec text is corrected to `useProvidersReady`; see the drift fix.

## Capabilities

### New Capabilities
- `project-quick-create`: a server endpoint that creates (or reuses) a named project directory under the user's default projects root and returns its absolute path.

### Modified Capabilities
- `landing-page-onboarding`:
  - stepper presentation and progress line;
  - Step ② inline create with a secondary existing-folder action and the CTA target corrected to `AddFoldersDialog`;
  - the Step ① done row reports an automatic peer install;
  - scenario wording aligned with `useProvidersReady`.
- `anthropic-peer-hint`:
  - new requirements: automatic install on Anthropic sign-in (`activeInPi` decision, probe import-failure veto) and visible outcome on the row;
  - modified: the missing-peer hint yields to the auto-install surface while one is in progress or failed.
- `pinned-directories-ui`: the dialog ownership requirement names `AddFoldersDialog` and the Landing "Use an existing folder…" entry point.

## Impact

**Client**
- `packages/client/src/components/shell/LandingPage.tsx`: stepper, Step ② form, Step ① install status, new `onCreateProject` prop.
- `packages/client/src/App.tsx`: wires `onCreateProject` (endpoint call, then the existing `pin_directory` send).
- `packages/client/src/components/settings/ProviderAuthSection.tsx`:
  - one-line fire-and-forget trigger inside `finishFlow` for `id === "anthropic"`;
  - store reset on `anthropic` sign-out;
  - auto-install surface;
  - `AnthropicPeerHint` suppression rule.
- `packages/client/src/hooks/useProvidersReady.ts`: an additive `anthropicAuthenticated` field from the status it already fetches. App passes it to `LandingPage` and resets the store when it turns false.
- `packages/client/src/hooks/useAnthropicPeerProbe.ts`: `derive` is extracted as a shared `derivePeerState` that checks the scoped and legacy keys.
- `packages/client/src/lib/package/package-queue.ts`: a public read-only `isSourcePending(source)`.
- `LandingPage` reads `useRecommendedExtensions` for the Step ① manual-install fallback.
- New `packages/client/src/lib/package/peer-auto-install-store.ts`.
- New i18n keys.

**Server**
- `packages/server/src/browse.ts`: new `createProjectDirectory`.
- `packages/server/src/routes/file-routes.ts`: the new route.

**Shared**
- `packages/shared/src/route-tiers.ts`: the new route at tier `control`.
- `packages/shared/src/rest-api.ts`: `CreateProjectRequest` / `CreateProjectResult`.

**MCP**
- `packages/mcp-server-plugin/src/server/tools.denylist.ts`: an entry for the new route (UI-only).

**Follow-ups after merge (not edited from this change):**
- Re-plan `add-persistent-onboarding-card` so its card renders the stepper and Step ② form.
- Update the `add-welcome-tutorial` "Start your first project" chapter.

**Compatibility:** additive.
- Fully configured users see a compact stepper of done rows instead of three done rows. The step order and done-conditions do not change.
- When no auto-install was attempted, the existing hint behaves exactly as before.

**Rollback:** revert the change. Created directories stay on disk and stay pinned, and an auto-installed peer stays installed (it is `required`). There is no migration and no persisted state.

## Discipline Skills

- `security-hardening`: the new endpoint creates directories from a user-supplied name (traversal, symlink escape, Windows-reserved names, route tier). The auto-install runs a package install without a click, so the source must be a hard-coded first-party constant.
- `doubt-driven-review`: the auto-install decision (`activeInPi` with the probe veto) and the hint-suppression precedence change the shape of a shipped contract.
- `scenario-design`:
  - the decision matrix (probe import-failure / resolving × `activeInPi` × fetch failure × already pending), across the three entry points: sign-in, Landing Install and Retry;
  - completion vs settings unmount;
  - sign-out reset;
  - name, symlink and root-file cases;
  - offline install.
- `review-code`: client, server, shared and MCP change before commit.
- `observability-instrumentation`: server-side log of each create-project outcome; the auto-install decision is observable through the store state, with no new client logging pattern.
