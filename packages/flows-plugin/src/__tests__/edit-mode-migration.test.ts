/**
 * One-time legacy migration of plugin-config `editFlow` to the global
 * `flows.editFlow`. See change: stop-flows-edit-mode-project-writes
 * (D6; test-plan #E8, #E9, #X6).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalSettingsPath, migrateLegacyEditFlow } from "../server/edit-mode.js";

let home: string;
let cwd: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "emm-home-"));
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "emm-cwd-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

/** Host-like plugin config: merge by spread, persisted as JSON (drops undefined). */
function fakeCtx(initial: Record<string, unknown>) {
  let persisted = JSON.stringify(initial);
  return {
    persisted: () => JSON.parse(persisted) as Record<string, unknown>,
    getPluginConfig: <T>() => JSON.parse(persisted) as T,
    updatePluginConfig: async (partial: Record<string, unknown>) => {
      persisted = JSON.stringify({ ...JSON.parse(persisted), ...partial });
    },
  };
}

type Global = "unset" | "false" | "unparseable";
const writeGlobal = (g: Global) => {
  if (g === "unset") return;
  fs.mkdirSync(path.dirname(globalSettingsPath(home)), { recursive: true });
  fs.writeFileSync(globalSettingsPath(home), g === "false" ? JSON.stringify({ flows: { editFlow: false } }) : '{"flows":');
};
const readGlobal = () => (fs.existsSync(globalSettingsPath(home)) ? fs.readFileSync(globalSettingsPath(home), "utf-8") : null);

describe("legacy editFlow migration (#E8)", () => {
  const configs: Array<[string, Record<string, unknown>]> = [
    ["true", { editFlow: true }],
    ["false", { editFlow: false }],
    ["absent", {}],
  ];
  const globals: Global[] = ["unset", "false", "unparseable"];
  const rows = configs.flatMap(([n, c]) => globals.map((g) => [n, c, g] as const));

  it.each(rows)("config=%s global=%s", async (name, config, g) => {
    writeGlobal(g);
    const before = readGlobal();
    const ctx = fakeCtx(config);
    await migrateLegacyEditFlow(ctx, { home });
    const after = readGlobal();

    if (name === "true" && g === "unset") {
      expect(JSON.parse(after ?? "{}").flows.editFlow).toBe(true);
      expect("editFlow" in ctx.persisted()).toBe(false);
    } else if (name === "true" && g === "unparseable") {
      expect(after).toBe(before);
      expect(ctx.persisted().editFlow).toBe(true);
    } else {
      expect(after).toBe(before);
      expect("editFlow" in ctx.persisted()).toBe(false);
    }
    expect(fs.existsSync(path.join(cwd, ".pi"))).toBe(false);
  });
});

describe("migration under lock (#E9)", () => {
  it("two concurrent migrations write exactly once", async () => {
    let writes = 0;
    const lockFs = {
      rename: async (a: string, b: string) => {
        writes++;
        await fs.promises.rename(a, b);
      },
    };
    const [a, b] = [fakeCtx({ editFlow: true }), fakeCtx({ editFlow: true })];
    const results = await Promise.all([
      migrateLegacyEditFlow(a, { home, lockFs }),
      migrateLegacyEditFlow(b, { home, lockFs }),
    ]);
    expect(writes).toBe(1);
    expect(results.sort()).toEqual(["cleared", "migrated"]);
    expect(JSON.parse(readGlobal() ?? "{}").flows.editFlow).toBe(true);
  });
});

describe("migration failure keeps the key (#X6)", () => {
  it("io error defers; a healthy second start migrates", async () => {
    const ctx = fakeCtx({ editFlow: true });
    const failing = { writeFile: async () => Promise.reject(Object.assign(new Error("EIO"), { code: "EIO" })) };
    expect(await migrateLegacyEditFlow(ctx, { home, lockFs: failing })).toBe("deferred");
    expect(ctx.persisted().editFlow).toBe(true);
    expect(readGlobal()).toBeNull();

    expect(await migrateLegacyEditFlow(ctx, { home })).toBe("migrated");
    expect("editFlow" in ctx.persisted()).toBe(false);
    expect(JSON.parse(readGlobal() ?? "{}").flows.editFlow).toBe(true);
  });
});
