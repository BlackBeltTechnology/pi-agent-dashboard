## Purpose

Lets the operator get remote access set up by intent — share over the internet, let a device in, open to the LAN, or connect to another machine — through one dialog that shows who can reach this machine and walks only the steps that are still missing.

## ADDED Requirements

### Requirement: Remote access dialog opens on a status landing
The Remote access dialog SHALL open on a status landing that shows, before any task:
1. one row per road — **This computer** (always on), **Devices on my network**, **Internet** — each with a state word and, when on, the address it serves;
2. the number of paired devices with a link to manage them;
3. when one or more devices are waiting for approval, a callout naming the count with a Review action;
4. when any network other than loopback is admitted without authentication, a warning stating how many such networks there are, with a link to the Security settings;
5. four task entries: **Share over the internet**, **Let a phone or laptop in**, **Allow devices on my network**, **Connect to another machine**;
6. a link to the full network settings.

The road states SHALL be:
- **Devices on my network** — On when the running server's bind host is not loopback-only AND `pairing.acceptLanRequests` is true; "Listening, but requests are off" when only the first holds; "Restart pending" when a non-loopback bind is saved but not live; Off otherwise. When listening, the row SHALL show the bind host (for example "all networks (0.0.0.0)").
- **Internet** — On when at least one tunnel provider is connected by this server, showing its address; for a private-mesh provider (tailscale, zerotier) the row SHALL say the address is reachable only from that private network. Off otherwise.

Each task entry SHALL show a hint derived from that task's own step plan: the number of outstanding steps, or "Ready" when none remain. State SHALL be conveyed in text, never by colour alone. The landing SHALL re-read its sources when the operator returns to it from a task.

#### Scenario: Fresh install landing
- **GIVEN** the server binds loopback only, no tunnel provider is configured and no device is paired
- **WHEN** the operator opens the Remote access dialog
- **THEN** the landing SHALL show This computer On, Devices on my network Off, Internet Off
- **AND** SHALL show 0 paired devices
- **AND** SHALL list the four task entries

#### Scenario: Internet share up
- **GIVEN** zrok is the primary provider, connected and serving `https://robson-home.shares.zrok.io`, and no network bypasses authentication
- **WHEN** the landing renders
- **THEN** the Internet row SHALL read On and show `https://robson-home.shares.zrok.io`
- **AND** the Share over the internet entry SHALL show "Ready"

#### Scenario: Listening but requests off
- **GIVEN** the server binds `0.0.0.0` and `pairing.acceptLanRequests` is false
- **WHEN** the landing renders
- **THEN** the Devices on my network row SHALL read "Listening, but requests are off"

#### Scenario: Devices waiting
- **GIVEN** one pairing request is pending
- **WHEN** the landing renders
- **THEN** a callout SHALL state that 1 device is waiting to connect
- **AND** its Review action SHALL raise the approval dialog for that request

