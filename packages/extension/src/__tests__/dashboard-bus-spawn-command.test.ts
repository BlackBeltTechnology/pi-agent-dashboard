/**
 * `dashboard-bus.ts spawn --model/--thinking` → BusClient.spawn, printing
 * `spawned <id>` and `warning: <text>`.
 * test-plan: E25. See change: add-spawn-model-choice.
 * Exemplar: packages/bus-client/src/__tests__/spawn-correlation.test.ts (mock bus).
 */
import { describe, expect, it, vi } from "vitest";
import { runSpawnCommand } from "../../.pi/skills/pi-dashboard/scripts/spawn-command.js";

describe("dashboard-bus spawn command", () => {
  it("E25: --model / --thinking reach client.spawn; warning + id are printed", async () => {
    const spawn = vi.fn(async (opts: { onWarning?: (w: string) => void }) => {
      opts.onWarning?.("role 'ghost' not configured yet");
      return "abc123";
    });
    const lines: string[] = [];
    await runSpawnCommand({ spawn } as never, "/p", ["/p", "--model", "@ghost", "--thinking", "low"], (l) => lines.push(l));
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/p", model: "@ghost", thinkingLevel: "low" }));
    expect(lines).toContain("spawned abc123");
    expect(lines).toContain("warning: role 'ghost' not configured yet");
  });

  it("no flags → no model / thinkingLevel keys", async () => {
    const spawn = vi.fn(async (_opts: Record<string, unknown>) => "id");
    await runSpawnCommand({ spawn } as never, "/p", ["/p"], () => undefined);
    const opts = spawn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty("model");
    expect(opts).not.toHaveProperty("thinkingLevel");
  });
});
