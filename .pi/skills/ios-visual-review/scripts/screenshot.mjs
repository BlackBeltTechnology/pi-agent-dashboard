#!/usr/bin/env node
/**
 * iOS Simulator Screenshot Tool
 * =============================
 * Opens the dashboard in the iOS Simulator Safari, performs a described action,
 * and saves screenshots (web + native contexts).
 *
 * Usage:
 *   node scripts/screenshot.mjs [--action focus-input|idle] [--url URL] [--path /route]
 *
 * Env vars:
 *   PI_DASHBOARD_URL     Dashboard base URL (default http://127.0.0.1:8000)
 *   SIM_UDID             Simulator UDID (auto-detect if unset)
 *   SIM_NAME             Simulator name (default: PWA-Test)
 *   IOS_PLATFORM_VERSION iOS version (default: 26.4)
 *   APPIUM_HOME          Appium home dir (default: qa/ios-visual/.tmp/appium-home)
 */

import { execSync, spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, "..");
const REPO_ROOT = join(SKILL_DIR, "..", "..", "..");
const QA_DIR = join(REPO_ROOT, "qa", "ios-visual");

// Resolve webdriverio from qa/ios-visual/node_modules
const qaRequire = createRequire(join(QA_DIR, "package.json"));
const { remote } = qaRequire("webdriverio");
const APPIUM_HOME = process.env.APPIUM_HOME || join(QA_DIR, ".tmp", "appium-home");
const SCREENSHOT_DIR = join(process.env.TMPDIR || "/tmp", "pi-screenshots");

const DASHBOARD_URL = process.env.PI_DASHBOARD_URL || "http://127.0.0.1:8000";
const SIM_NAME = process.env.SIM_NAME || "PWA-Test";
const PLATFORM_VERSION = process.env.IOS_PLATFORM_VERSION || "26.4";
const ACTION = process.argv.includes("--action") 
  ? process.argv[process.argv.indexOf("--action") + 1] 
  : "idle";

// ── Helpers ────────────────────────────────────────────────────────

