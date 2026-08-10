# live-event-frame-coalescing-fold Specification

## Purpose

Fold a queued burst of live WebSocket `event` messages into a single resulting `SessionState` so that one React state update is applied per frame instead of one per event. The fold applies each event through the same live reducer path (`reduceEvent(..., { isLive: true })`) in ascending `seq` order, guaranteeing the folded result is identical to reducing the same events one-by-one, and reports the maximum `seq` processed.

## Requirements

### Requirement: Ordered equivalence fold

`foldLiveEvents` SHALL fold a burst of queued live events into a single `SessionState` that is identical to the state produced by applying the same events one-by-one through `reduceEvent` with `{ isLive: true }` in ascending `seq` order.

#### Scenario: Fold matches per-event reduce

- **WHEN** `foldLiveEvents` is called with a current `SessionState` and a burst of queued events
- **THEN** each event is applied through `reduceEvent(state, event, { isLive: true })`, threading the returned state into the next application
- **AND** the returned `state` equals the state obtained by reducing the same events individually in ascending `seq` order
- **AND** the current state passed in is used as the fold's starting state

#### Scenario: Events applied in ascending seq order regardless of input order

- **WHEN** the queued events are provided in an order that is not sorted by `seq`
- **THEN** `foldLiveEvents` sorts the events by ascending `seq` before applying them
- **AND** the sort operates on a copy of the input, leaving the caller's queue array unmutated

### Requirement: Maximum seq reporting

`foldLiveEvents` SHALL return the maximum `seq` observed across the folded burst alongside the folded state.

#### Scenario: Non-empty burst returns batch maximum seq

- **WHEN** `foldLiveEvents` folds a non-empty burst of queued events
- **THEN** the returned `maxSeq` equals the largest `seq` value among the burst's events

#### Scenario: Empty burst returns unchanged state and negative-infinity maxSeq

- **WHEN** `foldLiveEvents` is called with an empty queue
- **THEN** the returned `state` is the unchanged current state
- **AND** the returned `maxSeq` is `Number.NEGATIVE_INFINITY`
