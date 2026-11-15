/**
 * E2E: device-key-mutual-check (test-plan F8, X15) — revoke is a state, not a delete.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins the registry, the routes and the Settings components in isolation. Only a real server and
 * a real operator page show that one click cuts a device off EVERYWHERE at once (bearer refused, open
 * socket closed live with 4401, key proof answers `revoked`) and that Undo / Undo revoke / Delete now
 * converge on the same server truth the device sees.
 *
 * ACTORS
 * ------
 * - OPERATOR: the `page` fixture on Settings ▸ Security ▸ Paired devices, with the harness's real
 *   `X-Pi-Local-Token` on every request (see helpers/bridge-credential).
 * - DEVICE D: no browser — a keyed device paired through the real redeem → approve → poll path
 *   (bearer T, Ed25519 key K signed with `node:crypto`, helpers/device-key.ts), holding a real dashboard
 *   WebSocket (single-use ticket minted with T). Waits are on the socket `close` event and on server
 *   truth, never on a fixed delay.
 *
 * HARNESS FACTS THIS SPEC RESPECTS
 * --------------------------------
 * - The seed trusts every peer, which would admit a revoked device's bearer anyway; the suite narrows
 *   `trustedNetworks` to a range that matches nobody (`narrowTrust`, test scope via `beforeEach`).
 * - All device calls come from one gateway source address; device-status is limited to 60/min per peer
 *   and this file makes ~25 proofs per run.
 * - Unique labels per run; every device is revoked and deleted for good in `afterEach`/`afterAll`.
 */
