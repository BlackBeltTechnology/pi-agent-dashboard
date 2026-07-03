# debug-dashboard/SKILL.md — index

System-level debugging for running dashboard. Three layers: server alive (`health-probe.ts`, `tail-server-log.ts`), bridge connecting (`list-sessions.ts`), UI rendering (routes to `browser` skill). Symptom→cause table (restart loops, blank page, Electron boot, Fastify crash on bad Node). Docs-first gate: grep `docs/faq.md` before source.
