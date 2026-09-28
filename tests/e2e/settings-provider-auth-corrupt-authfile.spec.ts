/**
 * L3 — corrupt `auth.json` degrades without a 5xx or a white screen, and the
 * repair surfaces stay reachable while corrupt (test-plan X13, plus the
 * repair-flow rows this file has covered since fix-corrupt-auth-json-500).
 *
 * The bug this guards is the original 0.8.0 AppImage report: a zero-byte
 * `auth.json` made `GET /api/provider-auth/status` return
 * `500 {"message":"Unexpected end of JSON input"}` and the Settings panel
 * white-screen on `TypeError: t.filter is not a function` — the one surface
 * that could repair the file was the surface that died.
 *
 * The file is zeroed OUT-OF-BAND inside the harness container (docker exec),
 * the same way other specs plant harness state. The pre-existing bytes are
 * snapshotted and restored so later specs still see the seeded credential.
 *
 * Updated for redesign-providers-settings-page: the providers section is now
 * the single CONNECTED LIST with the Add-provider dialog as the only entry
 * point, so the rendered-surface assertions below select that surface (the
 * pre-redesign "Subscriptions (OAuth)" / "Add Key" rows are gone).
 *
 * Exemplar: tests/e2e/ended-session-endedat.spec.ts (container discovery +
 * bounded docker exec). Port + compose project come from .pi-test-harness.json
 * via the Playwright config — never hardcode :18000.
 *
 * See changes: fix-corrupt-auth-json-500, redesign-providers-settings-page.
 */

import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, gotoDashboard, openAddPicker } from "./helpers/index.js";
import { harnessProject } from "./lifecycle.js";

/**
 * The harness container id, resolved from the compose project recorded in
 * `.pi-test-harness.json`.
 */
let containerId: string | undefined;
function harnessContainer(): string {
  if (containerId) return containerId;
  const project = harnessProject();
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${project}`],
    { encoding: "utf8", timeout: 30_000 },
  ).trim().split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${project}`);
  containerId = id;
  return id;
}

