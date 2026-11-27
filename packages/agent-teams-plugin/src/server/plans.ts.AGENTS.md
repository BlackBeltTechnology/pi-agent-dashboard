# plans.ts — index

Plan approval: `PlanSubmit` (`message_too_long`/`invalid_args`/`plan_not_required`, supersede, `plan_request` mail) and `PlanDecision` op; `decidePlan` shared with REST (`user_decision_required`, `already_decided`, `unknown_plan`; `decidedBy` from verified actor); `listPlans`, `cancelPendingPlans`; registers dispatch eligibility, idle-notice filter, hello plan mode, spawn env, session-end + post-restart cancel. See change: add-agent-teams-templates-hooks.
