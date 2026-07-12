## ADDED Requirements

### Requirement: Image-bearing rows keep true height in the virtualized transcript

The virtualized chat transcript SHALL correct an image-bearing row's measured height after each attached image finishes decoding, so the row never stays collapsed at its pre-decode estimate. The image element SHALL reserve a bounded layout box while loading so the initial measurement is not near-zero.

Rationale: image data-URLs decode asynchronously. Under TanStack virtualization a
row is first measured at mount (before decode) and only corrected by measurement.
Without a decode-driven re-measure the row can be cached at a collapsed height and
overlap its neighbour — the message with the image visually disappears (issue #267).

#### Scenario: Row re-measures after an image decodes
- **WHEN** a user `ChatMessage` with one or more `images` renders in the virtualized
  transcript AND an attached `<img>` fires `onLoad`
- **THEN** the virtualizer SHALL re-measure that row so its recorded height reflects
  the decoded image, not the pre-decode estimate

#### Scenario: Image-bearing message survives session switch and scroll
- **WHEN** the user switches away from and back to a session (ChatView is reused,
  not remounted) whose transcript contains an image-bearing message, or scrolls the
  message out of and back into the viewport
- **THEN** the image-bearing row SHALL remain visible at its true height and SHALL
  NOT collapse or overlap adjacent rows

#### Scenario: Multiple images do not cause a measure storm
- **WHEN** a single message carries multiple images that decode in the same frame
- **THEN** the row SHALL be re-measured at most once per row per animation frame
