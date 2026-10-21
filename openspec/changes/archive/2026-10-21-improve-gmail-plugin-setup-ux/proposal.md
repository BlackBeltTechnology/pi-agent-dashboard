## Why

Setting up the Gmail plugin for three real accounts on 2026-10-16/17 (robson@semmi.se, robert.csakany@blackbelt.hu, csakany.robert@gmail.com) needed a long assisted session. The wizard's copy and fields caused each detour:

- **An existing project could not be attached.** Step 1 reads as create-only. The user typed the project's display name `PiDashboard` instead of its ID `pidashboard-510015`. The wizard checks the ID only to decide whether to fill the `gcloud` commands (they silently fell back to `<project-id>`), shows no error, still builds the console links with `?project=PiDashboard`, and keeps the ID only in client state until a JSON is uploaded.
- **The console opened as the wrong Google identity.** The links open as the browser's default Google account. The project belonged to another account, so the console looked as if the project did not exist. The `gcloud` commands had the same problem: the active account `robson@semmi.se` had no credentials.
- **`scope_missing` copy pointed the wrong way.** The message says "tick every permission". For the Workspace account, Google showed the Gmail grant on a second screen ("wants additional access") with no checkbox at all. The earlier attempts stopped after the first screen, which grants only sign-in. For the gmail.com account it was a checkbox, unticked by default. Diagnosing this took a trip through the Workspace Admin console, which was fine (Gmail Unrestricted, third-party apps allowed).
- **Testing mode gives 7-day tokens.** The accounts list flags it (`testing-mode: 7-day tokens`). The wizard says "Publish app" gives longer-lived tokens, but not that unverified restricted-scope apps are capped at 100 users or that existing tokens need a re-auth after publishing.
- **Archiving newsletters could not be made permanent.** The `gmail.modify` scope cannot create filters, so the cleanup was a one-off: about 5,000 conversations, archived with Gmail's web UI because the tool caps at 100 ids per call.

## What Changes

- **Step 1: new or existing project.**
  - An explicit "use existing project" path.
  - The project ID is validated inline. A value that looks like a display name (uppercase, spaces) gets an error that explains name vs ID and links to the console project picker.
  - The typed ID is saved on the server before any JSON upload. After the upload it is cross-checked against the JSON's `project_id`, and a mismatch is shown.
  - Console links and commands are built only from a valid ID.
- **Optional owner account.** An "owner account (email)" field adds `authuser=<email>` to every console link and `--account <email>` to every `gcloud` command. A copyable `gcloud projects list --account <email>` helps find the real ID.
- **`scope_missing` and the waiting hint describe both consent shapes.**
  - Either the Gmail item on Google's second screen ("wants additional access") must be accepted, or the Gmail checkbox must be ticked.
  - The first screen alone only signs in.
  - The account must remove the old partial grant at myaccount.google.com/connections before retrying.
- **Publishing guidance on the audience step.** Publishing removes the 7-day expiry. Unverified apps show a warning and are capped at 100 users. Accounts added during Testing need one re-auth.
- **Filters (optional level).** A filter-management tool, behind an opt-in that requests `gmail.settings.basic`. With it the agent can turn an archive rule into a Gmail filter after confirmation.

Non-goals:
- Running `gcloud` or cloud APIs on the user's behalf. This rule stands.
- Google app verification or a security assessment.
- Bulk operations beyond the tool's 100-id cap. They stay a web-UI or pagination concern.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `gmail-plugin`:
  - Guided OAuth client setup: existing-project path, project-ID validation with name-vs-ID guidance, the ID saved and cross-checked, the owner-account parameter on links and commands, consent copy covering the second-screen and checkbox shapes, and publishing guidance.
  - Gmail setup wizard shows step progress and actionable errors: the mismatched or invalid project ID shown as an actionable error, and both states added to the probe matrix.
  - Settings section is readable and guarded: the project ID and owner-account fields with hints and linked errors; the per-account filters control named after the account.
  - Per-account permission levels: an orthogonal, opt-in filters option (`gmail.settings.basic`) kept across level changes and re-auth.
  - Confirmed writes: filter create/delete are confirmed writes.
  - New requirements "Opt-in Gmail filter management", "Filter permission survives re-authentication and level raises", "Filter operations are gated before confirmation", "Gmail filter tools" and "Filter create requests are allow-listed": `gmail_filters_list`, `gmail_filter_create`, `gmail_filter_delete` (label actions only; forwarding, `TRASH`/`SPAM` and match-all filters refused).

## Impact

- `packages/gmail-plugin/src/client/`:
  - `GmailSettings.tsx`: the step-1 fields, owner account, copy;
  - `wizard.ts`: `consoleLinks` / `gcloudCommands` with `authuser` / `--account`, ID validation, `ERROR_EN` for `scope_missing`.
- `packages/gmail-plugin/src/server/`:
  - `routes.ts`: persist the project ID and owner account; immediate lowering regardless of status;
  - scopes and lease: an optional filter level;
  - bridge tools: the filter tool.
- `packages/gmail-plugin/src/shared/scopes.ts`: optional `gmail.settings.basic`.
- i18n: zh-CN + hu catalog entries for new keys and the rewritten `errScopeMissing` / `consentHint` / `audienceHelp`; English stays the inline `t()` fallback.
- Config: `plugins.gmail` gains `projectId` and `ownerAccount`; accounts gain an optional `filters` flag. All optional, with no migration (design D1, D6).
- `packages/shared/src/route-tiers.ts`: the two new routes (`PUT /setup`, `POST /accounts/:sub/filters`) as `operate`.

## Discipline Skills

- `security-hardening`: a new OAuth scope (`gmail.settings.basic` can create forwarding filters, a known exfiltration vector). Filter writes must go through confirmed writes, and forwarding actions should be refused or separately gated.
