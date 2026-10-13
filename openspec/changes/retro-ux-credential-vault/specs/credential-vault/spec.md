## ADDED Requirements

### Requirement: Vault page is organised by variable
The Settings vault page SHALL offer three tabs: Variables, Accounts and Import. The Variables tab SHALL show one card per env binding containing:
- its default account, editable;
- every project granted that binding, each with its subject (repository key, or folder and device, or the subject text for another subject kind), the account it uses, and a status shown as text with an icon, never by colour alone;
- for a repository grant, the confirmed checkouts it unlocks, each with a revoke action;
- an action to grant the binding to another project;
- the plugin declarations of that binding name, each with an approval switch.

A grant whose account is missing SHALL show "No account: delivers nothing" with an action to choose an account. A binding with no default SHALL be marked as needing an account. A plugin declaration naming a binding that does not exist SHALL be shown with an action to create that binding. Confirmed checkouts that match no grant SHALL still be listed with a revoke action. The Accounts tab SHALL show, for each account, what uses it (bindings it is the default of, and the number of projects that chose it).

#### Scenario: One card answers who gets a key
- **WHEN** `GEMINI_API_KEY` is granted to repository `github.com/acme/app` (one confirmed checkout) and to folder `/work/scratch` on the hub with account "work"
- **THEN** the `GEMINI_API_KEY` card lists both projects with their subject kind and the account each uses
- **AND** the repository row lists its confirmed checkout with a revoke action

#### Scenario: Status is not carried by colour alone
- **WHEN** a grant's override account was revoked
- **THEN** its row shows the text "No account: delivers nothing" with an icon
- **AND** it offers an action to choose an account

#### Scenario: Unconfirmed repository grant is visible
- **WHEN** a repository grant has no confirmed checkout
- **THEN** its row shows that it is waiting for a checkout confirmation and says the confirmation is made from a session's Vault chip

#### Scenario: Plugin asks for a missing variable
- **WHEN** an installed plugin declares `POLY_PIZZA_KEY` and no such binding exists
- **THEN** the Variables tab shows the plugin's request with an action that creates the binding

### Requirement: Project picker offers open and remembered projects
Granting a binding to a project SHALL offer a choice of projects instead of requiring typed identifiers. The choice SHALL list:
- the projects of sessions currently connected to the dashboard, with their session count;
- projects the hub has resolved for a session before ("remembered").

Already-granted projects, and sessions of untrusted or refused devices (for example a remote device refused as `transport-insecure`), SHALL be listed as unavailable with the reason. A session the hub does not trust SHALL never yield a grantable entry, and no repository key reported by such a session SHALL be shown. A repository key resolved for a trusted session SHALL be offered; delivery to it still waits for checkout confirmation. A manually entered repository SHALL be normalised like a session's origin before it is compared or granted, and a project that already has a grant for the binding SHALL NOT be granted again from the picker. Manual entry of a repository key or of a device and folder SHALL remain available. Choosing a repository SHALL state that each checkout still needs confirmation. When the server cannot list projects (an older server), the picker SHALL say so and open manual entry.

The hub SHALL remember a project when it resolves a project key for a trusted session. A remembered entry SHALL hold only the device id, the directory, the repository key if any, and the time it was last recorded (at most one hour behind the latest session). It SHALL hold no value and no binding name. Remembered projects SHALL be stored outside the vault file, so the vault file is still not created before the first account. The store SHALL keep at most 200 entries; entries not seen for 90 days SHALL be dropped and SHALL NOT be listed. The list SHALL be served only to callers that may manage the vault. A failure to remember a project SHALL NOT affect delivery.

#### Scenario: Open session project is offered
- **WHEN** a session runs in a checkout of `github.com/robson/deck3d` on the hub and the user grants `SONIOX_API_KEY`
- **THEN** the picker lists `deck3d` with that repository key and its session count
- **AND** granting it creates a grant for `repo:github.com/robson/deck3d`

