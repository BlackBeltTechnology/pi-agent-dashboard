# image-paste Specification

## Purpose

Lets the user paste images from the clipboard into a message. Defines the size limit, preview thumbnails, how images are attached when the message is sent, and per-surface ownership of paste state so two input surfaces cannot fight over the same pasted image.

## Requirements

### Requirement: Clipboard image paste
Prompt input surfaces — the chat input AND the OpenSpec Explore dialog — SHALL detect image content in clipboard paste events and extract images for attachment. Supported MIME types SHALL include `image/png`, `image/jpeg`, `image/gif`, and `image/webp`. Paste handling SHALL be implemented via a single shared `useImagePaste()` hook so behavior is identical across surfaces.

#### Scenario: Paste image from clipboard into chat input
- **WHEN** the user pastes clipboard content that contains an image into the chat input
- **THEN** the system SHALL extract the image, convert it to base64, and add it to the chat input's pending images list

#### Scenario: Paste image from clipboard into Explore dialog
- **WHEN** the user pastes clipboard content that contains an image into the Explore dialog textarea
- **THEN** the system SHALL extract the image, convert it to base64, and add it to the Explore dialog's pending images list

#### Scenario: Paste text only
- **WHEN** the user pastes plain text from the clipboard into any prompt input surface
- **THEN** the system SHALL insert the text normally and NOT trigger image handling

#### Scenario: Paste mixed content
- **WHEN** the user pastes content containing both text and an image into any prompt input surface
- **THEN** the system SHALL extract the image and insert the text separately

### Requirement: Image size limit
The system SHALL reject images larger than 10MB (base64 encoded size) and show an error message, across all prompt input surfaces that support image paste.

#### Scenario: Image within size limit
- **WHEN** the user pastes a 2MB image into a prompt input surface
- **THEN** the image SHALL be accepted and added to pending images

#### Scenario: Image exceeds size limit
- **WHEN** the user pastes a 15MB image into a prompt input surface
- **THEN** the system SHALL reject the image and display an error message "Image too large (max 10MB)"

### Requirement: Image preview thumbnails
Pending images SHALL be displayed as thumbnails below the textarea of the prompt input surface, rendered by a single shared `<ImagePreviewStrip>` component. Each thumbnail SHALL have a remove button to discard the image before sending. Thumbnails SHALL be clickable to open the image in a lightbox.

#### Scenario: Single image pasted
- **WHEN** the user pastes one image into any prompt input surface
- **THEN** a thumbnail preview SHALL appear below the textarea with a remove (×) button

#### Scenario: Multiple images pasted
- **WHEN** the user pastes multiple images (via multiple paste actions) into the same prompt input surface
- **THEN** all thumbnails SHALL be displayed in a horizontal row

#### Scenario: Remove image
- **WHEN** the user clicks the remove button on a thumbnail
- **THEN** that image SHALL be removed from that surface's pending images list and the thumbnail SHALL disappear

### Requirement: Images sent with message
When the user sends a message with pending images, the images SHALL be included in the `send_prompt` message as `ImageContent[]` alongside the text. After sending, pending images SHALL be cleared. This applies to both the chat input and the Explore dialog.

#### Scenario: Send chat message with images
- **WHEN** the user types "what is this?" in the chat input, has a pasted image, and presses Enter
- **THEN** the `send_prompt` message SHALL include `text: "what is this?"` and `images: [{ type: "image", data: "<base64>", mimeType: "image/png" }]`

#### Scenario: Send Explore prompt with images
- **WHEN** the user types text in the Explore dialog, has a pasted image, and clicks Explore
- **THEN** the `send_prompt` message SHALL include the composed explore text AND `images: [{ type: "image", data: "<base64>", mimeType: "image/png" }]`

#### Scenario: Send image without text
- **WHEN** the user has a pasted image but no text in any prompt input surface, and attempts to send
- **THEN** the message SHALL NOT be sent (text is required)

#### Scenario: Images cleared after send
- **WHEN** a message with images is sent successfully from any prompt input surface
- **THEN** that surface's pending images list SHALL be empty and thumbnails SHALL disappear

### Requirement: Per-surface image-paste state ownership

Pending pasted images SHALL be scoped per prompt-input surface. For the chat input, the surface SHALL be the active session: pending images SHALL be associated with `sessionId` and SHALL survive any client-side navigation that unmounts and remounts `<CommandInput>`. For the OpenSpec Explore dialog, the surface SHALL be the dialog instance itself: pending images SHALL live and die with the dialog. The shared `useImagePaste()` hook SHALL support both modes — controlled (caller-owned `images` + `onImagesChange`) for the chat-input surface and uncontrolled (hook-internal `useState`) for the Explore dialog.

#### Scenario: Chat input pending images survive route change
- **WHEN** the user pastes an image into the chat input, navigates to `/settings`, and navigates back to the same session
- **THEN** the previously pasted image SHALL still be visible in the chat input's preview strip and SHALL be included in the next `send_prompt`

#### Scenario: Chat input pending images do not leak across sessions
- **WHEN** the user pastes an image into the chat input while session A is selected and then switches to session B
- **THEN** session B's chat input SHALL NOT show session A's image, and a `send_prompt` from session B SHALL NOT include session A's image

#### Scenario: Explore dialog pending images live with the dialog
- **WHEN** the user pastes an image into the Explore dialog, then closes the dialog without sending, then reopens it
- **THEN** the reopened Explore dialog SHALL start with no pending images
