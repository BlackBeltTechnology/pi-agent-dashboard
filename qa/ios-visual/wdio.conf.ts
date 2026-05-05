import type { Options } from "@wdio/types";

const FIXTURE_MODE = process.env.PI_DASHBOARD_FIXTURE_MODE === "1";
const FIXTURE_URL = process.env.PI_DASHBOARD_FIXTURE_URL || "";
const DEFAULT_URL = "http://127.0.0.1:8000";
const BASE_URL =
  process.env.PI_DASHBOARD_BASE_URL || DEFAULT_URL;
const DEVICE_NAME = process.env.IOS_DEVICE_NAME || "PWA-Test";
const PLATFORM_VERSION = process.env.IOS_PLATFORM_VERSION || "26.4";
const SIM_UDID = process.env.SIM_UDID || undefined;
const AUTO_SAVE_BASELINE =
  process.env.IOS_VISUAL_AUTO_SAVE_BASELINE === "1";
const MISMATCH_PERCENT = process.env.IOS_VISUAL_MISMATCH_PERCENT
  ? parseFloat(process.env.IOS_VISUAL_MISMATCH_PERCENT)
  : 0.5;
const BASELINE_PROFILE =
  process.env.IOS_VISUAL_BASELINE_PROFILE || "default";
const NO_RESET = process.env.IOS_VISUAL_NO_RESET !== "0";
const NEW_COMMAND_TIMEOUT = process.env.IOS_VISUAL_COMMAND_TIMEOUT
  ? parseInt(process.env.IOS_VISUAL_COMMAND_TIMEOUT, 10)
  : 120;
const WDA_LOCAL_PORT = process.env.IOS_VISUAL_WDA_PORT
  ? parseInt(process.env.IOS_VISUAL_WDA_PORT, 10)
  : undefined;

const capabilities: WebdriverIO.Capabilities[] = [
  {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:deviceName": DEVICE_NAME,
    "appium:platformVersion": PLATFORM_VERSION,
    "appium:udid": SIM_UDID,
    browserName: "safari",
    "appium:safariAllowPopups": false,
    "appium:noReset": NO_RESET,
    "appium:newCommandTimeout": NEW_COMMAND_TIMEOUT,
    "appium:connectHardwareKeyboard": false,
    "appium:forceSimulatorSoftwareKeyboardPresence": true,
    "appium:forceTurnOnSoftwareKeyboardSimulator": true,
    "appium:nativeWebTap": true,
    "appium:nativeWebTapStrict": true,
    "appium:autoAcceptAlerts": true,
    "appium:safariIgnoreFraudWarning": true,
    "appium:safariGlobalPreferences": {
      "WBSOnboardingStatesDefaultsKeyV0.2": {
        "TipForMoreButton": 3,
      },
    },
    // Force native screenshot mode to capture iOS keyboard
    "appium:webScreenshotMode": "native",
    // Disable clear shortcut hack — it hides keyboard in headless mode
    "appium:useClearTextShortcut": false,
    ...(WDA_LOCAL_PORT
      ? { "appium:wdaLocalPort": WDA_LOCAL_PORT }
      : {}),
  } as any,
];

export const config: Options.Testrunner = {
  runner: "local",
  // @ts-expect-error autoCompileOpts is valid WDIO runtime config but not in Options.Testrunner types
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      project: "./tsconfig.json",
      transpileOnly: true,
    },
  },

  specs: ["./specs/**/*.spec.ts"],

  maxInstances: 1,
  capabilities,

  logLevel: "warn",
  outputDir: "./.tmp/logs",

  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },

  reporters: ["spec"],

  services: [
    [
      "appium",
      {
        command: "appium",
        args: {
          relaxedSecurity: true,
        },
      },
    ],
    [
      "visual",
      {
        baselineFolder: `./visual/baseline/${BASELINE_PROFILE}`,
        formatImageName: "{tag}",
        screenshotPath: "./visual/.tmp",
        diffPath: "./visual/diff",
        autoSaveBaseline: AUTO_SAVE_BASELINE,
        blockOutStatusBar: true,
        blockOutToolBar: true,
        clearRuntimeFolder: false,
        errorSettings: {
          misMatchPercentage: MISMATCH_PERCENT,
        },
      },
    ],
  ],

  baseUrl: BASE_URL,

  waitforTimeout: 10000,
  waitforInterval: 500,

  beforeSession() {
    if (FIXTURE_MODE) {
      if (!FIXTURE_URL) {
        throw new Error(
          "FIXTURE_MODE is enabled but PI_DASHBOARD_FIXTURE_URL is not set"
        );
      }
      if (BASE_URL !== FIXTURE_URL) {
        throw new Error(
          `Fixture mode requires PI_DASHBOARD_BASE_URL to match PI_DASHBOARD_FIXTURE_URL. ` +
            `Got BASE_URL="${BASE_URL}" but FIXTURE_URL="${FIXTURE_URL}". ` +
            `The dashboard URL must be the owned fixture dashboard, not ${DEFAULT_URL} or another URL.`
        );
      }
    }
  },

  before() {
    // Ensure web screenshots capture native keyboard and web-element clicks use
    // native coordinates so iOS Safari opens the real software keyboard.
    try {
      browser.updateSettings({
        webScreenshotMode: "native",
        useClearTextShortcut: false,
        nativeWebTap: true,
        nativeWebTapStrict: true,
      } as any);
    } catch { /* settings may not be available in all contexts */ }

    // Dismiss any lingering Safari native popups (coachmark, onboarding tips)
    // by briefly switching to NATIVE_APP context and tapping Close if present.
    (browser as any).dismissNativeCoachmark = async function () {
      try {
        const curCtx = (await browser.getContext()) as string;
        if (curCtx !== "NATIVE_APP") {
          await browser.switchContext("NATIVE_APP");
        }
        const closeBtn = await browser.$('~Close');
        if (await closeBtn.isExisting()) {
          await closeBtn.click();
          await browser.pause(500);
        }
        if (curCtx !== "NATIVE_APP") {
          await browser.switchContext(curCtx);
        }
      } catch {
        // Context switch may fail if no NATIVE_APP available — non-fatal
      }
    };
  },
};
