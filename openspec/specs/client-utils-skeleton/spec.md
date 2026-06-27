# client-utils-skeleton Specification

## Purpose
Define the shared `Skeleton` loading primitive in `client-utils`. Content-shaped variants for content-layout loads; honors `prefers-reduced-motion`. Content loads use it instead of a centered spinner (NN/g skeleton-screens; Doherty).
## Requirements
### Requirement: Skeleton primitive for content-layout loads

`packages/client-utils` SHALL export a `Skeleton` component with content-shaped variants (`text`, `card`, `bubble`, `row`) and an optional `count`, used for content-layout loads. It SHALL honor `prefers-reduced-motion: reduce` by rendering a static placeholder with no shimmer animation.

#### Scenario: Renders shaped placeholders

- **WHEN** `Skeleton` is rendered with `variant="bubble"` and `count={3}`
- **THEN** it SHALL render three bubble-shaped placeholder rows

#### Scenario: Reduced motion disables shimmer

- **WHEN** `prefers-reduced-motion: reduce` is set
- **THEN** the skeleton SHALL render statically with no shimmer animation

### Requirement: Content-layout loads use Skeleton, not a centered spinner

Chat-history loading SHALL render `Skeleton` placeholders shaped like message bubbles instead of a centered spinner, so perceived latency and layout shift are reduced. Short blocking actions MAY continue to use a spinner.

#### Scenario: Chat history loading shows skeleton bubbles

- **WHEN** chat history is in flight for the selected session
- **THEN** the chat region SHALL show bubble skeletons
- **AND** SHALL NOT show a centered "Loading conversation…" spinner as the sole indicator

