# D0 CodeQL probe (test-plan #E16)

Test: `scripts/__tests__/codeql-local-real.test.mjs` → `#E16 the shipped admission shapes are recognised; every unguarded twin is reported`.
Real analysis, packs cached, model file = repo `.github/codeql/extensions/cwd-guard.model.yml`.

Versions: CodeQL CLI 2.27.2 · `codeql/javascript-queries` 2.4.7 · `codeql/actions-queries` 0.6.37 · models sha256 `d93b86d7…ea43`.

Fixture: mini-monorepo, fixture `admitCwd` returns an opaque token carrying its argument; `admitRouteCwd` is a wrapper in a lib module; every sink is a separate function in `lib/sinks.ts`.

| Shape | Sink | `js/path-injection` | Expected |
|---|---|---|---|
| (a) route: `adm.kind!=="admit" \|\| !admissionAllows(adm,cwd)` → return, sink on raw `cwd` | `rawGuarded` | 0 | 0 |
| (a) twin: raw `cwd` straight to lib, no guard | `rawTwin` | ≥1 | ≥1 |
| (a) sink on `adm.token.canonCwd` | `canonGuarded` | 0 | 0 |
| (b) `admissionAllows` + `isPortableProjectName(change)` → `path.join(cwd,"openspec","changes",change,…)` in lib | `tasksGuarded` | 0 | 0 |
| (b) twin: cwd guarded, `change` unguarded | `tasksTwin` | ≥1 | ≥1 |
| (c) helper `validateCwd` returns `{ok, cwd: token.canonCwd}`; sink in caller | `helperGuarded` | 0 | 0 |
| (c) twin: caller without helper | `helperTwin` | ≥1 | ≥1 |
| (c') helper returns the guarded RAW value (openspec sites) | `admittedRawHelper` | 0 | 0 |

Verdict: PASS — all guarded shapes silent, every twin reported. The D0 named fallback is NOT needed; groups 2–3 use the helper shape (c) and raw-return shape (c').