### Requirement: No unloaded value is rendered as fact
Every road row, task hint and step state SHALL render a loading indication until the state it depends on has been read. A default value (for example a switch's "Off") SHALL NOT be displayed while its source is still loading, and a read failure SHALL be shown as unknown with a retry, not as Off.

#### Scenario: LAN requests still loading
- **GIVEN** the configuration read has not yet returned
- **WHEN** the dialog renders
- **THEN** the Devices on my network row SHALL show a loading indication
- **AND** SHALL NOT show On or Off

#### Scenario: Read failure
- **GIVEN** the configuration read fails
- **WHEN** the dialog renders
- **THEN** the affected rows SHALL read "unknown" with a retry action

### Requirement: Refused changes leave state untouched
A step action that writes configuration, restarts the server, connects or disconnects a tunnel, or adds a known server SHALL, when the server refuses it as unauthenticated or under-privileged, state that this browser is not allowed to make the change, keep the step current, and change no other state.

#### Scenario: Low-tier device opens the dialog
- **GIVEN** the dialog is open in a browser whose credential is below the tier required to change configuration
- **WHEN** the user activates Listen on network
- **THEN** the step SHALL state that this browser is not allowed to make the change
- **AND** the server SHALL NOT restart

### Requirement: Tasks are ordered step lists with state-derived satisfaction
Each task SHALL be an ordered list of steps. Every step SHALL have a satisfaction check evaluated against current server state:

| Step | Satisfied when |
|---|---|
| Choose provider | a tunnel provider is configured |
| Install | the primary provider's readiness is not `not-installed` |
| Enable | the primary provider's readiness is neither `not-installed` nor `not-set` |
| Public address | a zrok reserved name is configured and the live share is not degraded (serving a name other than the configured one), or `tunnel.zrok.persistent` is false (the operator chose a temporary address) |
| Go online | the primary provider is connected by this server |
| Listen on network | the bind host the running server resolved is not loopback-only |
| Let devices ask | `pairing.acceptLanRequests` is true |
| Who may enter | every network admitted without authentication is loopback-only (confined to `127.0.0.0/8` or `::1`); match-all entries such as `0.0.0.0/0` or `*.*.*.*` are not loopback-only |

A configured sign-in provider SHALL NOT satisfy Who may enter, because networks admitted without authentication bypass sign-in.

Share over the internet SHALL be: Choose provider → Install → Enable → Public address → Go online → Who may enter. Allow devices on my network SHALL be: Listen on network → Let devices ask → Who may enter. Let a phone or laptop in and Connect to another machine are defined by their own requirements.

#### Scenario: zrok ready but offline
- **GIVEN** zrok is the primary provider, installed, enabled and has a reserved name, but is not connected
- **WHEN** the operator opens Share over the internet
- **THEN** the current step SHALL be Go online
- **AND** Choose provider, Install, Enable and Public address SHALL be satisfied

#### Scenario: Temporary address
- **GIVEN** zrok has no reserved name and a persistent tunnel is requested
- **WHEN** the operator chooses "Use a temporary address" in Public address
- **THEN** `tunnel.zrok.persistent` SHALL be saved as false, so connecting does not generate a reserved name
- **AND** Go online SHALL become current

#### Scenario: Who may enter under legacy network trust
- **GIVEN** `192.168.16.0/24` is admitted without authentication
- **WHEN** the Who may enter step is evaluated
- **THEN** it SHALL be unsatisfied even if a sign-in provider is enabled
- **AND** its body SHALL state how many networks get full access without sign-in and link to the Security settings

#### Scenario: Loopback trust entries do not count
- **GIVEN** the only networks admitted without authentication are `127.0.0.1` and `::1`
- **WHEN** the Who may enter step is evaluated
- **THEN** it SHALL be satisfied

#### Scenario: Match-all entry is not loopback
- **GIVEN** `0.0.0.0/0` is admitted without authentication
- **WHEN** the Who may enter step is evaluated
- **THEN** it SHALL be unsatisfied

#### Scenario: Degraded reserved name
- **GIVEN** zrok has reserved name `robson-home` configured but the live share serves a temporary name
- **WHEN** the Public address step is evaluated
- **THEN** it SHALL be unsatisfied and show the degraded-share notice

### Requirement: Choose provider never changes a connected primary
Choose provider SHALL show each provider's readiness and SHALL NOT offer the Make-primary action (it remains in the Gateway settings). Selecting a provider when no primary is configured, or when the configured primary is not connected, SHALL make it the primary. When the configured primary is connected, the step SHALL NOT change `tunnel.provider`; it SHALL say that the connected provider must be disconnected first, or the other provider connected and made primary in the Gateway settings.

#### Scenario: Switching away from a connected primary
- **GIVEN** zrok is the connected primary
- **WHEN** the operator re-opens Choose provider and picks tailscale
- **THEN** `tunnel.provider` SHALL remain zrok
- **AND** the step SHALL explain how to switch and link to the Gateway settings

### Requirement: Satisfied steps are shown collapsed, never hidden
A satisfied step SHALL render collapsed with a check mark, its current value (for example the public address, or the live bind host) and the label "already set", and SHALL be re-openable. A step completed during the current run SHALL render the same way with the label "done". Two or more consecutive collapsed steps SHALL fold into one row reading "N steps already set" (or "N steps done" when any was completed in this run) that expands on activation. The first unsatisfied step SHALL be the expanded current step; later unsatisfied steps SHALL render as numbered, non-interactive upcoming rows. The dialog title SHALL show "step K of N".

#### Scenario: Re-open a satisfied step
- **GIVEN** the Public address step is collapsed as already set
- **WHEN** the operator activates it
- **THEN** it SHALL expand as the current step showing the reserved name

#### Scenario: Fold a run of satisfied steps
- **GIVEN** four consecutive steps are satisfied
- **WHEN** the task renders
- **THEN** they SHALL render as one row "4 steps already set"
- **AND** activating that row SHALL show the four steps individually

### Requirement: Steps that do not apply are omitted
A step that does not apply to the primary provider SHALL NOT be listed and SHALL NOT count toward "step K of N". The Public address step SHALL apply only to zrok; other providers' address options remain in the Gateway settings.

#### Scenario: Private mesh provider
- **GIVEN** tailscale is the primary provider
- **WHEN** the Share over the internet step list renders
- **THEN** no Public address step SHALL be listed

### Requirement: Exposure consequence is stated before the action
A step whose action widens who can reach this machine SHALL state the consequence in its body before its primary action:
- Go online SHALL state that anyone with the address reaches a sign-in / request-access page and that nobody gets in without approval or sign-in.
- Listen on network SHALL state that the dashboard becomes reachable on every network this computer is connected to (including VPNs), that devices there can open the request page over plain http (unencrypted), and that the server restarts; and when non-loopback networks are admitted without authentication, it SHALL name them and state that devices on them get full access without sign-in once the server listens.

#### Scenario: LAN consequence
- **WHEN** Listen on network is the current step
- **THEN** its body SHALL contain the all-networks, unencrypted-http and restart statements above the primary action

### Requirement: Listen on network keeps loopback, honours pinned binds, survives the restart
Before writing anything, Listen on network SHALL read which source decides the next restart's bind host. When a command-line flag or `PI_DASHBOARD_HOST` decides it, the step SHALL name that source and the bind host it sets, SHALL NOT write configuration, SHALL NOT restart, and SHALL offer no action. Otherwise the action SHALL save the bind host `0.0.0.0` (all interfaces, so this computer's own `localhost` origin keeps working) and restart the server. When a non-loopback bind is saved but not yet live — including when the restart request itself was refused or failed — the step SHALL read "restart pending" and offer Restart, and no resume SHALL remain stored. After the server returns, the dialog SHALL resume the same task at the same step; a resume older than two minutes SHALL be discarded.

