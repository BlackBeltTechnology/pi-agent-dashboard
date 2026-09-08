/**
 * E9: `automationRun` is absent from the generic plugin spawn surface.
 *
 * The plugin spawn API carries an opaque `pluginRef` + a generic lifecycle
 * declaration; a plugin's identity travels only inside its own ref. The
 * `automationRun` field the seam used to spell must no longer appear as a
 * declared option on `PluginSpawnOptions`. See change:
 * detach-automation-goal-from-core.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { pluginSpawnToSessionOptions } from "../server/server-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contextSrc = readFileSync(
  path.resolve(__dirname, "..", "server", "server-context.ts"),
  "utf8",
);

describe("plugin spawn surface is generic (E9)", () => {
  it("declares pluginRef + lifecycle, not automationRun", () => {
    // The generic seam fields are present…
    expect(contextSrc).toMatch(/pluginRef\?:\s*Record<string,\s*unknown>/);
    expect(contextSrc).toMatch(/lifecycle\?:\s*PluginSessionLifecycle/);
    // …and `automationRun` is NOT a declared option field on the surface.
    // (It may appear only inside an explanatory comment showing an example
    // ref shape, never as a `automationRun?:` / `automationRun:` field.)
    expect(contextSrc).not.toMatch(/^\s*automationRun\??:/m);
  });

  it("the mapper ignores an automationRun blob and still maps name generically", () => {
    // A JS plugin passing a stray `automationRun` must not crash the total
    // mapper; the name still comes from the generic `name` option.
    const mapped = pluginSpawnToSessionOptions({
      cwd: "/w",
      name: "generic-name",
      // biome-ignore lint/suspicious/noExplicitAny: exercising an untrusted extra field
      automationRun: { name: "legacy", runId: "r" } as any,
    });
    expect(mapped.name).toBe("generic-name");
  });
});
