## Why

Any pi started with `--model <custom-provider>/<id>` (a provider defined in
`~/.pi/agent/providers.json`, e.g. `proxy/cc/claude-sonnet-5-5`) exits with
code 1 — `Model "proxy/…" not found` — before its bridge ever registers. Keeper
logs show **no** custom-provider `--model` start has ever succeeded (automation
runs, resumed sessions, `local/…` spawns: all exit 1 in 2–6 s). Since
`add-spawn-model-choice` every spawn road passes the resolved model as
`--model`, so a role or default pointing at a custom provider now breaks
automations, plugin spawns and resume. Today the `notes-to-issues` automation
cannot run at all because `@coding` resolves to `proxy/…`.

pi supports this already: it awaits each extension factory and applies its
`registerProvider` calls before resolving `--model` (verified with a probe
extension that registers `proxy` models inside its factory — `--model
proxy/cc/claude-sonnet-5-5` then runs). The bridge instead registers only the
provider's auth synchronously and fetches the model list fire-and-forget, so
the provider has zero models when pi resolves `--model`.

## What Changes

- The bridge registers every custom provider **with its models** before its
  activation returns to pi, so a custom-provider `--model` resolves at startup.
- Model list at activation comes from a **per-provider cache of the last
  successful discovery**, written by the bridge after each successful
  `/v1/models` discovery. A provider with no cache entry is discovered live
  during activation, all providers in parallel, bounded by a short timeout.
- The existing background discovery, re-sync and explicit refresh paths are
  unchanged and keep the registered list (and the cache) fresh.
- A provider whose discovery fails or times out with no cache still has its
  auth registered (today's behaviour) and activation never fails because of it.
- No server-side spawn change: `--model` keeps being passed as today.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `custom-provider-model-registry`: the "pi sessions SHALL continue to receive
  custom providers via the bridge extension" requirement gains a startup
  guarantee — custom-provider models are registered before pi resolves its
  startup model, sourced from a discovery cache or bounded live discovery.

## Impact

- `packages/extension/src/provider-register.ts` (activation becomes awaitable;
  cache read/write), `packages/extension/src/bridge.ts` (default export awaits
  provider activation).
- New cache file under `~/.pi/dashboard/` (non-secret: provider name, baseUrl
  fingerprint, model ids + advertised metadata; no API keys).
- pi startup latency: none with a warm cache; at most the activation timeout
  on a cold cache for an unreachable provider.
- Unblocks the follow-up change `fail-automation-run-on-spawn-failure` (fast
  failure for any other pre-register crash).

## Discipline Skills

- `security-hardening` — the discovery cache stores a one-way key fingerprint
  and must contain no API key, token or header value (test-plan E8); `/v1/models`
  is fetched with a user-configured URL + credential.
- `performance-optimization` — startup latency is a hard budget: a warm cache
  adds none, an uncached `--model` provider is bounded at 5 s, and an unrelated
  slow provider must not delay activation (test-plan P1–P3).
