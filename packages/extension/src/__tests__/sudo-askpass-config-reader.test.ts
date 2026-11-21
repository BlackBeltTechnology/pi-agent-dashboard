/**
 * The live `sudoCredentialPrompt` reader re-reads the config only when its mtime
 * moves (G6 live disable without re-parsing the file on every helper request) and
 * always clamps (G9). See change: add-sudo-credential-prompt.
 */
import { describe, expect, it, vi } from "vitest";
import { createSudoConfigReader } from "../sudo-askpass/config-reader.js";

describe("createSudoConfigReader", () => {
  it("reloads only when the mtime changes, and clamps", () => {
    let raw: unknown = { enabled: true, cacheMinutes: 999 };
    let mtime: number | undefined = 1;
    const load = vi.fn(() => raw);
    const read = createSudoConfigReader({ load, mtimeMs: () => mtime });
    expect(read().cacheMinutes).toBe(60);
    read();
    expect(load).toHaveBeenCalledTimes(1);
    raw = { enabled: false };
    mtime = 2;
    expect(read().enabled).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads every time when the mtime is unreadable; defaults on missing section", () => {
    const load = vi.fn(() => undefined);
    const read = createSudoConfigReader({ load, mtimeMs: () => undefined });
    expect(read()).toEqual({ enabled: true, timeoutMs: 120_000, cacheMinutes: 5 });
    read();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
