# Spikes: add-team-skill-access

Run on pi 1.0.0, 2026-10-08. Reproduce (needs a working default model; the request is captured and the process exits before HTTP):

```bash
mkdir -p /tmp/skill-spike/{granted,leaked}   # each with a SKILL.md: name + description containing SPIKE_GRANTED_DESC / SPIKE_LEAKED_DESC
SPIKE_TAG=filtered SPIKE_FILTER=1 pi -p --no-session --no-skills --skill /tmp/skill-spike/granted \
  -e spikes/leaker.ts -e spikes/filter.ts "hello"
grep -c SPIKE_LEAKED_DESC /tmp/skill-spike/payload-filtered.json   # 0 with filter, 1 without
```

- `leaker.ts`: adds a skill through `resources_discover`. `--no-skills` does not stop it.
- `filter.ts`:
  - `before_agent_start` splices `systemPromptOptions.skills` in place, keeping only skills under the allowed roots.
  - `input` refuses `/skill:<other>`.
  - `before_provider_request` dumps the payload and exits.

Results: design.md D10 (1.1), D12 (1.2), D11 (1.3).
