# image-lightbox Specification

## Purpose

Full-screen image lightbox for the chat UI. Opens on image click (message attachments, tool-result images, paste-preview thumbnails), supports zoom/pan, and dismisses on Escape or backdrop click. Escape dismissal routes through the shared escape-stack so a lightbox stacked over a dialog/overlay closes only itself.
## Requirements
### Requirement: Click image to open lightbox
All images in the chat UI (user message attachments, tool result images, paste preview thumbnails) SHALL open a full-size lightbox dialog when clicked. The image thumbnail SHALL display `cursor-pointer` to indicate interactivity.

#### Scenario: Click user message image
- **WHEN** user clicks an image in a user message bubble
- **THEN** a lightbox dialog opens showing the image at full size over a dark overlay

#### Scenario: Click tool result image
- **WHEN** user clicks an image in an expanded tool result (e.g., ReadToolRenderer)
- **THEN** a lightbox dialog opens showing the image at full size over a dark overlay

#### Scenario: Click paste preview image
- **WHEN** user clicks an image thumbnail in the CommandInput paste preview area
- **THEN** a lightbox dialog opens showing the image at full size over a dark overlay

### Requirement: Close lightbox with Escape key

The lightbox dialog SHALL close when the user presses the Escape key. Escape dismissal SHALL be routed through the shared escape-dismiss stack so that, when the lightbox is opened above another dismissible surface (a dialog, another overlay), one Escape closes **only the lightbox** and leaves the surface beneath it open.

#### Scenario: Press Escape to close

- **WHEN** the lightbox is open and user presses Escape
- **THEN** the lightbox closes and the previously visible surface is visible again

#### Scenario: Escape does not close the underlying dialog

- **WHEN** the lightbox was opened from within an open dialog (e.g. a pasted-image thumbnail in the Explore dialog)
- **AND** the user presses Escape
- **THEN** only the lightbox closes
- **AND** the underlying dialog remains open
- **AND** a second Escape then closes the dialog

### Requirement: Close lightbox with backdrop click
The lightbox dialog SHALL close when the user clicks the dark overlay area outside the image.

#### Scenario: Click backdrop to close
- **WHEN** the lightbox is open and user clicks the dark area outside the image
- **THEN** the lightbox closes

#### Scenario: Click image does not close
- **WHEN** the lightbox is open and user clicks on the image itself
- **THEN** the lightbox SHALL NOT close (click initiates drag/pan)

### Requirement: Zoom and pan in lightbox
The lightbox SHALL support zoom via mouse wheel and pinch gesture, and pan via click-and-drag. Double-click SHALL reset zoom/pan to default.

#### Scenario: Wheel zoom
- **WHEN** user scrolls the mouse wheel over the lightbox image
- **THEN** the image zooms in or out centered on the cursor position

#### Scenario: Drag to pan
- **WHEN** user clicks and drags on the image
- **THEN** the image pans following the pointer movement

#### Scenario: Pinch to zoom on touch
- **WHEN** user performs a two-finger pinch gesture on the image
- **THEN** the image zooms in or out centered between the touch points

#### Scenario: Double-click to reset
- **WHEN** user double-clicks the image in the lightbox
- **THEN** zoom and pan reset to the default (scale 1, centered)