#### Scenario: Resume after restart
- **GIVEN** the operator is on step 1 of Allow devices on my network
- **WHEN** they activate Listen on network and the server restarts
- **THEN** after reconnecting the dialog SHALL show Allow devices on my network with Listen on network done and Let devices ask current

#### Scenario: Bind pinned by environment
- **GIVEN** `PI_DASHBOARD_HOST=127.0.0.1`
- **WHEN** Listen on network renders
- **THEN** it SHALL state that `PI_DASHBOARD_HOST` sets the bind host to `127.0.0.1`
- **AND** the configured bind host SHALL be unchanged and the server SHALL NOT restart

#### Scenario: Container binds all interfaces already
- **GIVEN** the server was started with `PI_DASHBOARD_HOST=0.0.0.0`
- **WHEN** Allow devices on my network renders
- **THEN** Listen on network SHALL be collapsed as already set showing "all networks (0.0.0.0)"

### Requirement: Let a device in infers the road
Let a phone or laptop in SHALL start with a Where is the device step. When the Internet road or the Devices on my network road (as defined on the landing) is on, the step SHALL be satisfied and show the endpoint it will use, preferring an https endpoint. When neither is on, it SHALL ask "On the same Wi-Fi" or "Anywhere"; choosing one SHALL insert the Listen on network and Let devices ask steps, or the Choose provider through Go online steps, before the pairing steps. Who may enter SHALL NOT be inserted, because the code approval that ends this task is the admission decision. Inserted steps SHALL remain listed after they are satisfied. The task SHALL end with Open it on the device and Approve with the code.

#### Scenario: Road already up
- **GIVEN** an internet share is connected
- **WHEN** the operator opens Let a phone or laptop in
- **THEN** Where is the device SHALL be satisfied showing the public address
- **AND** the current step SHALL be Open it on the device

#### Scenario: Listening but requests off is not a road
- **GIVEN** the server binds `0.0.0.0`, `pairing.acceptLanRequests` is false and no tunnel is connected
- **WHEN** the operator opens Let a phone or laptop in
- **THEN** Where is the device SHALL be unsatisfied

#### Scenario: No road, same Wi-Fi
- **GIVEN** no road is on
- **WHEN** the operator chooses On the same Wi-Fi
- **THEN** Listen on network and Let devices ask SHALL be inserted before Open it on the device

### Requirement: Open it on the device follows the endpoint's transport
On an https endpoint the step SHALL show the camera-scannable pairing QR and its copyable link. On a plain-http endpoint on the local network it SHALL instead show the bare address as a link QR and copy row, instruct the operator to open it on the device and choose Request access there, and state that the code compared in the next step is what protects the pairing. On a plain-http endpoint that is not on the local network (a private mesh without https), it SHALL state that pairing needs an https address or the same Wi-Fi and SHALL NOT show a QR. The step SHALL complete when a pairing request arrives.

