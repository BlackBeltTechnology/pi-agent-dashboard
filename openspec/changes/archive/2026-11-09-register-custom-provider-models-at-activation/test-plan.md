# Test Plan — register-custom-provider-models-at-activation

Stage: design   Generated: 2026-11-09

No clarifications needed (hard gate passed: every slot is concrete in the spec delta / design D2–D3).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | cached provider registered without network | EP | L1 | automated | `providers.json` `proxy`; cache file for `proxy` (same baseUrl + fingerprint) listing `cc/a`,`cc/b`; fetch stub counting calls | `activate(pi)` then await `awaitStartupProviderModels` | `pi.registerProvider("proxy", {models:[cc/a,cc/b]…})` recorded **before** any fetch; fetch count for the startup phase = 0 |
| E2 | background discovery runs for cached providers too | state-transition | L1 | automated | as E1; stub `/v1/models` returns `cc/a`,`cc/c` | let background `registerEntry` settle | second `registerProvider("proxy")` with `cc/a`,`cc/c`; cache file now lists `cc/a`,`cc/c` |
| E3 | startup target parsing | decision table | L1 | automated | argv rows: `--model proxy/cc/x` · `--provider proxy --model cc/x` · `--model PROXY/cc/x` · `--model cc-x` (bare) · `--model anthropic/claude-x` · none; `proxy` custom, uncached | derive startup target | `proxy`, `proxy`, `proxy`, none, none (built-in), none — exactly one live discovery started only for the first three |
| E4 | cache usability | decision table | L1 | automated | cache entry variants: matching · baseUrl differs · `$ENV` key resolves to a different value · empty `models` | `activate` with argv `--model proxy/cc/x` | only "matching" registers from cache without a fetch; the other three trigger the startup live discovery |
| E5 | failed/empty discovery never writes | EP | L1 | automated | cache entry `[cc/a,cc/b]`; stub returns HTTP 500, then `{data:[]}` | background `registerEntry` for `proxy` | cache file byte-identical after each; registration still happens with `[]` ∪ native models (today's fallback) |
| E6 | cache-sourced registration never writes | EP | L1 | automated | cache entry `[cc/a]`, fetch stub never resolves | `registerEntry(…, cached)` | cache file mtime and content unchanged |
| E7 | forced refresh records to cache | state-transition | L1 | automated | cache `[cc/a]`; stub returns `cc/a`,`cc/b` | `reloadProviders(pi,{force:["proxy"]})` | cache file lists `cc/a`,`cc/b` |
| E8 | no credentials in cache | EP | L1 | automated | `providers.json` apiKey `sk-SECRET-123`, and `$PROXY_KEY` env variant | successful discovery writes cache | written file text contains neither `sk-SECRET-123` nor the env value; contains a 16-hex `keyFingerprint` |
| E9 | concurrent writers keep entries | state-transition | L1 | automated | two discovery results for `proxy` and `local` | both recorded "concurrently" (interleaved promises) | both `custom-provider-models/proxy.json` and `local.json` exist and parse; file mode `0600` |
| E10 | malformed cache tolerated | EP | L1 | automated | `proxy.json` containing `{not json` | `activate` | no throw; `proxy` treated as uncached (live discovery if it is the startup target, else background only) |
| E11 | bridge default export keeps sync body | state-transition | L1 | automated | `recordingPi()` as in `bridge-reentry-guard.test.ts` | call default export WITHOUT await | the same synchronous registrations as before are present immediately; returned value is a Promise (see packages/extension/src/__tests__/bridge-reentry-guard.test.ts) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | warm cache adds no latency | threshold | L1 | automated | 3 custom providers all cached, fetch stub delays 10 s | `awaitStartupProviderModels` resolves < 50 ms | single run, fake timers |
| P2 | uncached `--model` provider bounded | BVA | L1 | automated | `--model down/x`, `down` uncached, fetch stub never answers | resolves at 5000 ms ± timer tick (not before 4999, not after 5100 with fake timers) | single run |
| P3 | unrelated slow provider ignored | threshold | L1 | automated | no `--model`; `down` uncached and hanging | `awaitStartupProviderModels` resolves < 50 ms | single run |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | startup failure logged, not fatal | fault-injection (abort) | L1 | automated | `--model down/x`, stub rejects/aborts | await startup | promise resolves (never rejects); `console.error`/`warn` line contains `startup discovery for "down" failed`; auth pre-registration for `down` recorded |
| X2 | rejection cannot discard queued registrations | fault-injection | L1 | automated | `registerEntry` throws for one cached provider | await default-export promise | promise resolves; other cached providers' `registerProvider` calls still recorded |
| X3 | real pi resolves custom `--model` at cold start | fault-injection (delay) | L2 | automated | local HTTP stub serving `/v1/models` with `{data:[{id:"faux-1"}]}` after 1 s; `providers.json` (temp `HOME`) defines `stub`; empty cache dir | `pi -p --model stub/faux-1 "hi"` with the dashboard extension loaded | pi does NOT print `Model "stub/faux-1" not found` and does not exit 1 before contacting the stub; cache file for `stub` exists afterwards (see qa/tests/10-faux-model.sh) |
| X4 | real pi with unreachable uncached `--model` provider | fault-injection (abort) | L2 | automated | `providers.json` `dead` → closed port; empty cache | `pi -p --model dead/x "hi"` | exits within 15 s wall-clock with pi's `Model "dead/x" not found` (bounded, no hang) (see qa/tests/10-faux-model.sh) |
| M1 | end-to-end automation on proxy role | manual | — | manual-only | real `proxy` provider, `@coding` → `proxy/cc/claude-sonnet-5-5` | run `notes-to-issues` automation now | session registers, flow steps run (needs real external proxy — not automatable in CI) |

---

## Coverage summary

- Requirements covered: 1/1 modified requirement (all 11 scenarios of the delta mapped)
- Scenarios by class: edge 11 · perf 3 · error 5 (incl. 1 manual)
- Scenarios by level: L1 16 · L2 2 · manual-only 1

## New infra needed

- L2 X3/X4 need a tiny local HTTP stub for `/v1/models` inside the qa script (node one-liner); extend the `10-faux-model.sh` pattern rather than adding a harness.
