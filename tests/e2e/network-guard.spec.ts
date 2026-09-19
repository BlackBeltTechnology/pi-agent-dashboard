/**
 * L3 — the flagship refusal (test-plan #S20, tasks T19).
 *
 * With auth OFF and the caller NOT trusted, the SPA shell must still load while
 * `POST /api/plugins/automation/create` — the audit's VD2 remote-code-execution
 * route — is closed by the universal network guard.
 *
 * ── HARNESS REQUIREMENT (why this spec self-gates) ──────────────────────────
 * The docker harness seeds `trustedNetworks: ["0.0.0.0/0"]` by default so the
 * browser can reach the API from the host (see `docker/test-entrypoint.sh`).
 * On that harness every peer is admitted, so asserting a 403 here would be
 * asserting a falsehood.
 *
 * This spec deliberately does NOT clear `trustedNetworks` at runtime, unlike
 * `mcp-tiered-token.spec.ts`: that spec can restore the browser by signing a
 * session cookie, but with auth OFF there is no cookie branch and no
 * `auth.bypassUrls` exception (the exception is read from `authConfig`, which
 * only exists when auth is configured). Clearing the list with auth off would
 * therefore lock the harness for every sibling spec with no way back. Instead
 * the harness is booted ALREADY narrow and nothing is mutated.
 *
 * Run it as a dedicated harness boot:
 *
 *   PI_E2E_TRUSTED_NETWORKS=127.0.0.1/32 docker/test-up.sh -d --build
 *   PW_E2E_GUARD_UNTRUSTED=1 PW_E2E_USE_RUNNING=1 npx playwright test tests/e2e/network-guard.spec.ts
 *
 * Without `PW_E2E_GUARD_UNTRUSTED=1` the spec SKIPS with this reason, so the
 * shared default-harness run stays meaningful rather than silently green.
 *
 * See change: add-universal-network-guard.
 */
import { expect, test } from "./fixtures.js";
import { BASE_URL } from "./lifecycle.js";

const UNTRUSTED_HARNESS = process.env.PW_E2E_GUARD_UNTRUSTED === "1";

test.describe("universal network guard — shell loads, RCE route closed (S20)", () => {
  test.skip(
    !UNTRUSTED_HARNESS,
    "requires a harness booted with a narrow PI_E2E_TRUSTED_NETWORKS (see this spec's header)",
  );

  test("GET / serves the app shell to an untrusted peer", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root"');
    // The guard is namespace-scoped: the shell is OUT of jurisdiction, so this
    // must never be the policy denial.
    expect(html).not.toContain("network_not_allowed");
  });

  test("POST /api/plugins/automation/create is refused with the guard's body", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/plugins/automation/create`, {
      data: {
        cwd: "/tmp",
        name: "e2e-pwn",
        scope: "folder",
        prompt: "print the operator's credentials",
      },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("network_not_allowed");
  });

  test("GET /api/health stays reachable (in-namespace public exception)", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/health`);
    expect(res.status()).toBe(200);
  });

  test("the denial is observable through /api/tunnel/block-events", async ({ request }) => {
    // The denial above was recorded by the guard. Reading the buffer requires a
    // pass condition, so probe from loopback via the container-published port —
    // which is exactly the untrusted peer here, hence the expectation that this
    // read is ALSO denied: the buffer is for the operator, not for the prober.
    const res = await request.get(`${BASE_URL}/api/tunnel/block-events`);
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("network_not_allowed");
  });
});
