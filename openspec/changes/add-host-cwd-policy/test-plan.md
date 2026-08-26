# Test Plan — add-host-cwd-policy

Stage: design   Generated: 2026-08-26

All spec scenarios resolve concrete Triples — no unfillable slots, no
clarifications needed. `mergeCwdPolicy` and the registry are pure/in-process
(L1); the headline "applied to a generic non-plugin spawn" acceptance is proven
end-to-end at L3.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Register then resolve | EP | L1 | automated | `registerCwdPolicy("/w/secrets",{noTools:true})` | `resolveCwdPolicy("/w/secrets")` | composed policy carries `noTools:true` |
| E2 | Symlink alias keys same entry | EP | L1 | automated | register via `/alias/secrets`→`/real/secrets` (tmp symlink) | resolve for spawn in `/real/secrets` | policy applies (canonical keying) |
| E3 | Not-yet-created dir under symlinked ancestor | EP | L1 | automated | `/work-link`→`/real/work`; register `/work-link/new` before it exists; create + spawn | resolve for `/work-link/new` | policy applies (longest-existing-ancestor canonicalization) |
| E4 | Symlink swap does not fail open | state-transition | L1 | automated | register `/projects/target`; later replace with symlink elsewhere | resolve for spawn under `/projects/target` | policy STILL applies (lexical-form match; floor over-applies not disappears) |
| E5 | Untrusted plugin cannot register | decision-table | L1 | automated | untrusted plugin (priority above gate) calls `ctx.registerCwdPolicy` | later spawn in that cwd | nothing registered; spawn unaffected |
| E6 | Plugin extension fields rejected | fault (fail-closed) | L1 | automated | `registerCwdPolicy("/w/secrets",{noTools:true,extensions:["/evil.js"]})` | register call | observable error, registers NOTHING; spawn gains neither `--no-tools` nor `-e /evil.js` |
| E7 | Overly-broad target rejected | BVA (boundary) | L1 | automated | `registerCwdPolicy("/",...)` or `registerCwdPolicy("<home>",...)` | register call | rejected, registers nothing |
| E8 | Registered policy immutable | fault | L1 | automated | register `{tools:["read"]}`, then push `"exec"` onto the passed array | `resolveCwdPolicy` | still `tools:["read"]` — mutation does not reach spawn |
| E9 | Unregister owner-scoped | decision-table | L1 | automated | A reg `{noTools:true}` + B reg `{noBuiltinTools:true}` for `/w/secrets`; B unregisters | `resolveCwdPolicy("/w/secrets")` | still `noTools:true` from A's surviving entry |
| E10 | Unregister unregistered = no-op | BVA | L1 | automated | plugin unregisters `/never/registered` with nothing of its own there | unregister call | returns without throw; registry unchanged |
| E11 | Plugin unload drops its policies | state-transition | L1 | automated | trusted plugin registers `{noTools:true}` for `/w/secrets`, then unloads | later generic spawn in `/w/secrets` | argv does NOT carry `--no-tools` from departed plugin |
| E12 | Funnel merges policy into argv | EP | L1 | automated | registry (test-injected) has `{noTools:true}` for cwd; `spawnPiSession(cwd,{})` argv assembly | funnel resolve+merge before argv | assembled argv contains `--no-tools` |
| E13 | No matching policy byte-identical | regression | L1 | automated | spawn cwd with no registered policy | funnel argv+env assembly | byte-identical to pre-change `spawnPiSession` output for that mechanism |
| E14 | Policy tools allowlist reaches argv | EP | L1 | automated | policy `{tools:["read","grep"]}` for cwd, no caller scope | funnel→argv | `--tools read,grep` |
| E15 | Allowlist intersection tightens | EP | L1 | automated | caller `tools:["read","grep","write"]` + policy `tools:["read","grep"]` | `mergeCwdPolicy` | merged `--tools read,grep`, no `write` |
| E16 | Caller cannot widen host ban | decision-table | L1 | automated | policy `noTools:true` + caller `noTools:false`,`tools:["read"]` | `mergeCwdPolicy` | merged carries `noTools:true` — caller cannot clear ban |
| E17 | Denylist union | EP | L1 | automated | caller `excludeTools:["write"]` + policy `excludeTools:["exec"]` | `mergeCwdPolicy` | merged `--exclude-tools` has both `write` and `exec` |
| E18 | Sticky-true booleans | decision-table | L1 | automated | either side sets `noBuiltinTools:true` | `mergeCwdPolicy` | merged `noBuiltinTools:true` |
| E19 | Policy allowlist applies when caller omits tools | BVA (omitted side) | L1 | automated | policy `tools:["read"]` + caller options omit `tools` | `mergeCwdPolicy` | merged `--tools read` (NOT "caller unrestricted") |
| E20 | Composition order-independent (3+ ancestors) | property | L1 | automated | `{noTools:true}`,`{excludeTools:["a"]}`,`{excludeTools:["b"]}` composed in any order | `mergeCwdPolicy` | identical result: `noTools:true`, `excludeTools ⊇ {a,b}` |
| E21 | Empty policy is identity | regression | L1 | automated | `mergeCwdPolicy({}, options)` | merge | returns `options` unchanged |
| E22 | Broad ban survives narrow looser reg | decision-table | L1 | automated | `/work`={noTools:true}, `/work/secrets`={tools:["read"]}, spawn `/work/secrets/deep` | `resolveCwdPolicy` | merged carries `noTools:true` — narrower does NOT re-enable tools |
| E23 | Same-path second reg composes not replaces | state-transition | L1 | automated | reg `{excludeTools:["exec"]}` then `{excludeTools:["write"]}` for `/w/secrets` | `resolveCwdPolicy` | excludes BOTH `exec` and `write` |
| E24 | Sibling prefix no false-match | BVA (boundary) | L1 | automated | `/work` registered; spawn lands in `/work-shop/app` | `resolveCwdPolicy` | `/work` policy NOT applied |
| E25 | No plugin path produces extension-bearing policy | property | L1 | automated | only plugin-facing registrations exist | resolve any | no resolved policy carries `extensions`/`extensionConfig`; no `-e`/`PI_EXT_*` from host policy |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Policy applied to a GENERIC (non-plugin) spawn | state-convergence | L3 | automated | a cwd policy `{noTools:true}` registered for a workspace dir; a generic user-initiated (non-plugin) session spawned there against the docker harness | session boots | the spawned session is constrained (no model-facing tools) yet still loads the bridge + REGISTERS — session card converges into the dashboard list; constraint applied with no plugin originating the spawn |

---

## Coverage summary

- Requirements covered: 8/8
- Scenarios by class: edge 25 · perf 0 · frontend 1 · error 0 (fail-closed reject cases folded into edge E6/E7)
- Scenarios by level: L1 25 · L2 0 · L3 1
- Scenarios by disposition: automated 26 · manual-only 0

## New infra needed

- none — L1 rows add `packages/server/src/spawn-process/__tests__/cwd-policy.test.ts`
  (+ funnel assertions extending `process-manager` tests); E2–E4/E11 use tmp-dir
  symlinks in-process; F1 extends the existing docker e2e harness.