#### Scenario: LAN-only road
- **GIVEN** the only road on is the LAN at `http://192.168.16.220:8000`
- **WHEN** Open it on the device renders
- **THEN** the QR and copy row SHALL contain `http://192.168.16.220:8000` with the instruction to choose Request access
- **AND** the step SHALL NOT render a pairing payload QR

### Requirement: Approve with the code uses the app-wide approval dialog
Approve with the code SHALL show the requesting device (described name, origin) and SHALL rely on the app-wide pairing approval dialog for code entry, approval, denial and refusal remedies; the step SHALL offer Review to raise that dialog again if it was dismissed. The step SHALL record the paired-device list when the request arrives and, when the request leaves the pending list, SHALL complete if exactly one new paired device appeared (naming it), report "N devices paired" if several appeared, and report "denied or expired" if none appeared.

#### Scenario: Approved
- **GIVEN** a request from "iPhone · Safari" is pending
- **WHEN** the operator approves it in the approval dialog
- **THEN** the step SHALL complete naming the new paired device

#### Scenario: Denied
- **GIVEN** a request is pending
- **WHEN** the operator denies it
- **THEN** the step SHALL report "denied or expired" and offer to start over

#### Scenario: Dismissed dialog
- **GIVEN** the operator closed the approval dialog without answering
- **WHEN** they activate Review in the step
- **THEN** the approval dialog SHALL open for that request

### Requirement: Connect to another machine
Connect to another machine SHALL be: Which machine → Check it can be reached → Ask that machine for access → finish.

Which machine SHALL list known servers with their reachability word, servers discovered on the network but not yet known labelled "found on this network" (they cannot be probed until added), and accept a typed address. The step SHALL first look the address up among the known servers (same normalised host and port); a match SHALL be used as-is and SHALL NOT be re-added. Otherwise continuing SHALL add it to the known servers (the reachability probe accepts only known servers) and the step SHALL remember that this run created it; a refusal because the same server is already known under another address SHALL use that entry and show its address; a refusal because its identity changed SHALL stop the task and show the reason.

Check it can be reached SHALL show the result of the server-side reachability probe; on failure it SHALL show the reason, SHALL NOT advance, and SHALL offer to remove the entry only if this run created it.

Ask that machine for access SHALL depend on the client:
- In a browser, it SHALL open the remote server's own request-access page (`/pair?request`) in a new tab without giving that page a reference to this window, state that the code to type on the other machine and the approval result are shown in that tab, and complete when the operator confirms. The step SHALL state that this confirmation is not verified by this dashboard.
- In the desktop app, it SHALL always prove the server's identity first; it SHALL knock only if the proven fingerprint equals the fingerprint pinned on the known-server entry and the advertised one, where present; when neither exists it SHALL show the proven fingerprint and knock only after the operator confirms it. It SHALL show the confirmation code inline and complete when the remote approves.

Finishing SHALL offer to open the server: in a browser, the remote dashboard in a new tab; in the desktop app, the existing server window.

#### Scenario: Unreachable typed server
- **GIVEN** the operator typed an address whose probe fails
- **WHEN** Check it can be reached runs
- **THEN** the step SHALL show the failure reason and SHALL NOT advance
- **AND** SHALL offer to remove the entry this run created

#### Scenario: Identity changed
- **GIVEN** the operator picks a server whose add is refused because its identity changed
- **WHEN** Which machine continues
- **THEN** the task SHALL stop and show that the server's identity changed

#### Scenario: Browser opens the remote request page
- **GIVEN** the dashboard runs in a browser and the operator picked `192.168.16.204:8000`
- **WHEN** Ask that machine for access runs
- **THEN** a new tab SHALL open `http://192.168.16.204:8000/pair?request` with no opener
- **AND** the step SHALL wait for the operator to confirm and state that the confirmation is not verified here

#### Scenario: Desktop app, no pin and no advert
- **GIVEN** the desktop app and a known-server entry with no pinned fingerprint and no advert
- **WHEN** Ask that machine for access runs
- **THEN** the proven fingerprint SHALL be shown
- **AND** no knock SHALL be sent until the operator confirms it

#### Scenario: Finish in a browser
- **GIVEN** the operator confirmed approval in a browser
- **WHEN** the task finishes
- **THEN** the dialog SHALL offer to open the remote dashboard in a new tab and Stay here
