## MODIFIED Requirements

### Requirement: Reliable swipe-back gesture
The swipe-back gesture SHALL use a 40px left-edge activation zone and SHALL listen for touch events at the document level so that scrollable child elements (e.g., ChatView, SettingsPanel) do not intercept the gesture. While the document holds a non-collapsed text selection outside editable fields, the gesture SHALL NOT activate. If such a selection appears during a gesture, the gesture SHALL be abandoned without navigating, and any swipe offset SHALL be reset to rest. Extending a selection through the edge zone is never turned into a back navigation. A selection inside an editable field (input, textarea, contenteditable) SHALL NOT block the gesture.

#### Scenario: Swipe-back over scrollable content
- **WHEN** a user starts a swipe from the left 40px edge over a scrollable ChatView
- **THEN** the swipe-back gesture SHALL activate and navigate back

#### Scenario: Touch outside edge zone
- **WHEN** a user touches the screen more than 40px from the left edge
- **THEN** the swipe-back gesture SHALL NOT activate

#### Scenario: Extending a text selection through the edge zone
- **WHEN** the user holds a non-collapsed text selection in page content AND drags horizontally starting inside the left 40px edge zone
- **THEN** the swipe-back gesture SHALL NOT activate, SHALL NOT call `preventDefault()` on the touch, and SHALL NOT navigate back

#### Scenario: Selection appears mid-gesture
- **WHEN** a swipe-back gesture is in progress AND a non-collapsed text selection in page content appears
- **THEN** the gesture SHALL be abandoned, the panel offset SHALL return to rest, and no back navigation SHALL occur

#### Scenario: Selection inside an editable field does not block swipe-back
- **WHEN** the user has text selected inside the composer input AND swipes from the left 40px edge
- **THEN** the swipe-back gesture SHALL activate as usual
