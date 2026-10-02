# Test Plan — add-pi-runtime-image-generation

Stage: design   Generated: 2026-10-02

All L1 rows use vitest under `packages/nano-banana/src/__tests__/`. They use an injected `createPiRuntime` fake (no real pi import, no credentials, no network) and an injected pi loader for guard rows, so no row can make a billed call.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | pi-backend: opt-in selection | decision-table | L1 | automated | no `backend`; `GEMINI_API_KEY` via `env`; spy loader + fake runner | `generateImage` | runner called once; result `backend:"gemini"`; loader call count 0 |
| E2 | pi-backend: no fallback | decision-table | L1 | automated | no `backend`; `env: {}`; spy loader | `generateImage` | `ok:false`, error contains `GEMINI_API_KEY` and `--backend pi`; loader call count 0 |
| E3 | pi-backend: env does not switch library | EP | L1 | automated | `process.env.NANO_BANANA_BACKEND="pi"` (restored after); Gemini key via `env`; spy loader | `generateImage` | runner called; loader call count 0 |
| E4 | pi-backend: invalid backend | EP | L1 | automated | `backend:"openai"`, `output: <tmp>/new-dir/a.png` | `generateImage` | `ok:false` naming `gemini` and `pi`; `<tmp>/new-dir` absent; runner + loader not called |
| E5 | pi-backend: runtime generation request | EP | L1 | automated | `backend:"pi"`, prompt `"a red fox"`, fake runtime returning one PNG block | `generateImage` | `generateImages` args: input `[{type:"text",text:"a red fox"}]`, options `maxRetries:0` and an `AbortSignal` |
| E6 | pi-backend: create options | EP | L1 | automated | `backend:"pi"`; fake `ModelRuntime.create` capturing options | `generateImage` | options include `modelsPath:null`, `refreshOnCreate:false` |
| E7 | pi-backend: one runtime per batch | state-transition | L1 | automated | 5 jobs, no existing outputs, `backend:"pi"`, counting factory | `batchGenerate` | factory call count 1; 5 results `ok:true` |
| E8 | pi-backend: fully skipped batch | state-transition | L1 | automated | 3 jobs, all outputs pre-created, `backend:"pi"`, counting factory + spy loader | `batchGenerate` | 3 results `skipped:true` without `backend`; factory and loader call count 0 |
| E9 | pi-backend: edit input | EP | L1 | automated | `file: <tmp>/in.PNG` (bytes `89504E47…`), `backend:"pi"` | `generateImage` | `input[0]` = `{type:"image", mimeType:"image/png", data:<base64 of file>}`; `input[1]` = prompt text |
| E10 | pi-backend: unsupported input | EP | L1 | automated | `file: <tmp>/in.heic` | `generateImage` (pi) | `ok:false` naming `.heic`; `generateImages` not called |
| E11 | pi-backend: default model | EP | L1 | automated | no `model`, no `flash` | `generateImage` (pi) | model `openrouter/google/gemini-2.5-flash-image` used and reported |
| E12 | pi-backend: flash default | EP | L1 | automated | `flash:true`, no `model` | `generateImage` (pi) | model `google/gemini-3.1-flash-lite-image` |
| E13 | pi-backend: bare id | EP | L1 | automated | `model:"gemini-3-pro-image"` | `generateImage` (pi) | `getModelOfType("image","openrouter","google/gemini-3-pro-image")` called; that model used |
| E14 | pi-backend: model beats flash | decision-table | L1 | automated | `model:"gemini-3-pro-image"`, `flash:true` | `generateImage` (pi) | model `google/gemini-3-pro-image` |
| E15 | pi-backend: Gemini-CLI-only id | EP | L1 | automated | `model:"gemini-2.0-flash"`; fake catalogue with google + flux ids | `generateImage` (pi) | `ok:false`; error lists `google/gemini-2.5-flash-image`, no `black-forest-labs/` id |
| E16 | pi-backend: mistyped slash id | EP | L1 | automated | `model:"black-forest-labs/flux.2-pr"` | `generateImage` (pi) | `ok:false`; error lists `black-forest-labs/flux.2-pro` |
| E17 | pi-backend: empty id list | EP | L1 | automated | `model:"x"`; fake catalogue with no `google/` ids | `generateImage` (pi) | `ok:false`; error says installed pi has no matching image models |
| E18 | pi-backend: two images | EP | L1 | automated | response with 2 PNG blocks; `output: <tmp>/out/a.png` | `generateImage` (pi) | files `out/a.png`, `out/a-2.png` exist; `outputs` lists both with `mimeType` |
| E19 | pi-backend: extra name taken | BVA | L1 | automated | 2 PNG blocks; `<tmp>/out/a-2.png` pre-exists with bytes `OLD` | `generateImage` (pi) | second image at `out/a-3.png`; `out/a-2.png` content still `OLD` |
| E20 | pi-backend: concurrent unnamed outputs | state-convergence | L1 | automated | two pi generations, no `output`, cwd `<tmp>`, frozen clock (same ms) | `Promise.all` of both | 2 distinct `nano-banana-*.png` files in `<tmp>`; neither empty |
| E21 | pi-backend: usage surfaced | EP | L1 | automated | response `usage.cost.total = 0.039` | `generateImage` (pi) | result `usage.cost.total === 0.039` |
| E22 | pi-backend: older pi | BVA | L1 | automated | injected loader returns `{ VERSION:"0.86.1", ModelRuntime:{ create: spy } }` | `generateImage` (pi) | `ok:false` naming `0.86.1` and `1.0.0`; `create` not called |
| E23 | pi-backend: prerelease floor | BVA | L1 | automated | loader `VERSION:"1.0.0-rc.1"` | `generateImage` (pi) | `ok:false` naming `1.0.0-rc.1` |
| E24 | pi-backend: floor accepted | BVA | L1 | automated | loader `VERSION:"1.0.0"` and `"1.0.1"` with working fake runtime | `generateImage` (pi) | `ok:true` for both |
| E25 | client: Gemini results carry backend | EP | L1 | automated | fake runner success; fake runner exit 1 with stderr `boom` | `generateImage` | both results `backend:"gemini"`; failure error `boom` |
| E26 | client: batch result shape | EP | L1 | automated | Gemini batch of 2 jobs, one pre-existing output | `batchGenerate` | skipped result has no `backend`; generated result `backend:"gemini"` |
| E27 | cli: parse `--backend` | EP | L1 | automated | argv `["a fox","--backend","pi"]` | exported CLI arg parser | parsed `backend:"pi"`, prompt `"a fox"` |
| E28 | cli: invalid / missing backend value | EP | L1 | automated | argv `["a fox","--backend","openai"]`; argv `["a fox","--backend"]` | run bin as subprocess | exit code 1; stderr contains the usage line with `[--backend gemini\|pi]` |
| E29 | cli: backend from env | EP | L1 | automated | no flag; `NANO_BANANA_BACKEND=" PI "` | exported CLI backend resolver | resolves `"pi"` |
| E30 | cli: invalid env backend | EP | L1 | automated | no flag; `NANO_BANANA_BACKEND="openai"`; prompt `"x"` | run bin as subprocess | exit 1; stderr `✗ NANO_BANANA_BACKEND must be gemini or pi`; no generation attempted (no `npx`) |
| E31 | cli: pi success line | EP | L1 | automated | result `{ok:true, backend:"pi", output:"a.png", model:"openrouter/google/gemini-2.5-flash-image", usage:{cost:{total:0.000412}}}`; same without `usage` | exported CLI result formatter | `✓ image generated: a.png (pi · openrouter/google/gemini-2.5-flash-image) · ~$0.00041 est.`; without usage the line ends after `)` |
| E32 | cli: pi failure line | EP | L1 | automated | result `{ok:false, backend:"pi", error:"insufficient credits"}` | exported CLI result formatter | `✗ generation failed (pi): insufficient credits` |
| E33 | cli: missing prompt usage | EP | L1 | automated | argv `[]` | run bin as subprocess | exit 1; stderr exactly the new usage line |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | pi-backend: import fails | fault-injection (abort) | L1 | automated | injected loader rejects `Cannot find module` | `generateImage` (pi) | resolves `ok:false` naming `@earendil-works/pi-coding-agent` and `>= 1.0.0` |
| X2 | pi-backend: create rejects | fault-injection (abort) | L1 | automated | fake `create` rejects `auth.json unreadable` | `generateImage` (pi) | resolves `ok:false` containing `auth.json unreadable` |
| X3 | pi-backend: runtime lacks methods | fault-injection | L1 | automated | `create` resolves `{}` | `generateImage` (pi) | resolves `ok:false` naming the package and `1.0.0` |
| X4 | pi-backend: provider error | fault-injection (abort) | L1 | automated | fake returns `stopReason:"error"`, `errorMessage:"insufficient credits"` | `generateImage` (pi) | `ok:false`, error `insufficient credits` |
| X5 | pi-backend: not signed in | fault-injection | L1 | automated | fake returns `stopReason:"error"`, `errorMessage:"Provider is not configured: openrouter"` | `generateImage` (pi) | error contains the message, `/login openrouter`, `OPENROUTER_API_KEY` |
| X6 | pi-backend: timeout | fault-injection (delay) | L1 | automated | fake waits for the signal, then returns `stopReason:"aborted"`, no `errorMessage`; `timeoutMs: 50` | `generateImage` (pi) | `ok:false`, error `timed out after 50 ms`; resolves in < 1000 ms |
| X7 | pi-backend: late provider error | fault-injection (delay) | L1 | automated | `timeoutMs: 50`; fake waits for abort, then returns `stopReason:"aborted"`, `errorMessage:"HTTP 500"` | `generateImage` (pi) | error `timed out after 50 ms: HTTP 500` |
| X8 | pi-backend: missing edit file | fault-injection | L1 | automated | `file: "/nope/in.png"` | `generateImage` (pi) | resolves `ok:false` naming `/nope/in.png`; `generateImages` not called |
| X9 | pi-backend: unwritable output | fault-injection | L1 | automated | `output: <tmp>/ro/a.png`, where `<tmp>/ro` is a file (`ENOTDIR`) | `generateImage` (pi) | resolves `ok:false` naming the path |
| X10 | pi-backend: text-only response | fault-injection | L1 | automated | fake output `[{type:"text",text:"cannot draw that"}]` | `generateImage` (pi) | `ok:false` containing `cannot draw that`; no file in `<tmp>` |
| X11 | pi-backend: empty response | fault-injection | L1 | automated | fake output `[]`, `stopReason:"stop"` | `generateImage` (pi) | `ok:false`, error `no image returned` |
| X12 | pi-backend: one job fails | fault-injection | L1 | automated | 3 jobs; fake errors on job 2 only | `batchGenerate` (pi) | resolves 3 results, exactly one `ok:false` |
| X13 | pi-backend: guard failure in batch | fault-injection | L1 | automated | 3 jobs, one pre-existing output; loader rejects | `batchGenerate` (pi) | 1 `skipped:true` + 2 `ok:false` naming the package |
| X14 | live OpenRouter generation + edit + CLI exit | manual | — | manual-only | real `/login openrouter`, no `GEMINI_API_KEY`, pi 1.0.0 resolvable | `pi-nano-banana "a red fox in the snow, watercolor" -o /tmp/fox.png --backend pi`, then `--file /tmp/fox.png "make it night" -o /tmp/fox-night.png --backend pi` | [judgment: both images open and look right; output names the model with `~$… est.`; the process returns to the prompt — billed call, needs a real account] |

---

## Coverage summary

- Requirements covered: 14/14:
  - `nano-banana-pi-backend`: 7
  - `nano-banana-image-generation-client`: 4 modified
  - `nano-banana-cli-entrypoint`: 4 modified, with "Dispatch to Generation" covered via E27/E29 and the existing dispatch path
- Scenarios by class: edge 33 · perf 0 · frontend 0 · error 14
- Scenarios by level: L1 46 · L2 0 · L3 0 · manual 1
- Scenarios by disposition: automated 46 · manual-only 1

## New infra needed

- The CLI module must export its parser, backend resolver and result formatter, and run `main()` only when executed directly. This lets E27/E29/E31/E32 test in-process; E28/E30/E33 spawn the bin, as `packages/deck3d/src/__tests__/cli.test.ts` does.
- `generateImage`/`batchGenerate` gain test seams: `createPiRuntime` (runtime factory) and `loadPi` (module loader). This mirrors the existing `runner` seam.