import type { Page } from "@playwright/test";
import { expect, narrowTrust, test } from "./fixtures.js";
import { operatorHeaders } from "./helpers/bridge-credential.js";
import {
  deviceStatus,
  type E2eDeviceKey,
  listPairedDevices,
  newDeviceKey,
  openDeviceSocket,
  pairKeyedDevice,
  purgeDevices,
  guardedStatus,
} from "./helpers/device-key.js";
import { gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

const BASE = `http://127.0.0.1:${DASHBOARD_PORT}`;
const PREFIX = "dk-rev-";
const NOBODY = ["198.51.100.0/24"]; // TEST-NET-2: matches no peer

interface Device {
  id: string;
  label: string;
  token: string;
  key: E2eDeviceKey;
}

async function pairDevice(suffix: string): Promise<Device> {
  const label = `${PREFIX}${suffix}-${Date.now().toString(36)}`;
  const key = newDeviceKey();
  const { token } = await pairKeyedDevice(BASE, key, label);
  const row = (await listPairedDevices(BASE)).find((d) => d.label === label);
  if (!row) throw new Error(`paired device ${label} not listed`);
  return { id: row.id, label, token, key };
}

async function openPairedDevices(page: Page): Promise<void> {
  await page.context().setExtraHTTPHeaders(operatorHeaders());
  await gotoDashboard(page);
  await page.goto("/settings/security");
}

/** The ACTIVE-list row of a device (the revoked list renders its own `revoked-<id>` item). */
const activeRow = (page: Page, label: string) =>
  page.locator("li:not([data-testid])").filter({ hasText: label });

async function revokeInUi(page: Page, label: string): Promise<void> {
  const row = activeRow(page, label);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByTitle("Revoke device").click();
  await row.getByRole("button", { name: "Confirm revoke" }).click();
}

/** Open a socket for D and revoke it in the UI; resolves with the close event the revoke caused. */
async function revokeWithOpenSocket(page: Page, d: Device) {
  const socket = await openDeviceSocket(BASE, d.token);
  await socket.opened;
  await revokeInUi(page, d.label);
  const closed = await socket.closed;
  return closed;
}

/**
 * A refused (revoked-bearer) call from the host is a request from an UNTRUSTED address, which raises the
 * operator's access-grant prompt for that address and would cover the Settings page. Deny it like an
 * operator would. The wait is for the dialog the refusal causes (it is raised by the server, not by a
 * timer); the deny is remembered, so later refusals from the same address do not prompt again.
 */
async function denyAddressPrompt(page: Page): Promise<void> {
  const dialog = page.getByTestId("grant-dialog");
  const appeared = await dialog.waitFor({ state: "visible", timeout: 5_000 }).then(
    () => true,
    () => false,
  );
  if (!appeared) return;
  await dialog.getByTestId("grant-deny").click();
  await expect(dialog).toHaveCount(0);
}

async function expectCutOff(d: Device): Promise<void> {
  // The held bearer is treated as unauthenticated: refused (401/403 by guard), never served.
  expect([401, 403]).toContain(await guardedStatus(BASE, d.token));
  expect((await deviceStatus(BASE, d.key)).status).toBe("revoked");
  expect((await listPairedDevices(BASE)).map((r) => r.id)).not.toContain(d.id);
}

async function expectRestored(d: Device): Promise<void> {
  const row = (await listPairedDevices(BASE)).find((r) => r.label === d.label);
  expect(row?.id, "same device id after restore").toBe(d.id);
  expect(await guardedStatus(BASE, d.token), "same bearer, no re-pairing").toBe(200);
  expect((await deviceStatus(BASE, d.key)).status).toBe("paired");
  // After a restore the device reconnects its socket.
  const socket = await openDeviceSocket(BASE, d.token);
  await socket.opened;
  socket.close();
}

test.describe.configure({ mode: "serial" });

test.describe("revoke is a state: held, undoable, deletable", () => {
  test.beforeAll(async () => {
    await purgeDevices(BASE, PREFIX);
  });
  // Test scope (runs inside the fixture's body window), so the fixture restores trust after EACH test.
  // A describe-scope narrowing is released only at the next file's first test — after that file's own
  // `beforeAll` has snapshotted it — and would clobber a following describe-scope spec (lan-knock E19).
  test.beforeEach(async ({ request }) => {
    await narrowTrust(request, { trustedNetworks: NOBODY });
  });
  test.afterEach(async () => {
    await purgeDevices(BASE, PREFIX);
  });
  test.afterAll(async () => {
    await purgeDevices(BASE, PREFIX);
  });

  test("F8 path 1 + X15: revoke closes the socket 4401 and refuses T; Undo in the toast restores the same device", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const d = await pairDevice("toast");
    await openPairedDevices(page);

    const closed = await revokeWithOpenSocket(page, d);
    expect(closed).toEqual({ code: 4401, reason: "device revoked" });
    await expectCutOff(d);
    await denyAddressPrompt(page);

    // UI: the notice names the device and leaves the active list; the held list explains the 90 days.
    const notice = page.getByTestId(`revoke-notice-${d.id}`);
    await expect(notice).toContainText(`${d.label} revoked`);
    await expect(activeRow(page, d.label)).toHaveCount(0);
    const held = page.getByTestId(`revoked-${d.id}`);
    await expect(held).toContainText("Deleted for good in 90 days");
    await expect(page.getByTestId("revoked-lost-warning")).toContainText(/lost or stolen/i);

    await notice.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(activeRow(page, d.label)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`revoked-${d.id}`)).toHaveCount(0);
    await expectRestored(d);
  });

  test("F8 path 2: after the toast passes, Undo revoke in the Revoked list restores the same device", async ({ page }) => {
    test.setTimeout(90_000);
    const d = await pairDevice("list");
    await openPairedDevices(page);

    expect((await revokeWithOpenSocket(page, d)).code).toBe(4401);
    await expectCutOff(d);
    await denyAddressPrompt(page);

    // Wait on the DOM for the 10 s notice to go away — no fixed sleep.
    await expect(page.getByTestId(`revoke-notice-${d.id}`)).toBeHidden({ timeout: 20_000 });
    const held = page.getByTestId(`revoked-${d.id}`);
    await expect(held).toContainText("Deleted for good in 90 days");
    await expect(page.getByTestId("revoked-lost-warning")).toBeVisible();

    await held.getByRole("button", { name: "Undo revoke" }).click();
    await expect(activeRow(page, d.label)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`revoked-${d.id}`)).toHaveCount(0);
    await expectRestored(d);
  });

  test("F8 path 3: Delete now (confirmed) removes D for good — T refused, proof unknown, no restore offered", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const d = await pairDevice("delete");
    await openPairedDevices(page);

    expect((await revokeWithOpenSocket(page, d)).code).toBe(4401);
    await expectCutOff(d);
    await denyAddressPrompt(page);
    await expect(page.getByTestId(`revoke-notice-${d.id}`)).toBeHidden({ timeout: 20_000 });

    const held = page.getByTestId(`revoked-${d.id}`);
    await held.getByRole("button", { name: "Delete now" }).click();
    const confirm = page.getByTestId("delete-revoked-confirm");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete now" }).click();

    await expect(held).toHaveCount(0, { timeout: 10_000 });
    expect([401, 403]).toContain(await guardedStatus(BASE, d.token));
    expect((await deviceStatus(BASE, d.key)).status).toBe("unknown");
    expect((await listPairedDevices(BASE)).map((r) => r.id)).not.toContain(d.id);
    // Nothing left to restore: the server answers 404, and the UI never offered it again.
    const restore = await request.post(`/api/paired-devices/${d.id}/restore`, { headers: operatorHeaders() });
    expect(restore.status()).toBe(404);
    await expect(page.getByRole("button", { name: "Undo revoke" })).toHaveCount(0);
  });
});
