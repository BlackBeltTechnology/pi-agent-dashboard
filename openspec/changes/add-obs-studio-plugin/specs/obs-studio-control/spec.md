## Purpose

Control a provisioned OBS from agents and operators through the `pi-obs` CLI and the `obs-studio` skill: scenes, devices, outputs, text, filters, screenshots and idempotent presets, with known-crashing requests refused and secrets delivered only through `service exec`.

## ADDED Requirements

### Requirement: Connection resolution and secret delivery
`pi-obs` SHALL resolve its target from an explicit service id or URL, take the password from the `service exec` child environment, and otherwise fall back to `OBS_URL` / `OBS_PASSWORD` environment variables. When several service passwords are present and no service is named, it SHALL refuse with a usage error. The skill SHALL invoke live verbs through `pi-dashboard service exec <id> -- pi-obs … --service <id>`; offline verbs (`doctor`, `install`, `provision`, `launch`, `stop`) SHALL run without a secret. `pi-obs` SHALL never print the password or accept it as an argument. A live verb SHALL report `auth-failed` distinctly from `unreachable` when OBS answers but rejects the password.

#### Scenario: Through service exec
- **WHEN** the skill runs `pi-dashboard service exec obs -- pi-obs status`
- **THEN** pi-obs authenticates with the service secret and prints OBS version, current scene and output states

#### Scenario: Standalone fallback
- **WHEN** pi-obs runs without a service secret and with `OBS_URL` and `OBS_PASSWORD` set
- **THEN** it connects using those values

#### Scenario: Wrong password
- **WHEN** OBS sends its hello but rejects the stored password
- **THEN** the verb exits non-zero with `auth-failed`, not `unreachable`

#### Scenario: Ambiguous service
- **WHEN** `SVC_OBS_PASSWORD` and `SVC_OBS_STUDIO2_PASSWORD` are both set and no `--service` is given
- **THEN** the verb exits with a usage error naming both services

#### Scenario: Password as argument rejected
- **WHEN** pi-obs is invoked with a `--password` argument
- **THEN** it exits with a usage error that names the supported secret channels

### Requirement: Control verbs
`pi-obs` SHALL provide verbs to report status, list/switch/create scenes, list devices (cameras, audio, displays), bind an input to a device or display, toggle the virtual camera and recording, set the stream target with the key read from stdin, set a text source, add a background-removal filter, capture a source screenshot to a file, and run a single obs-websocket request (`call`) whose JSON comes only from stdin or a file. Every verb SHALL support `--json`, exit 0 on success and non-zero on failure, and accept `--service <id>` to address one of several instances. A verb whose request is not in the connected OBS's available requests SHALL return `unsupported-request` without sending it. Connecting SHALL time out after 3 seconds and each request after 5 seconds, reported as `timeout` with a non-zero exit.

#### Scenario: Scene switch
- **WHEN** the user runs `pi-obs scene switch "Desktop + Webcam"`
- **THEN** the program scene becomes `Desktop + Webcam`

#### Scenario: Unknown scene
- **WHEN** the named scene does not exist
- **THEN** the verb exits non-zero and lists the available scenes

#### Scenario: Stream key from stdin
- **WHEN** `pi-obs stream target rtmp://host/app --key-stdin` runs against a loopback OBS with the key on stdin
- **THEN** the stream service is set and the key appears in no output, log or process argument list

#### Scenario: Stream key to a remote OBS over plain ws
- **WHEN** the same verb targets a non-loopback `ws://` OBS without `--allow-insecure-remote`
- **THEN** it is refused before any request is sent

#### Scenario: OBS stops answering
- **WHEN** OBS accepts the connection but does not answer a request within 5 seconds
- **THEN** the verb exits non-zero with `timeout`

#### Scenario: Request missing on older OBS
- **WHEN** a verb needs a request absent from the connected OBS's available requests
- **THEN** it returns `unsupported-request` and sends nothing

