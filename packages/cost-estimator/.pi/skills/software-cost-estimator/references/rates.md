# Rate card

**This table is the default. Every project may override it.**

Override by copying `assets/rates.default.yaml` into the project, editing, and either
passing `--rates <file>` or setting `rates_file: ./rates.yaml` in the estimate input.
A project rate card always wins over this document.

## Default day rates

EUR, net, per productive 8-hour man-day. Anchored on the local offer corpus and on
2025/26 CEE market bands.

| Role | Junior | Mid | Senior |
|---|---:|---:|---:|
| Product Owner / BA | 280 | 400 | 520 |
| Architect | — | 520 | 680 |
| UX / UI Designer | 260 | 380 | 480 |
| Frontend Developer | 260 | 400 | 520 |
| Backend Developer | 280 | 420 | 560 |
| Data / Integration Engineer | — | 460 | 600 |
| QA / Test Automation | 240 | 340 | 440 |
| DevOps / SRE | — | 460 | 600 |
| Security Engineer | — | — | 700 |
| Tech Lead | — | — | 640 |
| Project Manager | — | 400 | 520 |
| **Blended (single-rate quoting)** | | | **480** |

## Where these come from

| Anchor | Value | Source |
|---|---:|---|
| Enterprise / international blended | 600 EUR/day | Completed WMS offer, explicit blended-rate assumption |
| SME / Hungary | 423 EUR/day | Quality-platform offer, explicit day rate |
| CEE senior market band 2025/26 | 30–70 EUR/h ≈ 240–560 EUR/day | Published nearshore rate surveys |
| Western Europe senior | 75–120 EUR/h | Published European remote-developer rate surveys |
| HUF/EUR reference | ~350–400 | Used in local offers |

The default column sits deliberately between the SME anchor and the enterprise anchor.
Move it, do not average it — an enterprise client and an SME are different rate cards,
not different points on one.

## Choosing the right card

| Situation | Do this |
|---|---|
| Fixed-price offer to an SME | Use the SME anchor (~420–480 blended). Fund to P85, quote the point. |
| Enterprise / regulated / international | Use 600+. Compliance and governance overhead is real and billable. |
| Time & materials | Quote per-role rates, not a blend, so scope changes reprice honestly. |
| Internal cost model | Replace day rates with fully-loaded internal cost (salary × ~1.3–1.5), not market price. |
| Subcontracted work | Add the margin explicitly as a line, do not bury it in the rate. |

## Total cost of ownership, not just the rate

A low day rate is not a low cost. Published nearshore analyses put the realistic
multiplier at **1.3–1.5×** the headline rate once ramp-up, coordination overhead,
management, quality variance and rework are counted. When comparing vendor proposals,
compare landed cost per delivered unit of scope, not the rate card.

## Non-labour cost lines to add

The engine prices labour plus AI cost. These are yours to add:

- Third-party licences (per seat, per environment, per year)
- Cloud/hosting for dev, test, staging and production
- Data migration tooling
- External penetration test or audit
- Travel and on-site support
- Hardware
- Post-launch support retainer or SLA

A completed WMS offer, for reference, carried travel (8,000 EUR), third-party licences
(5,000 EUR) and dev/test infrastructure (3,000 EUR) as separate lines on top of a
364,600 EUR project — roughly 4.4% of total, and all of it forgettable.

## Presenting rates to a client

- Show the **blended** rate for a fixed-price offer; show **per-role** for T&M.
- Show effort in **man-days**, cost in the client's currency, and the assumed
  hours-per-day. A "day" that means 6 productive hours to them and 8 to you is a dispute.
- State VAT treatment. Local offers quote net, + 27% VAT.
- State the exchange rate and its date if the contract currency differs from your cost
  currency.
- State the offer validity period. 30 days is the local convention.
