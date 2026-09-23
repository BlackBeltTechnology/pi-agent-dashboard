/**
 * Fault-injection harness for the clean-prefix QA smoke
 * (qa/tests/35-plugin-install-load.sh).
 *
 * WHY: test-plan rows X8–X11 (tasks 5.16–5.19) are assertions about the smoke
 * itself — an empty prefix must FAIL it, a throwing entry must FAIL it, a
 * dependency-gated plugin must NOT fail it, and a path outside the prefix must
 * FAIL it. Those rows are usually deferred to a VM, which means the guards are
 * only ever exercised on the happy path and can rot into vacuous passes.
 *
 * The smoke's three external touchpoints (`npm`, the `pi-dashboard` launcher,
 * `curl`) are stubbed on PATH, so every guard can be driven deterministically
 * on any machine. What is under test is the smoke's verdict logic; the real
 * install is still what the VM leg runs.
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Derived from THIS file: the suite runs with cwd = scripts/, so process.cwd()
// would resolve the smoke to scripts/qa/tests/... and bash would exit 127.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SMOKE = join(REPO_ROOT, "qa/tests/35-plugin-install-load.sh");

const FAKE_NPM = `#!/bin/sh
echo "fake npm: $*" >&2
exit $FAKE_NPM_EXIT
`;

const FAKE_LAUNCHER = `#!/bin/sh
# A real 'start' both writes the log the smoke reads and is what makes the
# health probe answer; the stub materialises the log so the two stay coherent.
case "$1" in
  start)
    mkdir -p "$HOME/.pi/dashboard"
    if [ -n "$FAKE_LOG_CONTENT" ]; then
      printf '%s\\n' "$FAKE_LOG_CONTENT" > "$HOME/.pi/dashboard/server.log"
    fi
    ;;
esac
exit 0
`;

const FAKE_CURL = `#!/bin/sh
url=""
for a in "$@"; do
  case "$a" in http*) url="$a" ;; esac
done
case "$url" in
  */api/health) printf '%s' "$FAKE_HEALTH_CODE" ;;
  */api/plugins) printf '%s' "$FAKE_PLUGINS_JSON" ;;
