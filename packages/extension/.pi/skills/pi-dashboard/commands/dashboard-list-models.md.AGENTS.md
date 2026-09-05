# pi-dashboard/commands/dashboard-list-models.md — index

LLM-bound command. GET $BASE/api/models; `annotated` arg → /api/models?annotated=1 adds `excludedReason` (null=reachable). WARN: never parse ~/.pi/agent/providers.json or models.json — silent empty; /api/models only correct surface. Usage `/dashboard:list-models [annotated]`.
