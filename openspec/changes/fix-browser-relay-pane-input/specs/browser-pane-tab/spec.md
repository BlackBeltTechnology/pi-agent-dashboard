## MODIFIED Requirements

### Requirement: Frame rendering and idle state

The pane tab SHALL render the most recent frame fitted to the pane by default, preserving aspect ratio, with a toggle to 1:1 scale. When the relay reports `no-frames` and the tab has stayed `no-frames` for 5 s, the pane tab SHALL keep showing the last frame unobscured and SHALL show a non-blocking idle indicator with a `Bring to front` action; the indicator SHALL disappear as soon as the tab reports any other state, and a `no-frames` period shorter than 5 s SHALL show no indicator. Before the first frame it SHALL show "Waiting for frames…". When the relay reports `detached` with reason `devtools` or `no-session`, it SHALL hide the frame, show the matching explanation, and block input.

#### Scenario: Static page stays visible
- **WHEN** a frame was rendered and the tab then reports `no-frames` for 5 s
- **THEN** the last frame SHALL remain fully visible, and an idle indicator with `Bring to front` SHALL be shown without covering the frame

#### Scenario: Brief repaint pause shows no indicator
- **WHEN** the tab reports `no-frames` and reports `live` again within 5 s
- **THEN** no idle indicator SHALL be shown at any point

#### Scenario: DevTools takes the tab
- **WHEN** the relay reports the tab `detached` with reason `devtools`
- **THEN** the frame SHALL be hidden, "DevTools open on this tab — close it to resume" SHALL be shown, and no input SHALL be sent

### Requirement: Desktop and touch input

While input is on and the tab is not detached, the pane tab SHALL translate pointer press/release into a `mouse` click, pointer movement into a `mouse` move, wheel into `scroll`, and key down/up into `key` input. All `mouse` and `scroll` coordinates SHALL be normalized to `[0,1]` of the rendered frame; a pointer or wheel event SHALL produce no input while no frame image is rendered or when its position falls outside the rendered frame image. A key down of a single printable character with Meta not held and Ctrl not held (Ctrl together with Alt, as AltGr reports, counts as not held) SHALL carry `text` equal to that character, and Enter under the same modifier rule SHALL carry `text: "\r"`; key up and other keys SHALL carry no `text`. Touch taps SHALL produce the same `mouse` click as a pointer click. Pointer interaction on the frame SHALL NOT select or drag dashboard text or images.

#### Scenario: Tap on a phone
- **WHEN** the user taps the frame at its exact center on a touch device
- **THEN** one `mouse` click with `x: 0.5, y: 0.5` SHALL be sent

#### Scenario: Drag does not select dashboard text
- **WHEN** the user presses, moves and releases the pointer across the frame
- **THEN** no dashboard text selection SHALL result

#### Scenario: Typing into the frame inserts text
- **WHEN** the frame has focus and the user types `a`
- **THEN** a `key` input with `keyType: "keyDown"`, `key: "a"` and `text: "a"` SHALL be sent, followed by a `keyUp` without `text`

#### Scenario: Shortcut carries no text
- **WHEN** the frame has focus and the user presses Ctrl+A or Meta+A
- **THEN** the `keyDown` SHALL carry no `text`

#### Scenario: Pointer over the letterbox
- **WHEN** the frame is fitted with empty space beside the image and the pointer moves or clicks in that space
- **THEN** no `browser_relay_input` SHALL be sent

#### Scenario: AltGr character
- **WHEN** the frame has focus and the user types `@` with AltGr, reported as `key: "@"` with `ctrlKey` and `altKey` set
- **THEN** the `keyDown` SHALL carry `text: "@"`

#### Scenario: No image yet
- **WHEN** the pane shows "Waiting for frames…" and the user clicks or scrolls in it
- **THEN** no `browser_relay_input` SHALL be sent
