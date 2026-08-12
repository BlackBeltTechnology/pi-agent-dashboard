## 1. Reproduce and lock the failure in a test

- [ ] 1.1 Write a failing test for `ConnectionManager`: given an established connection that has registered, re-targeting to an endpoint whose opens always fail must not leave the manager permanently attached to that endpoint
- [ ] 1.2 Write a failing test for the discovery consumer: a candidate whose `GET /api/health` does not return `{ ok: true }` must not displace an established connection
- [ ] 1.3 Write a failing test for localhost preference on migration: a remote candidate must not displace an established localhost connection
- [ ] 1.4 Add a fixture that emulates the poisoned advertisement (loopback-bound server advertising a non-loopback `*.local` host) so the scenarios exercise the real shape
- [ ] 1.5 Confirm 1.1–1.3 fail against current `main` for the stated reason (not an unrelated error)

## 2. Admission gate on migration (D1, D3)

- [ ] 2.1 Add `lastRegisteredUrl` tracking to `ConnectionManager`, set when a `session_register` is acknowledged
- [ ] 2.2 Introduce an explicit re-target entry point on `ConnectionManager` so endpoint changes stop being an ambient mutation of `url`
- [ ] 2.3 Gate that entry point: when a connection is established and registered, require a successful `GET /api/health` on the candidate before switching
- [ ] 2.4 Enforce localhost preference at the gate — classify by resolved address (loopback vs not), treating the hostname as a hint only
- [ ] 2.5 Make 1.2 and 1.3 pass

## 3. Reversible migration (D2)

- [ ] 3.1 Count consecutive failed opens against a newly adopted endpoint
- [ ] 3.2 On exceeding the bound, re-target `lastRegisteredUrl` and reset backoff
- [ ] 3.3 Add a cooldown so a rejected endpoint cannot be re-adopted immediately, preventing ping-pong
- [ ] 3.4 Choose the attempt bound and cooldown from observed server-restart timings; record the basis in `design.md` (replaces the open question)
- [ ] 3.5 Make 1.1 pass

## 4. Honest advertisement (D4)

- [ ] 4.1 Determine the server's actual bind address at advertise time
- [ ] 4.2 When bound only to loopback, advertise a loopback-resolvable address or skip advertising entirely
- [ ] 4.3 Add a test that a loopback-bound server never publishes a record whose host resolves off-loopback
- [ ] 4.4 Verify a stale loopback-bound instance can no longer be adopted by a bridge

## 5. Observability (D5)

- [ ] 5.1 Emit a server-visible record on every bridge re-target, naming previous endpoint, new endpoint, and trigger
- [ ] 5.2 Emit a server-visible record when the admission gate rejects a candidate, with the failure reason
- [ ] 5.3 Confirm both are visible with `keeperLog.capturePiOutput=false`
- [ ] 5.4 Add a test asserting a re-target cannot occur without a corresponding record

## 6. End-to-end verification

- [ ] 6.1 Stand up a poisoned-discovery environment (second dashboard bound to loopback, advertising a `*.local` host) per the isolated-verification procedure — never against the live instance
- [ ] 6.2 Spawn a session in a cwd outside the server's repo and assert the bridge stays on the working endpoint
- [ ] 6.3 Assert `POST /api/session/:id/prompt` returns success AND the prompt appears in the session transcript (transmission is not delivery)
- [ ] 6.4 Assert a legitimate migration still works: move the real server to a new port and confirm the bridge follows it
- [ ] 6.5 Re-run the seven-arm cwd matrix from the proposal and confirm every arm now keeps its bridge
- [ ] 6.6 Remove all temporary probes and confirm `git status` shows no stray edits under `packages/`

## 7. Follow-up

- [ ] 7.1 File the unexplained cwd asymmetry (server's own repo immune) as its own investigation if it survives this fix
- [ ] 7.2 Confirm whether the same guard is needed anywhere else a discovered endpoint replaces a working one
