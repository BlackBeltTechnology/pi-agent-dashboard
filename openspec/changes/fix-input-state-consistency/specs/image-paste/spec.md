## MODIFIED Requirements

### Requirement: Images sent with message
When the user sends a message with pending images, the images SHALL be included in the `send_prompt` message as `ImageContent[]` alongside the text. The text MAY be empty: pending images alone SHALL be sufficient to send, and with neither text nor images nothing SHALL be sent. After sending, pending images SHALL be cleared. This applies to both the chat input and the Explore dialog. The directory-home composer, whose spawn carries no images, SHALL keep requiring text.

#### Scenario: Send chat message with images
- **WHEN** the user types "what is this?" in the chat input, has a pasted image, and presses Enter
- **THEN** the `send_prompt` message SHALL include `text: "what is this?"` and `images: [{ type: "image", data: "<base64>", mimeType: "image/png" }]`

#### Scenario: Send Explore prompt with images
- **WHEN** the user types text in the Explore dialog, has a pasted image, and clicks Explore
- **THEN** the `send_prompt` message SHALL include the composed explore text AND `images: [{ type: "image", data: "<base64>", mimeType: "image/png" }]`

#### Scenario: Send image without text
- **WHEN** the user has a pasted image but no text in the chat input, and attempts to send
- **THEN** `onSend` SHALL be called with `""` and that image, and the input and images SHALL be cleared

#### Scenario: Image-only Explore
- **WHEN** the Explore dialog text is empty, an image is pending, and the user activates Explore
- **THEN** the dialog SHALL send with the image and its Explore action SHALL be enabled

#### Scenario: Empty and no images stays blocked
- **WHEN** the text is empty and no image is pending
- **THEN** the send action SHALL be disabled and Enter SHALL send nothing

#### Scenario: Directory home still needs text
- **WHEN** the directory-home composer has only a pending image
- **THEN** no session SHALL be spawned

#### Scenario: Images cleared after send
- **WHEN** a message with images is sent successfully from any prompt input surface
- **THEN** that surface's pending images list SHALL be empty and thumbnails SHALL disappear

## ADDED Requirements

### Requirement: Image-only prompt carries no empty text block
When a `send_prompt` has empty text and at least one valid image, the bridge SHALL build the user message content from the images only, with no `{type:"text", text:""}` block. This applies to the idle, steer and buffered follow-up drain paths. With no valid image the content SHALL stay the bare text string.

#### Scenario: Image-only content
- **WHEN** `buildUserMessageContent("", [validImage])` runs
- **THEN** it SHALL return `[validImage]`

#### Scenario: Text plus image unchanged
- **WHEN** `buildUserMessageContent("hi", [validImage])` runs
- **THEN** it SHALL return `[{type:"text",text:"hi"}, validImage]`

#### Scenario: Image-only follow-up drain
- **WHEN** a buffered follow-up with empty text and one image drains
- **THEN** `pi.sendUserMessage` SHALL receive the images-only content array