#### Scenario: Project from an earlier session is remembered
- **WHEN** a session resolved project (hub, `/Users/robson/scratch`) and has since ended
- **THEN** the picker lists that folder under remembered projects with when it was last recorded

#### Scenario: Remembering does not create the vault file
- **WHEN** the dashboard has no vault accounts and a session resolves a project
- **THEN** the project is remembered
- **AND** no vault file exists

#### Scenario: Remembered list is bounded
- **WHEN** the store holds 200 entries and a new project is resolved
- **THEN** the least recently seen entry is dropped
- **AND** an entry not seen for 90 days is not listed, even before the next write

#### Scenario: Older server cannot list projects
- **WHEN** the project list request is answered with HTML or 404
- **THEN** the picker says the server can't list projects yet and shows manual entry

#### Scenario: Refused session is shown, not offered
- **WHEN** a session on a paired remote device is refused as `transport-insecure`
- **THEN** its directory is listed as unavailable with that reason and cannot be chosen
- **AND** no repository key is shown for it

#### Scenario: Existing grant is not overwritten
- **WHEN** `github.com/acme/app` already has a grant of `GEMINI_API_KEY` with account "work", and the user enters `git@github.com:acme/app.git` manually
- **THEN** the picker says the project already has this variable and sends no grant
- **AND** the grant keeps account "work"

#### Scenario: Caller without vault authority gets no project list
- **WHEN** an observe-tier caller requests the project list
- **THEN** the request is refused and no path is returned

### Requirement: Keys and variables can be created together
When the user adds a key, the page SHALL offer the variable named `<PROVIDER>_API_KEY` (provider upper-cased, characters other than letters and digits replaced by `_`); when that name is not a valid, deliverable variable name, the option SHALL NOT be shown. If no binding of that name exists, it SHALL offer to create it with the new account as default, selected by default. If the binding exists and its current default is missing or of the same provider, it SHALL offer to make the new account its default, not selected by default; otherwise it SHALL offer nothing. When the user imports keys, the page SHALL offer to create a binding with the same name for each imported key that has no binding and whose name is a valid, deliverable variable name, using the imported account as default, and SHALL show which names get no variable and why. If the account is created and the binding step fails, the page SHALL say the key was saved and the variable was not, and offer a retry. It SHALL NOT remove the account. A retry that finds the binding already present with that account as default SHALL count as success.

#### Scenario: New provider creates its variable
- **WHEN** the user adds a key with provider `assemblyai` and keeps the offered option
- **THEN** an account is created and a binding `ASSEMBLYAI_API_KEY` is created with it as default

#### Scenario: Existing variable keeps its default unless asked
- **WHEN** `GEMINI_API_KEY` has default "gemini / personal" and the user adds a `gemini` key without ticking the offered option
- **THEN** the new account is created and `GEMINI_API_KEY` keeps "gemini / personal" as default

#### Scenario: Import creates same-name variables
- **WHEN** the user imports `GEMINI_API_KEY` and `SONIOX_API_KEY` with the variable option ticked, and only `SONIOX_API_KEY` already has a binding
- **THEN** a binding `GEMINI_API_KEY` is created with the imported account as default
- **AND** the existing `SONIOX_API_KEY` binding is unchanged

#### Scenario: Invalid derived name is not offered
- **WHEN** the user adds a key with a provider whose derived name is reserved or invalid (for example `node`, giving `NODE_API_KEY`, which the reserved prefix `NODE_` blocks)
- **THEN** no variable option is shown and only the account is created

#### Scenario: Partial failure is reported
- **WHEN** the account is created but creating the binding fails
- **THEN** the page says the key was saved and the variable was not, and offers a retry
- **AND** the account remains

### Requirement: Destructive vault actions show their impact first
Deleting a binding and revoking an account SHALL each take two steps. Before the second step the page SHALL list the impact, computed from the vault state re-read when the first step is taken:
- for a binding: the projects whose grants are removed, the plugin approvals that are removed, and that connected sessions lose the variable within seconds while running processes keep the old value;
- for an account: the bindings that lose their default, the grants that become `no-account`, that those grants do not fall back to the binding default, the plugin approvals that then read nothing, and that running processes keep the old value.

