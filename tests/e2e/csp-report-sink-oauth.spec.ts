import { expect, test } from "./fixtures.js";

/**
 * L3 — the baseline CSP report sink under an ARMED OAuth gate (change:
 * harden-cors-and-csp-reporting; test-plan #WF5; spec oauth-authentication "CSP report
 * sink is public to the OAuth gate").
 *
 * Signed-out pages (login, passkey) must be able to deliver CSP reports. Under the usual
 * `PI_E2E_OAUTH=1` seed `bypassUrls:["/"]` matches every path, so an exemption assertion would
 * pass vacuously. This spec therefore needs the real-gate lane:
 *
 *   PI_E2E_SEED=1 PI_E2E_OAUTH=1 PI_E2E_OAUTH_NO_BYPASS=1 docker/test-up.sh
 *   PW_E2E_USE_RUNNING=1 npx playwright test csp-report-sink-oauth
 *
 * That lane locks the Playwright host out of every other route — run only this spec there. It
 * SKIPS when the gate is not armed for the client (blanket-bypass harness, or a trusted source).
 *
 * Control: `GET /api/health` is itself public to the OAuth gate (it only tags a session cookie),
 * so it cannot show "gated"; `GET /api/sessions` is the gated control instead.
 *
 * Exemplar: tests/e2e/oauth-redirect-base.spec.ts.
 */

const SINK = "/__pi/csp-report/";
const REPORT = JSON.stringify({
  "csp-report": {
    "document-uri": "https://example.invalid/auth/login",
    "effective-directive": "img-src",
    "blocked-uri": "https://blocked.invalid/x.png",
  },
});

test.describe("WF5: CSP report sink is public to the OAuth gate", () => {
  test("signed-out report POSTs reach the sink; every other request is gated like the control", async ({ request }) => {
    const control = await request.get("/api/sessions", {
      maxRedirects: 0,
      headers: { accept: "text/html" },
    });
    test.skip(
      control.status() !== 302 && control.status() !== 401,
      "OAuth gate not armed for this client (blanket bypassUrls or trusted source) — needs PI_E2E_OAUTH_NO_BYPASS=1",
    );
    const controlLocation = control.headers().location ?? "";

    // (a) the login page itself is reachable signed-out.
    const login = await request.get("/auth/login", { maxRedirects: 0 });
    expect(login.status()).toBe(200);

    // (b) a valid report, both media types, on every label → 204, never a login redirect or 401.
    for (const policy of ["baseline", "strict", "trusted-types"]) {
      for (const type of ["application/csp-report", "application/reports+json"]) {
        const body =
          type === "application/reports+json"
            ? JSON.stringify([{ type: "csp-violation", body: JSON.parse(REPORT)["csp-report"] }])
            : REPORT;
        const res = await request.post(`${SINK}${policy}`, {
          maxRedirects: 0,
          headers: { "content-type": type },
          data: body,
        });
        expect(res.status(), `${policy} ${type}`).toBe(204);
      }
    }

    // (c) the exemption is POST-only on exactly the three labels: GET and an unknown label are gated.
    const get = await request.get(`${SINK}strict`, { maxRedirects: 0, headers: { accept: "text/html" } });
    expect(get.status()).toBe(control.status());
    if (controlLocation) expect(get.headers().location ?? "").toContain("/auth/login");
    const evil = await request.post(`${SINK}strict-evil`, {
      maxRedirects: 0,
      headers: { "content-type": "application/csp-report", accept: "text/html" },
      data: REPORT,
    });
    expect(evil.status()).toBe(control.status());
  });
});
