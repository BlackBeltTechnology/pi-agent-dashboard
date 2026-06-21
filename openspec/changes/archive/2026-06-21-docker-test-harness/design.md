## Context

Manual browser testing of pi-dashboard on the developer's host fights the live dashboard. The collisions are not bugs — they are correct behaviors of a single-user, single-home, LAN-discoverable product. The fix is isolation, not code change. A container gives each instance its own `$HOME`, network namespace, port space, and filesystem; the only host-level surface that needs an explicit knob is mDNS, which already has `PI_DASHBOARD_NO_MDNS=1`.

This harness layers on the `docker-packaging` base image. It is deliberately thin: a compose overlay, two scripts, an entrypoint wrapper, fixtures, and a runbook.

## Goals / Non-Goals

**Goals:**
- One-command spin-up of a dashboard that provably cannot collide with the host dashboard (home-lock, mDNS, ports, `~/.pi` state).
- Test exactly what ships: the baked, built dashboard image (clean-install QA), not a live-edited working tree.
- Path-identical workspace mounting so logs/paths match the host.
- Host files provably untouched (read-write onto a throwaway overlay).
- Fail-fast smoke (health + WS) before a human opens a browser.
- Baked git + jj fixtures for VCS-panel testing without mounting anything.

**Non-Goals:**
- Live-reload / bind-mounted dashboard source (that is docker-packaging's `compose.dev.yml`).
- Replacing the `qa/` Packer/VMware suite — that stays for cross-platform release-gate QA; this complements it for the fast daily loop.
- Multi-arch / Windows-container testing.
- Server code changes — none are required.

## Decisions

### Decision 1: Layer as a compose overlay, not a new image
`compose.test.yml` overlays `compose.yml`. No second Dockerfile, no second build. The test profile is pure config + entrypoint wrapping. Keeps the "test exactly what ships" guarantee — the bytes under test are docker-packaging's image, unchanged.

### Decision 2: Isolation is structural; only mDNS needs a flag
| Vector | Mechanism | Code change |
|---|---|---|
| home-lock | isolated `$HOME=/home/pi` → separate `~/.pi/dashboard` inode | none |
| `~/.pi` state | `pi-state` → tmpfs, wiped each run | none |
| ports | `-p 18000:8000 -p 18999:9999` | none |
| mDNS advertise/browse | `PI_DASHBOARD_NO_MDNS=1` (exists, `server.ts:1244`) | none |
| LAN multicast leak | default bridge network (NAT, no multicast) | none |
| external pi sessions | `PI_GATEWAY_BIND=127.0.0.1` | none |

### Decision 3: Path-parity mount onto a read-write throwaway overlay
Mount `${HOST_CWD}:${HOST_CWD}` and set `working_dir=${HOST_CWD}` so paths read identically to the host. Make it writable without touching host files via an in-container overlayfs:

```
host ${HOST_CWD}  ──(bind, ro)──▶  /mnt/test-lower      (lowerdir)
tmpfs                              /mnt/test-upper      (upperdir)
tmpfs                              /mnt/test-work       (workdir)
        mount -t overlay overlay -o lower,upper,work  ${HOST_CWD}
container sees ${HOST_CWD} writable; reads fall through to host (ro);
writes land in tmpfs upper; teardown discards upper → host pristine.
```

**Why overlay over copy:** no upfront copy → instant spin-up even when the project contains a large `node_modules`; only written bytes consume RAM.

**Cost:** the entrypoint's `mount -t overlay` needs `CAP_SYS_ADMIN` (`cap_add: [SYS_ADMIN]` in the test overlay). Acceptable for a local test harness.

**Fallback:** `TEST_COPY_MODE=1` switches to `cp -a /mnt/test-lower/. ${HOST_CWD}` on a tmpfs mount — zero extra capabilities, for locked-down CI. Slower and RAM-heavy for big trees; off by default.

### Decision 4: Fail-fast smoke before "ready"
The test entrypoint runs a minimal check — HTTP `GET /api/health` returns 200 and a single WebSocket connect succeeds — and exits non-zero if either fails, before declaring the instance ready. This catches a broken image/build immediately instead of after a human opens a browser. Scope is intentionally tiny (two probes); deep launch-state assertions stay in `server-launch-smoke-suite` to avoid overlap.

### Decision 5: Baked fixtures AND optional path-parity mount
`docker/fixtures/sample-git` and `docker/fixtures/sample-jj` are baked into the image so VCS panels can be exercised with zero host coupling. The path-parity mount is the orthogonal "open my real project" path. Both available; neither required.

### Decision 6: UI-only by default, opt-in key for e2e
No `PI_AUTH_*` seeded by default → panels render and navigate, agents simply don't run (UI-only QA). Setting `PI_AUTH_*` (or `ANTHROPIC_API_KEY` etc.) in `.env` seeds `auth.json` via the base entrypoint's existing seeder → full e2e agent runs. The throwaway key sits in a local `.env` (gitignored); acceptable for a test key.

## Risks / Trade-offs

- **`CAP_SYS_ADMIN` weakens container isolation.** Mitigated: local test harness only, never a deployment profile; `TEST_COPY_MODE=1` removes the cap entirely where required.
- **tmpfs upper sized by write volume.** A test that writes gigabytes could exhaust the tmpfs. Mitigated: tmpfs size cap in the overlay; teardown reclaims it.
- **Depends on unbuilt `docker-packaging`.** This change cannot run until that one lands. Accepted — proposals may depend on unbuilt work; sequencing noted in `## Depends On`.
- **Path-parity diverges from docker-packaging's `/workspaces/<name>`.** Could confuse readers. Mitigated: `TESTING.md` documents the divergence and its rationale explicitly.

## Open Questions

- None blocking. Image-tag-encodes-commit and `.env`-key handling are inherited from docker-packaging.
