# DOX — tests/e2e agent-teams templates-hooks specs

Sidecar of `tests/e2e/AGENTS.md` (byte cap). One row per spec of change add-agent-teams-templates-hooks. Written, NOT run (docker harness).

| File | Purpose |
|------|---------|
| `agent-teams-approval-card.spec.ts` | #F4, #F5: faux scenario `agent-teams-approval-cards` delivers 3 `plan_request` + `plan_decision` + `hook_feedback` rows; Approve/Reject post the header `planId` (forged header line in plan text ignored); stale ⇒ `already_decided`; non-control cards. Decision route = scriptable in-page store (`page.route`). See change: add-agent-teams-templates-hooks. |
| `agent-teams-command.spec.ts` | #F9: `/agent-team` in the command dropdown; `templates` / `start <template> "<goal>"` run in-process (notify, no failed pill); start ⇒ lead badge + playbook card. Template from the harness's real (bundled) listing. See change: add-agent-teams-templates-hooks. |
| `agent-teams-start-dialog.spec.ts` | #S15, #F1–#F3: folder-menu item `folder-menu-item-agent-teams-start`; real start with a bundled template; hook confirmation (commands literal, shown hash), double submit, error cases via in-page start route stand-in. See change: add-agent-teams-templates-hooks. |
