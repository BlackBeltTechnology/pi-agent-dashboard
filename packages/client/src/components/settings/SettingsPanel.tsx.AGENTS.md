

Default model: `ModelSelector allowRoles`; role pick saves `@role` + `defaultThinkingLevel:""` + `rolesSnapshot.refetch()`. Role-default level control: role level tagged `role`, `role` placeholder when unknown, never locked. Follow hint `default-model-follows` / dangling `default-model-dangling` (RoleRef + active preset). `unresolved-role` mirror skip → no skip notice. `PiSettingsPage dashboardDefaults` = `resolvedMirrorDefaults(original, liveRows)`. See change: default-model-follows-role.

External one-shot `?scroll=<data-testid>` on canonical `/settings/:page?/:sub?`: read via reactive `useSearch()`, consumed once `!loading && config`; only `SCROLL_TARGET_RE` `^[A-Za-z0-9_-]{1,64}$` reaches `querySelector`; then `navigate(/settings/<page><sub>, {replace:true})` whether found or not. Consumed-ref resets when `scroll` absent (repeat trip). Rejected `/api/config` leaves URL untouched. Internal `requestRailNavigate` stays route-free. See change: card-sections-global-pointer.