function log(msg) { console.log(`[screenshot] ${msg}`); }
function warn(msg) { console.warn(`[screenshot:WARN] ${msg}`); }
function die(msg) { console.error(`[screenshot:FATAL] ${msg}`); process.exit(1); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function httpGet(url) {
  const resp = await fetch(url);
  return { status: resp.status, ok: resp.ok };
}

// ── Dashboard health check ─────────────────────────────────────────

async function checkDashboard() {
  try {
    const r = await httpGet(`${DASHBOARD_URL}/api/health`);
    if (!r.ok) throw new Error(`status ${r.status}`);
  } catch {
    die(`Dashboard not responding at ${DASHBOARD_URL}. Start it: npx tsx packages/server/src/cli.ts start --dev`);
  }
  log(`Dashboard alive at ${DASHBOARD_URL}`);
}

// ── Simulator helpers ──────────────────────────────────────────────

function simctl(...args) {
  const cmd = `xcrun simctl ${args.join(" ")}`;
  return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

function getSimUDID() {
  if (process.env.SIM_UDID) return process.env.SIM_UDID;

  // Find runtime
  const runtimesRaw = execSync("xcrun simctl list runtimes --json", { encoding: "utf-8" });
  const runtimes = JSON.parse(runtimesRaw);
  let runtimeId = "";
  for (const rt of runtimes.runtimes || []) {
    if (rt.name?.startsWith("iOS") && rt.version?.startsWith(PLATFORM_VERSION)) {
      runtimeId = rt.identifier;
      break;
    }
  }
  if (!runtimeId) die(`iOS ${PLATFORM_VERSION} runtime not found`);

  // Find device
  const devicesRaw = execSync("xcrun simctl list devices --json", { encoding: "utf-8" });
  const devices = JSON.parse(devicesRaw);
  const runtimeDevices = devices.devices?.[runtimeId] || [];
  for (const d of runtimeDevices) {
    if (d.name === SIM_NAME) return d.udid;
  }
  die(`Simulator "${SIM_NAME}" not found. Create: cd qa/ios-visual && npm run sim:create`);
}

function bootSimulator(udid) {
  const raw = execSync("xcrun simctl list devices --json", { encoding: "utf-8" });
  const data = JSON.parse(raw);
  let state = "unknown";
  for (const [_, devs] of Object.entries(data.devices || {})) {
    for (const d of devs) {
      if (d.udid === udid) { state = d.state; break; }
    }
  }

  if (state !== "Booted") {
    log("Booting simulator...");
    simctl("boot", udid);
    for (let i = 0; i < 30; i++) {
      const s = execSync("xcrun simctl list devices --json", { encoding: "utf-8" });
      const dd = JSON.parse(s);
      for (const [_, devs] of Object.entries(dd.devices || {})) {
        for (const d of devs) {
          if (d.udid === udid && d.state === "Booted") {
            log("Simulator booted");
            return;
          }
        }
      }
      sleep(1000);
    }
    die("Simulator failed to boot within 30s");
  }
  log("Simulator already booted");
}

// ── Appium lifecycle ───────────────────────────────────────────────

let appiumProcess = null;
let appiumPort = null;

async function findOrStartAppium() {
  // Try known ports first
  for (const port of [4723, 4724, 4725]) {
    try {
      const r = await httpGet(`http://127.0.0.1:${port}/status`);
      if (r.ok) {
        appiumPort = port;
        log(`Appium found on port ${port}`);
        return;
      }
    } catch {}
  }

  // Start Appium
  appiumPort = await freePort();
  log(`Starting Appium on port ${appiumPort}...`);

  const appiumBin = join(QA_DIR, "node_modules", ".bin", "appium");
  appiumProcess = spawn(appiumBin, [
    "--port", String(appiumPort),
    "--relaxed-security",
    "--base-path", "/",
  ], {
    env: { ...process.env, APPIUM_HOME },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Wait for Appium to be ready
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const r = await httpGet(`http://127.0.0.1:${appiumPort}/status`);
      if (r.ok) {
        log("Appium ready");
        return;
      }
    } catch {}
  }
  die("Appium failed to start within 30s");
}

async function stopAppium() {
  if (appiumProcess) {
    appiumProcess.kill("SIGTERM");
    await sleep(500);
    try { appiumProcess.kill("SIGKILL"); } catch {}
  }
}

// ── WDIO Session ───────────────────────────────────────────────────

async function runSession(udid) {
  log("Creating WDIO session...");

  const browser = await remote({
    logLevel: "warn",
    path: "/",
    port: appiumPort,
    capabilities: {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:deviceName": SIM_NAME,
      "appium:platformVersion": PLATFORM_VERSION,
      "appium:udid": udid,
      browserName: "safari",
      "appium:safariAllowPopups": false,
      "appium:noReset": true,
      "appium:newCommandTimeout": 120,
      "appium:connectHardwareKeyboard": false,
      "appium:forceSimulatorSoftwareKeyboardPresence": true,
      "appium:nativeWebTap": true,
      "appium:nativeWebTapStrict": true,
      "appium:autoAcceptAlerts": true,
      "appium:safariIgnoreFraudWarning": true,
      "appium:webScreenshotMode": "native",
      "appium:useClearTextShortcut": false,
    },
  });

  try {
    // Navigate to dashboard
    log(`Opening ${DASHBOARD_URL}`);
    await browser.url(DASHBOARD_URL);

    // Wait for SPA root
    try {
      await browser.waitUntil(
        async () => {
          const root = await browser.$("#root");
          return root && (await root.isExisting());
        },
        { timeout: 20000, timeoutMsg: "Dashboard root (#root) not found" }
      );
    } catch (e) {
      warn(`Root element wait failed: ${e.message}`);
    }

    await browser.pause(3000);
    log("Dashboard loaded");

    // Dismiss native popups
    try {
      const curCtx = await browser.getContext();
      if (curCtx !== "NATIVE_APP") await browser.switchContext("NATIVE_APP");
      const closeBtn = await browser.$("~Close");
      if (await closeBtn.isExisting()) {
        await closeBtn.click();
        await browser.pause(500);
      }
      if (curCtx !== "NATIVE_APP") await browser.switchContext(curCtx);
    } catch {}

    // Perform action
    const sessionId = process.argv.includes("--session")
      ? process.argv[process.argv.indexOf("--session") + 1]
      : null;
    await performAction(browser, ACTION, sessionId);

    // Take screenshots
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const webPath = join(SCREENSHOT_DIR, `ios-web-${ACTION}-${ts}.png`);
    const nativePath = join(SCREENSHOT_DIR, `ios-native-${ACTION}-${ts}.png`);

    await browser.saveScreenshot(webPath);
    log(`Web screenshot: ${webPath}`);

    try {
      const curCtx = await browser.getContext();
      if (curCtx !== "NATIVE_APP") await browser.switchContext("NATIVE_APP");
      await browser.saveScreenshot(nativePath);
      log(`Native screenshot: ${nativePath}`);
      if (curCtx !== "NATIVE_APP") await browser.switchContext(curCtx);
    } catch {}

    console.log(webPath); // stdout for caller
  } finally {
    await browser.deleteSession();
  }
}

async function performAction(browser, action, extra) {
  log(`Action: ${action}`);

  switch (action) {
    case "focus-input": {
      // Navigate to session detail if session ID provided
      if (extra) {
        const sessionUrl = `${DASHBOARD_URL}/session/${extra}`;
        log(`Navigating to ${sessionUrl}`);
        await browser.url(sessionUrl);
        await browser.pause(2000);
      }

      // Focus the chat textarea via native tap
      const center = await browser.execute(() => {
        const ta = document.querySelector('textarea[placeholder*="Message"]');
        if (!ta) return null;
        const r = ta.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });

      if (center) {
        const curCtx = await browser.getContext();
        await browser.switchContext("NATIVE_APP");
        await browser.execute("mobile: tap", { x: Math.round(center.x), y: Math.round(center.y + 60) });
        await browser.switchContext(curCtx);
        await browser.pause(2000); // wait for keyboard animation

        // Verify keyboard
        const kbVisible = await isKeyboardVisible(browser);
        log(`Keyboard visible: ${kbVisible}`);
      } else {
        warn("Textarea not found — taking idle screenshot");
      }
      break;
    }

    case "idle":
    default:
      await browser.pause(500);
      break;
  }
}

async function isKeyboardVisible(browser) {
  try {
    const curCtx = await browser.getContext();
    if (curCtx !== "NATIVE_APP") await browser.switchContext("NATIVE_APP");
    const keyboards = await browser.$$('-ios class chain:**/XCUIElementTypeKeyboard');
    if (keyboards.length > 0) return true;
    const predKbs = await browser.$$('-ios predicate string:type == "XCUIElementTypeKeyboard"');
    return predKbs.length > 0;
  } catch {
    return false;
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  await checkDashboard();

  if (!existsSync(join(QA_DIR, "node_modules"))) {
    die("qa/ios-visual/node_modules not found. Run: cd qa/ios-visual && npm install");
  }

  const udid = getSimUDID();
  log(`Simulator: ${SIM_NAME} (${udid})`);

  bootSimulator(udid);
  await findOrStartAppium();

  try {
    await runSession(udid);
  } finally {
    await stopAppium();
  }
}

main().catch(e => {
  console.error(`[screenshot:FATAL] ${e.message}`);
  process.exit(1);
});
