/**
 * L3: a chat-spawned session only ever receives the triggering message once its tool guard proved it
 * loaded (change: harden-agent-tool-guards D6; test-plan #F8 / #X21; T.105, T.129 L3 half).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 (`gateway-guard-ready.test.ts`) pins the handshake against a fake host seam, and
 * `pi-headless-trust-outcome.test.ts` pins that the installed pi exits at startup on a mistyped `-e`
 * ref. Only the real harness proves the two ends together: a REAL spawn through the dashboard, a REAL
 * pi that never starts, the gateway's own readiness timer, and the reply a chat user sees.
 *   1. mistyped `guardExtension`: the session never registers; after the readiness window the chat shows
 *      "session refused: its tool guard did not start" and the message is in NO session transcript.
 *   2. a correct `guardExtension`: the guard announces readiness and the message reaches the session
 *      exactly once.
 *
 * HARNESS PREREQUISITE (the `e2e-chat-gateway` CI leg sets it; every other harness skips this file):
 *   PI_E2E_SEED=1 PI_CHAT_GATEWAY_FAKE=1 docker/test-up.sh -d --build --force-recreate
 * The fake platform (packages/chat-gateway/src/adapters/fake.ts) is driven over the FILESYSTEM:
 * a line appended to `inbound.jsonl` is a chat user's message, `outbound.jsonl` is what the bot posted.
 *
 * The gateway config is patched INSIDE the container (the seeded one has no allowlist / toolPolicy and
 * a team layer whose observe-tier principal would refuse the spawn before the guard matters), then the
 * dashboard is restarted so the plugin re-reads it. The original config is restored afterwards.
 *
 * Authored WITHOUT a runnable docker harness: first run happens in CI.
 */
import { execSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

const CONFIG = "/home/pi/.pi/dashboard/config.json";
const FAKE_DIR = "/tmp/chat-gateway-fake";
const SESSIONS = "/home/pi/.pi/agent/sessions";
const USER = "e2e_invoker";
const CHANNEL = "e2e_guard_chan";
const CWD = "/fixtures/sample-git";
const REAL_GUARD = "/app/packages/chat-gateway/src/guard/index.ts";
const TYPO_GUARD = "/app/packages/chat-gateway/src/guard/no-such-guard-typo.ts";
const REFUSED = "session refused: its tool guard did not start";
/** The readiness window is fixed at 30 s in production (not injectable at L3); the rest is boot slack. */
const WINDOW_MS = 30_000;

function containerName(): string {
  return execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, { encoding: "utf8" })
    .trim()
    .split("\n")[0];
}
function inContainer(script: string): string {
  return execSync(`docker exec -i ${containerName()} node`, { input: script, encoding: "utf8" });
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 2_000));
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`)).ok) return;
    } catch {
      /* still down */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

/** Patch the gateway plugin config in the container and restart; returns once the fake platform re-initialised. */
async function configureGateway(guardExtension: string): Promise<void> {
  const startedAt = Number(
    inContainer(`
      const fs = require("node:fs");
      const c = JSON.parse(fs.readFileSync(${JSON.stringify(CONFIG)}, "utf8"));
      const g = (c.plugins["chat-gateway"] ??= { enabled: true });
      delete g.teamControls; // the seeded observe-tier principal would refuse the spawn before the guard matters
      Object.assign(g, {
        enabled: true,
        allowlist: [${JSON.stringify(USER)}],
        admins: [${JSON.stringify(USER)}],
        groupChannels: [${JSON.stringify(CHANNEL)}],
        allowedRoots: [${JSON.stringify(CWD)}],
        defaultCwd: ${JSON.stringify(CWD)},
        toolPolicy: { allow: ["read"], approval: ["bash"], defaultAction: "deny" },
        guardExtension: ${JSON.stringify(guardExtension)},
      });
      fs.writeFileSync(${JSON.stringify(CONFIG)}, JSON.stringify(c) + "\\n");
      process.stdout.write(String(Math.floor(Date.now() / 1000)));
    `).trim(),
  );
  await restartDashboard();
  // `initialize()` truncates both scratch files: wait until that ran after the restart, or a line we
  // append now would be wiped.
  await expect
    .poll(
      () =>
        Number(
          inContainer(`
            const fs = require("node:fs");
            try { process.stdout.write(String(Math.floor(fs.statSync(${JSON.stringify(`${FAKE_DIR}/outbound.jsonl`)}).mtimeMs / 1000))); } catch { process.stdout.write("0"); }
          `).trim(),
        ),
      { timeout: 60_000, message: "the fake chat platform never re-initialised after the restart" },
    )
    .toBeGreaterThanOrEqual(startedAt);
  await new Promise((r) => setTimeout(r, 2_000)); // the inbound poll starts right after initialize()
}

function say(content: string): void {
  inContainer(`
    require("node:fs").appendFileSync(${JSON.stringify(`${FAKE_DIR}/inbound.jsonl`)}, JSON.stringify({ channelId: ${JSON.stringify(CHANNEL)}, userId: ${JSON.stringify(USER)}, content: ${JSON.stringify(content)} }) + "\\n");
  `);
}

function botSaid(): string[] {
  const raw = inContainer(`
    try { process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(`${FAKE_DIR}/outbound.jsonl`)}, "utf8")); } catch {}
  `);
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return String((JSON.parse(l) as { content?: string }).content ?? "");
      } catch {
        return "";
      }
    });
}

/** What the bot posted plus the gateway / spawn lines of the dashboard log: attached to every timeout. */
function diagnostics(): string {
  const log = inContainer(`
    try {
      const t = require("node:fs").readFileSync("/home/pi/.pi/dashboard/server.log", "utf8").split("\\n");
      process.stdout.write(t.filter((l) => /chat-gateway|spawn|guard|refus|extension/i.test(l)).slice(-40).join("\\n"));
    } catch (e) { process.stdout.write("(no server.log: " + e.message + ")"); }
  `);
  return `\n--- bot said ---\n${botSaid().join("\n") || "(nothing)"}\n--- server.log (gateway/spawn lines) ---\n${log}`;
}

/** Poll `probe` until it satisfies `done`; on timeout fail WITH the diagnostics instead of a bare "false". */
async function until<T>(probe: () => T, done: (v: T) => boolean, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = probe();
  while (!done(last)) {
    if (Date.now() > deadline) throw new Error(`${what} (last value: ${JSON.stringify(last)})${diagnostics()}`);
    await new Promise((r) => setTimeout(r, 1_000));
    last = probe();
  }
  return last;
}

/** How many user-message lines carrying `marker` exist across every persisted session transcript. */
function deliveries(marker: string): number {
  return Number(
    inContainer(`
      const fs = require("node:fs"), path = require("node:path");
      let n = 0;
      const walk = (d) => {
        let entries = [];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith(".jsonl")) {
            for (const line of fs.readFileSync(p, "utf8").split("\\n")) {
              if (line.includes(${JSON.stringify(marker)}) && line.includes('"role":"user"')) n += 1;
            }
          }
        }
      };
      walk(${JSON.stringify(SESSIONS)});
      process.stdout.write(String(n));
    `).trim(),
  );
}

test.describe("chat-gateway guard readiness (L3)", () => {
  test.skip(!process.env.PI_CHAT_GATEWAY_FAKE, "variant harness: PI_CHAT_GATEWAY_FAKE=1 (e2e-chat-gateway CI leg)");
  test.describe.configure({ mode: "serial", timeout: 300_000 });

  let originalConfig = "";
  test.beforeAll(() => {
    originalConfig = inContainer(`process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(CONFIG)}, "utf8"))`);
  });
  test.afterAll(async () => {
    if (!originalConfig) return;
    inContainer(`require("node:fs").writeFileSync(${JSON.stringify(CONFIG)}, ${JSON.stringify(originalConfig)})`);
    await restartDashboard().catch(() => undefined);
  });

  test("#F8 a mistyped guardExtension: the chat shows 'session refused' and the message reaches no session", async () => {
    await configureGateway(TYPO_GUARD);
    const marker = `guard-typo-${Date.now().toString(36)}`;
    say(marker);

    // The refusal arrives after the fixed readiness window (plus boot slack on a shared runner).
    await until(() => botSaid().some((m) => m.includes(REFUSED)), Boolean, WINDOW_MS + 60_000, `the chat never showed "${REFUSED}"`);

    // The message the user typed never reached any session, before or after the refusal.
    expect(deliveries(marker), "the held message leaked into a session transcript").toBe(0);
    await new Promise((r) => setTimeout(r, 5_000));
    expect(deliveries(marker), "the held message arrived after the refusal").toBe(0);
    // One refusal, not a retry loop.
    expect(botSaid().filter((m) => m.includes(REFUSED))).toHaveLength(1);
  });

  test("#F8 control: a correct guardExtension delivers the message exactly once, with no refusal", async () => {
    await configureGateway(REAL_GUARD);
    const marker = `guard-real-${Date.now().toString(36)}`;
    say(marker);

    await until(() => deliveries(marker), (n) => n >= 1, WINDOW_MS + 60_000, "the message never reached the guarded session");
    await new Promise((r) => setTimeout(r, 5_000));
    expect(deliveries(marker), "delivered more than once").toBe(1);
    expect(botSaid().some((m) => m.includes(REFUSED))).toBe(false);
  });
});
