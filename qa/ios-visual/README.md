# iOS Visual Tests (Appium + WebdriverIO)

iOS Simulator Safari visual regression tests for the pi-dashboard PWA.

## Prerequisites (macOS only)

- **Xcode** 16+ with Command Line Tools (`xcode-select --install`)
- **Xcode license** accepted (`sudo xcodebuild -license accept`)
- **Homebrew** — optional but helps with tooling
- **Node.js** 22+ (LTS)
- **iOS Simulator runtime** — iOS 18.2 recommended

## Setup

### 1. Install suite dependencies

```bash
npm --prefix qa/ios-visual install
```

### 2. Install Appium XCUITest driver

The suite uses a project-local `APPIUM_HOME` under `qa/ios-visual/.tmp/appium-home/`. No global Appium or driver install is needed.

```bash
npm run ios-visual:driver:install
```

This installs `appium-xcuitest-driver@10` into `qa/ios-visual/.tmp/appium-home/`.

### 3. Run XCUITest doctor

```bash
npm run ios-visual:doctor
```

Address any warnings about missing prerequisites (Xcode, Carthage, ios-deploy, etc.). The standard fix for most issues:

```bash
brew install carthage ios-deploy applesimutils
```

### 4. Create the test simulator

```bash
npm run ios-visual:sim:create
```

Creates a simulator named `PWA-Test` with `iPhone 16` / iOS `18.2` by default. Override with env vars:

```bash
SIM_NAME=MySim IOS_DEVICE_NAME="iPhone 16 Pro" IOS_PLATFORM_VERSION=18.1 \
  npm run ios-visual:sim:create
```

### 5. Get simulator UDID

```bash
npm run ios-visual:sim:udid
# → SIM_UDID=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```

## Running Visual Tests

### Against your live dashboard (manual mode)

```bash
# Start your dashboard normally, then:
PI_DASHBOARD_BASE_URL=http://127.0.0.1:8000 npm run ios-visual:test
```

Default URL is `http://127.0.0.1:8000`.

### Against the deterministic fixture dashboard (fixture mode)

The fixture launcher starts an isolated dashboard with deterministic state:

```bash
# Full run: fixture + visual test
npm run ios-visual:fixture

# Or: just validate the fixture (no simulator needed)
npm run ios-visual:fixture -- --validate

# Or: start fixture and keep running (manual debugging)
npm run ios-visual:fixture -- --serve
```

Fixture HTTP port: `9800`, pi-gateway port: `9998`. Override with:

```bash
PI_DASHBOARD_FIXTURE_PORT=9900 PI_DASHBOARD_FIXTURE_PI_PORT=9990 \
  npm run ios-visual:fixture
```

## Creating / Updating Baselines

Baselines are stored under `qa/ios-visual/visual/baseline/<profile>/` and tracked in git.

```bash
# Create first baselines against fixture dashboard
npm run ios-visual:baseline:fixture

# Create baselines against your live dashboard
PI_DASHBOARD_BASE_URL=http://127.0.0.1:8000 npm run ios-visual:baseline
```

Normal test runs compare against baselines and fail if mismatch exceeds the configured threshold (default: 0.5%).

## Simulator Reset

For clean visual runs, erase the simulator before testing:

```bash
npm run ios-visual:sim:reset         # Full erase (recommended)
npm run ios-visual:sim:reset -- clear-safari  # Safari data only
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_DASHBOARD_BASE_URL` | `http://127.0.0.1:8000` | Dashboard URL to test |
| `PI_DASHBOARD_FIXTURE_MODE` | (unset) | Set to `1` for fixture mode |
| `PI_DASHBOARD_FIXTURE_URL` | (unset) | Required in fixture mode; must match base URL |
| `SIM_UDID` | (auto-detect) | Direct simulator UDID |
| `IOS_DEVICE_NAME` | `PWA-Test` | Simulator device type name |
| `IOS_PLATFORM_VERSION` | `18.2` | iOS runtime version |
| `IOS_VISUAL_AUTO_SAVE_BASELINE` | (unset) | Set to `1` to auto-save baselines |
| `IOS_VISUAL_MISMATCH_PERCENT` | `0.5` | Mismatch threshold percentage |
| `IOS_VISUAL_BASELINE_PROFILE` | `default` | Baseline subdirectory name |
| `IOS_VISUAL_NO_RESET` | `1` | Set to `0` to reset simulator between runs |
| `PI_DASHBOARD_FIXTURE_PORT` | `9800` | Fixture HTTP port |
| `PI_DASHBOARD_FIXTURE_PI_PORT` | `9998` | Fixture pi-gateway port |

## Fixture Dashboard Mode

The fixture launcher:

1. Creates an isolated `HOME` under `qa/ios-visual/.tmp/fixture/home/`
2. Writes deterministic dashboard config
3. Pre-seeds session metadata files
4. Starts the dashboard from the current checkout on test ports
5. Verifies `/api/health` and SPA HTML at `/`
6. Connects a test-pi bridge that replays production-shaped events
7. Waits for seeded state readiness
8. Runs WDIO visual specs (or validates without simulator)

The fixture dashboard disables:
- Bootstrap/package install
- mDNS advertise and peer discovery
- Plugin loading and bridge registration
- Zrok tunnel and cleanup
- Auth middleware
- Push notifications
- Real session spawning

## Self-Hosted Mac CI

```bash
# 1. Boot simulator
npm run ios-visual:sim:create
SIM_UDID=$(npm run ios-visual:sim:udid --silent | grep SIM_UDID | cut -d= -f2)

# 2. Build client if needed
npm run build

# 3. Run fixture dashboard and visual tests
SIM_UDID=$SIM_UDID npm run ios-visual:fixture

# 4. Clean up
npm run ios-visual:sim:reset
```

## Troubleshooting

**"xcrun: error: unable to find utility simctl"** — Install Xcode Command Line Tools: `xcode-select --install`

**"iOS runtime not found"** — Open Xcode → Settings → Platforms, download the iOS Simulator runtime

**"WDA build failed"** — Run `appium driver doctor xcuitest` and address missing deps

**"SPA not serving dashboard HTML"** — Run `npm run build` first, or ensure Vite dev server is running

**"Port 9800 is in use"** — Set `PI_DASHBOARD_FIXTURE_PORT` to another port