esac
exit 0
`;

/**
 * A plugin row as GET /api/plugins reports it.
 *
 * `packageDir` defaults to the sentinel "auto", which `scenario()` resolves to a
 * path inside the generated prefix; pass `null` to omit the field entirely (the
 * pre-`packageDir` server shape) and an absolute path to simulate a plugin that
 * came from somewhere else. `status` is always present, because the API reports
 * load state there and the X11 assertion filters on `status.loaded`.
 */
const row = (id, status, packageDir = "auto") => ({
  id,
  enabled: true,
  loaded: !status?.error,
  packageDir,
  status: { loaded: !status?.error, ...(status ?? {}) },
});

function scenario({ discovered, log, healthCode = "200", npmExit = 0 }) {
  const scratch = mkdtempSync(join(tmpdir(), "qa-smoke-guard-"));
  const bin = join(scratch, "bin");
  const prefix = join(scratch, "prefix");
  mkdirSync(bin, { recursive: true });

  const fixtures = join(scratch, "fixtures");
  mkdirSync(join(fixtures, "package"), { recursive: true });
  const makeTarball = (file, pkg) => {
    writeFileSync(join(fixtures, "package", "package.json"), JSON.stringify(pkg));
    execFileSync("tar", ["-czf", join(fixtures, file), "-C", fixtures, "package"]);
  };
  makeTarball("dashboard.tgz", { name: "@blackbelt-technology/pi-agent-dashboard", version: "0.0.0" });
  makeTarball("plugin.tgz", { name: "@blackbelt-technology/pi-dashboard-browser-plugin", version: "0.0.0" });
  for (const [name, body] of [["npm", FAKE_NPM], ["pi-dashboard", FAKE_LAUNCHER], ["curl", FAKE_CURL]]) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    QA_PREFIX: prefix,
    // The smoke's local-tarball mode unpacks the plugin and identifies specs by
    // reading their package.json, so these must be REAL archives, not just env
    // strings — a registry spec would make `tar -xzOf` fail inside the smoke.
    QA_DASHBOARD_TARBALL: join(fixtures, "dashboard.tgz"),
    QA_PLUGIN_TARBALL: join(fixtures, "plugin.tgz"),
    QA_BOOT_TIMEOUT: "4", // the boot wait is not what these guards test
    FAKE_LOG_CONTENT: log,
    FAKE_HEALTH_CODE: healthCode,
    FAKE_NPM_EXIT: String(npmExit),
    FAKE_PLUGINS_JSON: JSON.stringify({
      // "auto" resolves to a path inside the prefix; `null` drops the field, which
      // is how the X11 assertion catches a server that does not report it at all.
      plugins: discovered.map((p) => ({
        ...p,
        packageDir:
          p.packageDir === null
            ? undefined
            : p.packageDir === "auto"
              ? join(prefix, ".pi/dashboard/plugins", p.id)
              : p.packageDir,
      })),
    }),
  };

  let stdout = "";
  let code = 0;
  try {
    stdout = execFileSync("bash", [SMOKE], { encoding: "utf-8", env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    stdout = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    code = err.status ?? 1;
  }

  const configPath = join(prefix, ".pi/dashboard/config.json");
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : null;
  return { code, stdout, config, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
}

const LOADED = '[plugin-loader] Loaded plugin "browser"';
const DISCOVERY_18 = "[plugin-loader] discovered 18 plugin(s): apple-tools, browser, kb";

describe("clean-prefix smoke guards (X8–X11)", () => {
  it("X7/X9: the happy path PASSES, and the second boot had browser enabled", () => {
    const r = scenario({ discovered: [row("apple-tools"), row("browser")], log: `${DISCOVERY_18}\n${LOADED}` });
    try {
      expect(r.stdout).toContain("PASS: clean-prefix plugin install-load (X7-X11)");
      expect(r.code).toBe(0);
      // X9: the enable-all config is written between the two boots — without it
      // the defaultEnabled:false plugin is never attempted and the run is vacuous.
      expect(r.config?.plugins?.browser?.enabled).toBe(true);
      expect(r.config?.plugins?.["apple-tools"]?.enabled).toBe(true);
    } finally {
      r.cleanup();
    }
  });

  it("X8: an empty prefix FAILS on the non-empty-discovery guard", () => {
    const r = scenario({ discovered: [], log: DISCOVERY_18 });
    try {
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("no plugins discovered");
      expect(r.stdout).not.toContain("PASS: clean-prefix");
    } finally {
      r.cleanup();
    }
  });

  it("X8: a prefix without the plugin FAILS rather than passing on other plugins", () => {
    const r = scenario({ discovered: [row("apple-tools"), row("kb")], log: `${DISCOVERY_18}` });
    try {
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("browser is NOT in the discovered set");
    } finally {
      r.cleanup();
    }
  });

  it("X9: a throwing server entry FAILS — being enabled is what surfaces it", () => {
    // The plugin is discovered and the smoke enables it, but the load throws.
    const r = scenario({ discovered: [row("browser")], log: `${DISCOVERY_18}\n[plugin-loader] Failed to load plugin "browser": boom` });
    try {
      expect(r.code).toBe(1);
      expect(r.stdout).toContain('log has no \'Loaded plugin "browser"\'');
      expect(r.config?.plugins?.browser?.enabled).toBe(true);
    } finally {
      r.cleanup();
    }
  });

  it("X10: a dependency-gated plugin (loaded:false, no error) does NOT fail the smoke", () => {
    // The loader legitimately reports loaded:false for a missing/disabled dep or
    // an unmet requirement. Only `status.error` means the load actually failed.
    const r = scenario({
      discovered: [
        row("browser"),
        { id: "gated", enabled: false, loaded: false, packageDir: null, status: { loaded: false, enabled: false } },
      ],
      log: `${DISCOVERY_18}\n${LOADED}\n[plugin-loader] Skipped plugin "gated": unsatisfied requirement r`,
    });
    try {
      expect(r.stdout).toContain("PASS: clean-prefix plugin install-load (X7-X11)");
      expect(r.code).toBe(0);
    } finally {
      r.cleanup();
    }
  });

  it("X10: a plugin that reports status.error DOES fail the smoke", () => {
    const r = scenario({
      discovered: [row("browser"), row("broken", { error: "Cannot find module '@isomorphic/manualPromise'" })],
      log: `${DISCOVERY_18}\n${LOADED}`,
    });
    try {
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("plugin(s) reported a load error");
      expect(r.stdout).toContain("@isomorphic/manualPromise");
    } finally {
      r.cleanup();
    }
  });

  it("X11: a LOADED plugin whose packageDir is outside the prefix FAILS", () => {
    // The hole this assertion closes: a checkout-sourced plugin that wins
    // discovery by id loads cleanly and names no path in the log, so the log
    // scan alone reports a clean run over the wrong tree.
    const r = scenario({
      discovered: [row("browser", undefined, "/opt/other/checkout/packages/browser-plugin")],
      log: `${DISCOVERY_18}\n${LOADED}`,
    });
    try {
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("outside the install prefix (wrong-tree contamination)");
      expect(r.stdout).toContain("/opt/other/checkout/packages/browser-plugin");
    } finally {
      r.cleanup();
    }
  });

  it("X11: a LOADED plugin with NO packageDir FAILS (never silently passes)", () => {
    const r = scenario({
      discovered: [{ id: "browser", enabled: true, loaded: true, packageDir: null, status: { loaded: true } }],
      log: `${DISCOVERY_18}\n${LOADED}`,
    });
    try {
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("<missing packageDir>");
    } finally {
      r.cleanup();
    }
  });

  it("X11: a plugin path outside the install prefix FAILS (wrong-tree contamination)", () => {
    // Exactly the contamination this change's guards exist for: plugin discovery
    // walking up into a monorepo checkout instead of the install.
    const r = scenario({
      discovered: [row("browser")],
      log: `${DISCOVERY_18}\n${LOADED}\n[plugin-loader] resolved /opt/other/checkout/plugins/browser/index.js`,
    });
    try {
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("plugin path outside the install prefix appeared in the log");
    } finally {
      r.cleanup();
    }
  });

  it("a failed install FAILS loudly instead of degrading into a vacuous pass", () => {
    const r = scenario({ discovered: [row("browser")], log: LOADED, npmExit: 1 });
    try {
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("FAIL: npm install");
    } finally {
      r.cleanup();
    }
  });

  it("a server that never answers health FAILS rather than timing out silently", () => {
    const r = scenario({ discovered: [row("browser")], log: LOADED, healthCode: "503" });
    try {
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("never answered 200");
    } finally {
      r.cleanup();
    }
  });
});
