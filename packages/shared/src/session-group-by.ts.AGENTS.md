# session-group-by.ts

Group-by vocabulary. Exports `GroupByMode` (none/status/location), `StatusLaneId`, `LocationLaneId`, `LaneId`, `GROUP_BY_MODES`, `STATUS_LANE_ORDER` (needs-you, error, working, review, idle), `LOCATION_LANE_ORDER`, guards `isGroupByMode`/`isLaneId`, `laneCollapseKey`/`parseLaneCollapseKey` (`<pathKey>::<lane>`, splits on LAST `::`), `GroupByPrefs`. Shared by server validation + client lanes. See change: session-list-group-by.