### Requirement: Request deny-list
The system SHALL refuse obs-websocket requests known to hang or crash OBS before sending them, for every entry point (verbs, `call`, and the server bridge). Property-list enumeration on a screen-capture input SHALL be denied, and SHALL also be denied when the target input cannot be resolved by name or UUID. Through `call`, requests that remove objects or change, create or remove scene collections or profiles, profile parameters or stream settings SHALL be denied. The refusal SHALL name the reason and the safe alternative.

#### Scenario: Screen capture enumeration refused
- **WHEN** `pi-obs call GetInputPropertiesListPropertyItems '{"inputName":"Desktop Full","propertyName":"display_uuid"}'` targets a `screen_capture` input
- **THEN** no request is sent and the error recommends `pi-obs devices list --kind display`

#### Scenario: Unresolvable target denied
- **WHEN** the same request names an input UUID that matches no input
- **THEN** no request is sent and the refusal reports `unresolved-target`

#### Scenario: Destructive call denied
- **WHEN** `pi-obs call RemoveScene` is run with a scene name on stdin
- **THEN** no request is sent and the refusal names the OBS UI as the alternative

#### Scenario: Request JSON on argv rejected
- **WHEN** `pi-obs call GetInputSettings '{"inputName":"x"}'` passes JSON as an argument
- **THEN** the verb exits with a usage error naming stdin and `--json-file`

#### Scenario: Same request on a camera input
- **WHEN** the same request targets a camera input
- **THEN** the request is sent and its items returned

### Requirement: Device discovery and binding
Device listing SHALL return cameras and audio devices as OBS reports them, using a temporary probe input only when no input of that kind exists, placing it in a dedicated non-program scene, refusing to probe while streaming or recording, and removing input and scene afterwards (including leftovers from interrupted runs), and on macOS SHALL return displays with the identifier accepted by screen-capture inputs, without enumerating screen-capture properties. The OBS virtual camera SHALL be excluded from camera listings, and binding it to any input SHALL be refused. On platforms where display enumeration is unsupported, the listing SHALL say so.

#### Scenario: macOS displays listed
- **WHEN** `pi-obs devices list --kind display` runs on macOS
- **THEN** each active display is listed with its identifier, size and main-display flag

#### Scenario: No probe during a live recording
- **WHEN** audio devices are listed while recording is active and no audio input exists
- **THEN** the listing is refused with `output-active` and no input is created

#### Scenario: Virtual camera refused
- **WHEN** the user binds `Webcam Full` to the OBS Virtual Camera device
- **THEN** the binding is refused with a feedback-loop explanation

### Requirement: Idempotent presets in the current collection
Presets SHALL create missing scenes and inputs by name in the current scene collection, report each item as `created`, `existing`, `incomplete` (an existing scene lacks an expected item) or `skipped`, and SHALL NOT change the settings of an existing input or switch the scene collection. A preset SHALL bind devices only for inputs it created, choosing the first non-virtual camera and the main display. A preset that needs an absent OBS plugin SHALL report `plugin-missing` and apply its other items.

#### Scenario: Second apply is a no-op
- **WHEN** `pi-obs preset apply desktop-webcam-pip` runs twice
- **THEN** the second run reports every item `existing` and the collection is unchanged

#### Scenario: User-tuned input preserved
- **WHEN** the preset runs and an input named `Webcam Box` already exists with user settings
- **THEN** that input's settings are unchanged

#### Scenario: Background removal plugin absent
- **WHEN** `pi-obs preset apply pip-bgremoval` runs and the background-removal filter kind is unavailable
- **THEN** the filter item reports `plugin-missing` and the remaining items are applied

### Requirement: Skill guidance
The `obs-studio` skill SHALL instruct the agent to obtain the user's confirmation via `ask_user` before any install, provision, config rotation or stop, run `ensure` before control, use `service exec` for every live verb, prefer verbs over `call`, run `doctor` when a source renders blank or the service is not healthy, and tell the user to fully restart other apps after the virtual camera is first activated. It SHALL carry the known OBS gotchas as a reference.

#### Scenario: Blank source guidance
- **WHEN** a user reports that a capture source is blank
- **THEN** the skill directs the agent to `pi-obs doctor` before any permission advice
