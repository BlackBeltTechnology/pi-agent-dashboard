/**
 * L3 — push webhook through the rendered Settings UI (test-plan #F9).
 *
 * Push is boot-frozen and opt-in, so beforeAll enables it OUT-OF-BAND in the
 * harness `config.json` (docker exec, like `keeper-log-health.spec.ts`), starts
 * a tiny HTTP receiver INSIDE the container on loopback (an allowed target: not
 * link-local, not the dashboard's port), and restarts the dashboard. The test
 * then adds the receiver as a webhook via Settings ▸ Sessions ▸ Push
 * notifications and clicks Send test.
 *
 * Asserts: the row shows only `label (origin)`; the receiver got exactly one
 * POST carrying `type: "session_attention"`; the page never shows the webhook
 * path or query (the URL is a secret).
 *
 * afterAll removes the token, stops the receiver, drops the `push` block and
 * restarts, so the shared harness is left as found. Port + compose project
 * come from `.pi-test-harness.json` / the fixtures' baseURL — never hardcoded.
 *
 * See change: add-server-push-notifications.
 */

import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { BASE_URL, harnessProject } from "./lifecycle.js";

const RECEIVER_PORT = 18787;
const RECEIVER_LOG = "/tmp/pi-e2e-push-receiver.log";
const RECEIVER_PID = "/tmp/pi-e2e-push-receiver.pid";
const WEBHOOK_URL = `http://127.0.0.1:${RECEIVER_PORT}/api/hooks/e2e-h1?key=e2e-s3cret`;
const LABEL = "e2e-hook";

let containerId: string | undefined;
function harnessContainer(): string {
  if (containerId) return containerId;
  const project = harnessProject();
  const id = execFileSync("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${project}`], {
    encoding: "utf8",
    timeout: 30_000,
  })
    .trim()
    .split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${project}`);
  containerId = id;
  return id;
}

function inContainer(script: string): string {
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

/** Merge (or drop) the `push` block in the harness config.json. */
function setPushConfig(enabled: boolean): void {
  const js = enabled
    ? `c.push={enabled:true,coalesceWindowMs:5000};`
    : `delete c.push;`;
  inContainer(
    `node -e 'const fs=require("fs");const f=process.env.HOME+"/.pi/dashboard/config.json";` +
      `const c=JSON.parse(fs.readFileSync(f,"utf8"));${js}fs.writeFileSync(f,JSON.stringify(c,null,2));'`,
  );
}

function startReceiver(): void {
  inContainer(
    `rm -f ${RECEIVER_LOG}; nohup node -e '` +
      `require("http").createServer((q,s)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{` +
      `require("fs").appendFileSync("${RECEIVER_LOG}",JSON.stringify({method:q.method,url:q.url,body:b})+"\\n");` +
      `s.writeHead(204).end();});}).listen(${RECEIVER_PORT},"127.0.0.1");' >/dev/null 2>&1 & echo $! > ${RECEIVER_PID}`,
  );
}

function stopReceiver(): void {
  // No pkill in the image: kill the PID recorded at start.
  inContainer(`[ -f ${RECEIVER_PID} ] && kill "$(cat ${RECEIVER_PID})" 2>/dev/null; rm -f ${RECEIVER_PID} ${RECEIVER_LOG}; true`);
}

function receiverRequests(): Array<{ method: string; url: string; body: string }> {
  const raw = inContainer(`cat ${RECEIVER_LOG} 2>/dev/null || true`);
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function restartDashboard(): Promise<void> {
  await fetch(`${BASE_URL}/api/restart`, { method: "POST" }).catch(() => undefined);
  const deadline = Date.now() + 150_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/push/vapid-public-key`);
      const health = await fetch(`${BASE_URL}/api/health`);
      if (health.ok && (res.status === 200 || res.status === 404)) return;
    } catch {
      // still down
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

test.describe("push webhook via Settings (L3, test-plan #F9)", () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async () => {
    setPushConfig(true);
    startReceiver();
    await restartDashboard();
  });

  test.afterAll(async () => {
    try {
      const list = (await (await fetch(`${BASE_URL}/api/push/register`)).json()) as { tokens?: Array<{ tokenId: string }> };
      for (const t of list.tokens ?? []) {
        await fetch(`${BASE_URL}/api/push/register/${t.tokenId}`, { method: "DELETE" });
      }
    } catch {
      /* best effort */
    }
    stopReceiver();
    setPushConfig(false);
    await restartDashboard();
  });

  test("F9: add a webhook in Settings, Send test → one POST; the row shows label (origin) only", async ({ page }) => {
    expect((await fetch(`${BASE_URL}/api/push/vapid-public-key`)).status).toBe(200);

    await gotoDashboard(page);
    await page.goto("/settings/sessions");
    await page.getByLabel("Webhook URL").fill(WEBHOOK_URL);
    await page.getByLabel(/^Label/).fill(LABEL);
    await page.getByRole("button", { name: "Add webhook" }).click();

    const row = page.getByText(`${LABEL} (http://127.0.0.1:${RECEIVER_PORT})`, { exact: true });
    await expect(row).toBeVisible();
    await expect(page.getByLabel("Webhook URL")).toHaveValue("");

    await page.getByRole("button", { name: `Send test to ${LABEL} (http://127.0.0.1:${RECEIVER_PORT})` }).click();
    await expect(page.getByText("Test sent")).toBeVisible();

    await expect.poll(() => receiverRequests().length, { timeout: 15_000 }).toBe(1);
    const [req] = receiverRequests();
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/api/hooks/e2e-h1?key=e2e-s3cret");
    expect(JSON.parse(req.body).type).toBe("session_attention");

    const html = await page.content();
    expect(html).not.toContain("/api/hooks/e2e-h1");
    expect(html).not.toContain("e2e-s3cret");
  });
});
