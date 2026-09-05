## 1. Census

- [ ] 1.1 Sweep `packages/server/src/**/__tests__` for one-shot reads of real-process outcomes (spawn → wait fixed/implicit → assert state) and wall-clock budget assertions; list every member with its mechanism
- [ ] 1.2 Repeat for `packages/*/src/**/__tests__` (client waitFor-budget sites where the awaited chain is process-backed)

## 2. Fix members (one commit per member, poll-or-budget rule)

- [ ] 2.1 `cli-signal-forwarding`: bounded poll for the exitIntent record instead of a fixed propagation window
- [ ] 2.2 `auth-redirect-base` P1: measure isolated baseline; set a fork-count-scaled budget with documented headroom
- [ ] 2.3 `FileLink.split`: make the resolve chain deterministic in-test or raise the effective budget with justification
- [ ] 2.4 Remaining census members

## 3. Verification

- [ ] 3.1 The `parallel-test-execution` 3-consecutive-run soak passes on a loaded developer machine (re-run of the environment-limited P2 from `make-test-suite-deterministic`)
- [ ] 3.2 `openspec validate --changes contention-harden-real-process-tests`

## 4. Documentation

- [ ] 4.1 FAQ: extend the "npm test red locally" entry with the real-process test class and the poll-or-budget rule