If the vault state cannot be re-read, the page SHALL say so and SHALL NOT allow the second step. Cancelling SHALL change nothing. Rotating an account SHALL state that running processes keep the old value until restarted.

#### Scenario: Deleting a binding lists what it removes
- **WHEN** the user deletes `GEMINI_API_KEY`, which is granted to 3 projects, and confirms
- **THEN** before confirming, the page names those 3 projects and the plugin approvals that will be removed
- **AND** only after confirming is the binding deleted

#### Scenario: Revoking an override account names the projects
- **WHEN** account "gemini / work" is the override of 2 project grants and the user starts revoking it
- **THEN** the page names both projects and says they will deliver nothing rather than the default
- **AND** cancelling leaves the account and both grants unchanged

### Requirement: Vault page explains load failures and empty, loading and invalid states
The vault page SHALL show a loading placeholder while its first load runs. When the vault has no accounts and no bindings, it SHALL show a three-step guide (add or import a key, expose it as a variable, grant it to a project). Import SHALL be the primary action when import candidates exist. When a load answer is successful but not JSON, the page SHALL say the server does not provide the vault yet and offer to restart the server and to retry. It SHALL NOT report the HTTP status alone. A refused restart SHALL be reported in place. When the server cannot be reached, the page SHALL say so. When the vault file is corrupt, every write control SHALL be disabled. A reserved or invalid variable name, and a key shorter than 8 characters, SHALL be reported at the field before any request is sent. All inputs SHALL have visible labels.

#### Scenario: Server older than the page
- **WHEN** `GET /api/vault` answers 200 with an HTML body
- **THEN** the page says the server does not provide the vault yet and offers Restart server and Try again
- **AND** it does not show "HTTP 200" as the error

#### Scenario: First run guides the user
- **WHEN** the vault has no accounts and no bindings, and two key files are found
- **THEN** the page shows the three-step guide with Import keys as the primary action

#### Scenario: Corrupt vault disables writes
- **WHEN** the vault file is corrupt
- **THEN** the page names the backup path and every add, rotate, revoke, grant and delete control is disabled

#### Scenario: Reserved name caught at the field
- **WHEN** the user enters `PATH` as a new variable name
- **THEN** the field is marked invalid with a message that the name is reserved
- **AND** no request is sent

## MODIFIED Requirements

### Requirement: Values never leave the hub through management surfaces
No stored value SHALL appear in management API responses, the Settings UI, CLI output, logs or error messages. Listings SHALL expose only:
- id, provider, kind, label and namespace;
- binding and grant membership;
- non-secret status;
- projects for the grant picker: device id, directory, repository key, session count or the time last recorded, and availability with its reason.

Every vault management route SHALL accept only a caller with `operate` authority, or a locally trusted caller honouring strict local-proof mode. This covers reads and writes of accounts, bindings, grants, confirmations, plugin approvals, remembered projects and the import. A session's own binding names and states are part of that session's status, and follow session-read authority.

#### Scenario: Listing redacts values
- **WHEN** a client requests the account list
- **THEN** the response contains no stored value

#### Scenario: Observe-tier caller cannot use the vault
- **WHEN** a caller with only `observe` authority lists accounts or adds an account
- **THEN** the request is refused and the vault is unchanged

#### Scenario: Observe-tier login session on a trusted network cannot use the vault
- **WHEN** a dashboard login session whose tier is `observe` calls a vault management route from a trusted network
- **THEN** the request is refused and the vault is unchanged

#### Scenario: Identity principal without vault authority cannot use the vault
- **WHEN** an identity principal that the host policy does not authorise to manage the vault lists accounts or projects
- **THEN** the request is refused and no account, path or binding name is returned

#### Scenario: Remembered project listing carries no value
- **WHEN** a caller that may manage the vault lists projects for the picker
- **THEN** each entry carries only its device id, directory, repository key, session count or last-recorded time, and availability with its reason
- **AND** no stored value or binding name appears in the response
