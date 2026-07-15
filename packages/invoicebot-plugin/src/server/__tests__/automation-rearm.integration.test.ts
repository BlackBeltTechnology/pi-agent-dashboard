/**
 * Integration: a flip written by the invoicebot flip helper is honored live by
 * the running automation-plugin scheduler — its filesystem watcher re-scans and
 * re-arms within the debounce window, with no reload. Enable arms the trigger;
 * disable disarms it. Faux, zero-network (real fs.watch + real scheduler; no LLM,
 * no HTTP).
 *
 * NOTE on repeated flips: the helper writes atomically (tmp + rename), which
 * replaces the file inode. Node's recursive fs.watch tracks only the first
 * change after each attach, so the automation-plugin's production wiring
 * (`index.ts` `attachWatchers()`) periodically re-attaches on activity. The
 * test models that faithfully by re-attaching the watcher between the enable
 * and disable flips — consistent with design D5's eventual-consistency.
 * See change: surface-automation-enable (tasks §4.5).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAutomationWatcher } from "../../../../automation-plugin/src/server/automation-watcher.js";
import { scanAutomations } from "../../../../automation-plugin/src/server/scanner.js";
import { createScheduler } from "../../../../automation-plugin/src/server/scheduler.js";
import { scheduleTrigger } from "../../../../automation-plugin/src/server/schedule-trigger.js";
import { TriggerRegistry } from "../../../../automation-plugin/src/server/trigger-registry.js";
import { flipAutomationDisabled } from "../automation-toggle.js";

const INTAKE_YAML = `on:
  kind: schedule
  cron: "*/2 * * * *"
action:
  kind: flows.run
  payload:
    flow: invoicebot:process
model: "@fast"
mode: local
concurrency: skip
disabled: true
`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "ib-rearm-"));
  const dir = join(cwd, ".pi", "automation", "invoicebot-intake");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "automation.yaml"), INTAKE_YAML);
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("scheduler re-arm after flip (watcher-driven, no reload)", () => {
  it("enable arms the trigger; disable disarms it, within the watcher debounce window", async () => {
    const registry = new TriggerRegistry();
    registry.register(scheduleTrigger);
    const knownKinds = registry.kinds();
    // The intake automation's action is `flows.run` (a plugin-registered id).
    const knownActionIds = new Set(["flows.run"]);

    const scheduler = createScheduler({ registry, onFire: () => {} });
    // Prime from the initial (disabled) scan → nothing armed.
    scheduler.armAll(scanAutomations({ repoRoot: cwd, scanFolder: true }, knownKinds, knownActionIds));
    expect(scheduler.armedKeys()).toEqual([]);

    // The watcher re-scans + re-arms on any automation.yaml write.
    const watcher = createAutomationWatcher({
      onChange: (scopeBase) => {
        scheduler.armAll(scanAutomations({ repoRoot: scopeBase, scanFolder: true }, knownKinds, knownActionIds));
      },
      debounceMs: 60,
      logger: () => {},
    });
    // Mirrors production `attachWatchers()`: (re)attach the recursive watch so
    // the next atomic-rename write is tracked.
    const attach = () => {
      watcher.detachAll();
      expect(watcher.attach(cwd)).toBe(true);
    };
    attach();

    try {
      // Enable → helper writes disabled:false → watcher fires → scheduler arms.
      flipAutomationDisabled(cwd, "invoicebot-intake", true);
      await wait(400);
      expect(scheduler.armedKeys()).toEqual(["folder:invoicebot-intake"]);

      // Re-attach (as production does on activity) before the next flip: the
      // prior atomic rename replaced the inode the watch was tracking.
      attach();

      // Disable → helper writes disabled:true → watcher fires → scheduler disarms.
      flipAutomationDisabled(cwd, "invoicebot-intake", false);
      await wait(400);
      expect(scheduler.armedKeys()).toEqual([]);
    } finally {
      watcher.detachAll();
      scheduler.disposeAll();
    }
  });
});
