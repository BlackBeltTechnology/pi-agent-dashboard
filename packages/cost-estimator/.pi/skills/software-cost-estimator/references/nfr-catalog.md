# Non-functional requirements: routing and sizing

## The core insight

Most NFRs do not stay non-functional. "99.95% availability" is not a multiplier — it is
health probes, readiness endpoints, multi-AZ failover, replication, a runbook, a restore
drill and an on-call rota. By the time you build it, it is functional scope.

The COSMIC *Guideline for sizing NFR* makes this explicit: NFRs are progressively
allocated to architectural components and become functional processes. IEEE/ISO/IEC
32430-2024 standardizes non-functional size measurement as a complement to functional
size, specifically designed so the two do not double count.

So each NFR takes **exactly one** of two paths.

## Path 1 — derived scope

Use when the NFR forces identifiable components or work items into existence.
Write them out as `derived_components`. They get sized and estimated like features.

```yaml
- id: NFR-01
  attribute: availability
  target: "99.95% during business hours"
  path: derived-scope
  derived_components:
    - name: Health probes and readiness endpoints
      transactions: 2
      ai_class: ops
    - name: Multi-AZ failover and replication
      transactions: 5
      ai_class: ops
      risk: high
    - name: Restore drill and runbook
      hours: 24          # size directly in hours when it is not transactional
      ai_class: docs
```

Sizing a component: give it `transactions` to size it via UCP, or `hours` to pin it
directly. Direct hours are right for anything that is not a transactional feature —
documentation, drills, audits, remediation windows.

## Path 2 — residual multiplier

Use when the NFR is pervasive: it makes *everything* somewhat harder without adding an
identifiable component. Express it as an effort multiplier.

```yaml
- id: NFR-04
  attribute: performance-efficiency
  target: "p95 < 500 ms on shop-floor tablets"
  path: multiplier
  multiplier: 1.06
```

Keep multipliers small and additive-ish. If you find yourself writing 1.4, you have
almost certainly got derived scope hiding inside it — decompose instead. A stack of
multipliers compounding past ~1.25 total is a smell.

**A multiplier NFR must not also declare `derived_components`.** The engine warns; the
number is wrong either way.

## Routing table by ISO/IEC 25010 attribute

| Attribute | Typical path | Notes |
|---|---|---|
| **Functional suitability** | — | This is functional scope; write it as a use case. |
| **Performance efficiency** — throughput/latency targets | multiplier (mild) or derived (aggressive) | Mild targets = careful coding (multiplier). Aggressive targets = caching layer, read models, load-test harness (derived). Also raise T2. |
| **Compatibility** — interoperability | derived-scope | Each protocol/format is an adapter. Also an actor. |
| **Usability** — accessibility (WCAG) | derived-scope | Audit, remediation, manual testing, accessibility statement. Not free, not a multiplier. |
| **Usability** — general polish | multiplier | Raise T3/T7 rather than inventing scope. |
| **Reliability** — availability, fault tolerance, recoverability | derived-scope | Probes, failover, backup/restore, DR drill, runbook. |
| **Security** — authn/authz, audit, encryption | derived-scope | RBAC, immutable audit log, key management, pen-test remediation window. Also raise T11. |
| **Security** — general hardening posture | multiplier | Threat modelling and review overhead across all work. |
| **Maintainability** — modularity, testability | multiplier | Raise T9. Shows up as more test effort, which the role split already carries. |
| **Portability** — installability, adaptability | multiplier | Raise T8 (weight 2.0 — it bites). Add derived scope only if you must ship multiple deployment targets. |
| **Compliance** — GDPR, GMP, medical, financial | derived-scope | Almost always the largest derived block: validation protocols, traceability matrix, DPIA, retention/erasure, consent audit trail, evidence packs. |
| **Observability** (not in 25010, but always needed) | derived-scope | Logging, metrics, tracing, alerting, dashboards. |

## Compliance is where estimates die

Regulated work generates documentation and evidence scope that dwarfs the feature it
protects. The pattern to price:

- Validation protocol set (IQ/OQ/PQ or equivalent) — often 100–200 h alone
- Requirements traceability matrix maintained through delivery
- Change control and deviation handling procedures
- Data retention, erasure and audit-log immutability
- Evidence packs for an external auditor
- A remediation window after the external audit or pen test

Price the remediation window explicitly. It is the line clients delete and then blame
you for.

## Writing the NFR → component trace matrix

The architecture plan must carry this table. It is what makes derived scope defensible —
the client can see *why* the extra effort exists.

| NFR | Target | Components it forces | Sized as | Effort |
|---|---|---|---|---|
| NFR-01 availability | 99.5% in shift hours | health probes, backup + restore drill | derived | 40 h |
| NFR-02 security | RBAC + immutable audit | audit log with WORM, pen-test remediation | derived | 96 h |
| NFR-04 performance | save < 500 ms | (pervasive) | multiplier ×1.06 | — |

## Sources

- COSMIC, *Guideline for sizing Non-Functional Requirements* v1.0 (2020)
- IEEE/ISO/IEC 32430-2024, non-functional size measurement
- ISO/IEC 25010 product quality model
- Systematic review: *Use of Non-functional Requirements in Software Effort Estimation* (IEEE 8337929)
- *Quality Extended Use Case Point (QUCP)*, IJCSMC 2021
