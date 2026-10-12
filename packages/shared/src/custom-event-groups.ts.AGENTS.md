# custom-event-groups.ts — index

Browser-safe types + shipped defaults for custom chat row groups. Exports `CustomEventGroup`, `ClientCustomEventGroup`, `SHIPPED_CUSTOM_EVENT_GROUPS`, `RESERVED_OTHER_GROUP_ID`, `defaultCustomEventGroupPrefs`. No node imports (client bundle purity). See change: add-custom-event-group-filters. Shipped `diagnostics` group (`^subagent-admission-refused$`, `default:false`, appended last so existing user rules keep winning; reaches existing configs via the `seenShippedIds` merge). See change: render-unclaimed-custom-entries.
