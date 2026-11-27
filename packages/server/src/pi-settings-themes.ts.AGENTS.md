# pi-settings-themes.ts — index

`createThemeLister(scan)` → `{list, invalidate}`: sorted theme names (30 s cache, 5 s when degraded, in-flight de-dup; routes invalidate on writes) for the pi settings page: built-ins `system`/`dark`/`light` + enabled global/package theme files by their JSON `name` (basename fallback; unreadable, `system`, `/` names dropped). Scanner failure or 3 s timeout → built-ins only. See change: pi-settings-full-coverage.
