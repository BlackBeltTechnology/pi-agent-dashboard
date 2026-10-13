/**
 * E2E: stabilize-mdns-server-identity — task 6.8 (test-plan F5).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins the selector's mapping from a server-side probe status to a label in
 * jsdom with a stubbed API. Only a real browser against the real server shows
 * the whole chain: the browser's own health fetch to a dead `.local` name
 * fails, the selector asks the dashboard's operator-only probe, the REAL server
 * resolves the name (ENOTFOUND) and the row reads "Name not found" — not the
 * CORS-blocked hint the old LAN heuristic produced for every `.local` host.
 *
 * ACTORS
 * ------
 * The `page` fixture is the OPERATOR: specs reach the container through a
 * published port (docker-bridge peer, not loopback), so the context carries the
 * harness's REAL `X-Pi-Local-Token` — the same-host operator credential — on
 * every request. The known server is seeded through the operator API.
 *
 * Exemplars: access-grants-revoke.spec.ts (harness glue),
 * pairing-approval-dialog.spec.ts (operator context via helpers/bridge-credential).
 */
import { expect, test } from "./fixtures.js";
import { operatorHeaders } from "./helpers/bridge-credential.js";
import { gotoDashboard } from "./helpers/index.js";

const STALE_HOST = "stale-zz9-unresolvable.local";
const STALE_PORT = 8000;

test("a known server with a dead hostname reads 'Name not found', not CORS-blocked", async ({ page, request }) => {
  const headers = operatorHeaders();
  const seeded = await request.post("/api/known-servers", {
    data: { host: STALE_HOST, port: STALE_PORT, label: "Stale iMac" },
    headers,
  });
  expect((await seeded.json()).success).toBe(true);

  try {
    await page.context().setExtraHTTPHeaders(headers);
    await gotoDashboard(page);

    await page.getByTitle("Switch server").click();

    const row = page.getByRole("button", { name: new RegExp(`${STALE_HOST}:${STALE_PORT}`) });
    await expect(row).toContainText("Name not found", { timeout: 15_000 });
    await expect(row).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("[data-cors-blocked]")).toHaveCount(0);
  } finally {
    await request.delete("/api/known-servers", { data: { host: STALE_HOST, port: STALE_PORT }, headers });
  }
});
