# archived-session-view.spec.ts — index

L3 F1–F4, X3, X4 (change: fix-archived-session-view-header-and-stale-artifact-tab).
Seeds one archived sidecar (`e2e-archview-archived`) + `POST /api/restart`; the change `e2e-stale` exists only under `archive/<today>-e2e-stale`; cleanup by name prefix on entry and exit.
F1/F2: `?archived=1` header shows name + layout switch (+ `embed-exit` with `embed=1`); MutationObserver proves "No session selected" never appears.
F3: no seek/resume/fork controls; title menu lacks Rename / Reveal in sidebar / Edit tags.
F4: persisted stale proposal tab (`page.addInitScript`) → archived notice, every `/api/file` has non-empty `cwd`, Open archived copy leaves one tab.
X3/X4: `page.route` delays or 404s `/api/sessions/archived/<id>` → "Loading archived session…" / "Archived session unavailable", no empty-cwd request.
Uses `armFirstLaunchDismiss` (exported from `helpers/index.ts`).