function inContainer(script: string): string {
  // Bounded: an unbounded `docker` call would hang the single worker until the
  // Playwright timeout fires, hiding the real cause.
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

const AUTH_FILE = 'process.env.HOME + "/.pi/agent/auth.json"';

/** Current harness auth.json bytes, base64 (empty string = file absent). */
function readAuthB64(): string {
  return inContainer(
    `node -e 'const fs=require("fs");try{process.stdout.write(fs.readFileSync(${AUTH_FILE}).toString("base64"))}catch{process.stdout.write("")}'`,
  );
}

function writeAuthB64(b64: string): void {
  if (!b64) {
    inContainer(`node -e 'require("fs").rmSync(${AUTH_FILE},{force:true})'`);
    return;
  }
  inContainer(`node -e 'require("fs").writeFileSync(${AUTH_FILE},Buffer.from("${b64}","base64"))'`);
}

/** The corruption itself: a zero-byte auth.json, out-of-band. */
function zeroOutAuthFile(): void {
  inContainer(`node -e 'require("fs").writeFileSync(${AUTH_FILE},"")'`);
}

async function openProviderAuthSettings(page: Page) {
  await gotoDashboard(page);
  await page.goto("/settings/providers");
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Provider Authentication").first()).toBeVisible({ timeout: 20_000 });
}

test.describe("settings provider auth with a corrupt auth.json", () => {
  // X13 — the degradation contract: the status read must answer 200 with a
  // JSON array of signed-out rows, never a 5xx, while the file is corrupt.
  test("a zero-byte auth.json answers 200 with an all-unauthenticated array and the section stays mounted (#X13)", async ({
    page,
    request,
  }) => {
    const original = readAuthB64();
    try {
      zeroOutAuthFile();

      // The API half of X13: 200, array, every row authenticated:false.
      const statusResponses: number[] = [];
      page.on("response", (res) => {
        if (res.url().includes("/api/provider-auth/status")) statusResponses.push(res.status());
      });
      const res = await request.get("/api/provider-auth/status");
      expect(res.status(), "no 5xx while auth.json is corrupt").toBe(200);
      const body = (await res.json()) as unknown;
      expect(Array.isArray(body), "the body is still a JSON array").toBe(true);
      const rows = body as Array<{ authenticated?: boolean }>;
      expect(rows.length, "the handler registry still emits rows").toBeGreaterThanOrEqual(1);
      expect(
        rows.every((r) => r !== null && typeof r === "object" && r.authenticated === false),
        "every row reports authenticated:false",
      ).toBe(true);

      // The browser half: the section renders mounted, never an ErrorBoundary,
      // and every status response it saw was a 200.
      await openProviderAuthSettings(page);
      await expect(page.getByTestId("add-provider-button")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Render error:/i)).toHaveCount(0);
      expect(statusResponses.length).toBeGreaterThanOrEqual(1);
      expect(statusResponses.every((s) => s === 200)).toBe(true);
    } finally {
      writeAuthB64(original);
      // The seeded credential must be visible again before this spec ends —
      // later specs gate onboarding on it.
      await expect
        .poll(async () => {
          try {
            const body = (await (await request.get("/api/provider-auth/status")).json()) as Array<{
              id?: string;
              authenticated?: boolean;
            }>;
            return Array.isArray(body) && body.some((r) => r?.id === "anthropic" && r.authenticated === true);
          } catch {
            return false;
          }
        }, { timeout: 15_000, intervals: [500] })
        .toBe(true);
    }
  });

  // The repair surface stays reachable while corrupt: the Add-provider dialog
  // (the single entry point in the redesigned UI) opens and its panes render.
  test("the Add-provider dialog stays operable while auth.json is corrupt", async ({ page }) => {
    const original = readAuthB64();
    try {
      zeroOutAuthFile();
      await openProviderAuthSettings(page);

      await expect(page.getByTestId("add-provider-button")).toBeVisible({ timeout: 20_000 });
      const picker = await openAddPicker(page);

      // The pinned Custom endpoint entry is reachable under any catalogue
      // state; its pane renders the write surface.
      await picker.getByRole("option", { name: /Custom endpoint/ }).click();
      await expect(page.locator("#custom-endpoint-name")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0);
      await expect(page.getByText(/Render error:/i)).toHaveCount(0);
    } finally {
      writeAuthB64(original);
    }
  });

  test("an API key can be saved while auth.json is corrupt (the write heals the file)", async ({
    page,
  }) => {
    const original = readAuthB64();
    try {
      // The API-key picker entries render from the bridge-pushed provider
      // catalogue, so a catalogue must have been pushed BEFORE the file is
      // corrupted (zeroing auth.json afterwards does not unpush it). A live
      // dashboard session's bridge pushes it on connect — the fixtures' reap
      // tears the session down after the test.
      await ensureGitSession(page);
      zeroOutAuthFile();
      await openProviderAuthSettings(page);

      await expect(page.getByTestId("add-provider-button")).toBeVisible({ timeout: 20_000 });
      const picker = await openAddPicker(page);

      const apiKeyOptions = picker
        .getByRole("option")
        .filter({ has: page.getByText("API key", { exact: true }) });
      let cataloguePushed = true;
      try {
        await expect(apiKeyOptions.first()).toBeVisible({ timeout: 15_000 });
      } catch {
        cataloguePushed = false;
      }
      test.skip(
        !cataloguePushed,
        "no bridge-pushed catalogue with API-key providers — start the harness with PI_TEST_PEERS so a session pushes one",
      );

      // The repair flow: enter an API key for the first selectable API-key
      // provider. This PUT goes to the REAL server and must succeed against
      // the corrupt file (healing it), then the row shows the masked key.
      await apiKeyOptions.first().click();
      await page.locator("#provider-api-key-input").fill("sk-e2e-test-key-123");
      await page.getByTestId("dialog-submit").click();

      await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByText("sk-e2...123")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Render error:/i)).toHaveCount(0);
    } finally {
      writeAuthB64(original);
    }
  });
});
