import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake child factory: an EventEmitter with stdout/stderr streams + a pid.
function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  child.kill = vi.fn();
  return child;
}

const spawnMock = vi.fn();
const execSyncMock = vi.fn();

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/exec.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, spawn: (...a: any[]) => spawnMock(...a), execSync: (...a: any[]) => execSyncMock(...a) };
});

import { _resetNgrokBinaryCache, _setNgrokBinaryAvailable, isNgrokEnrolled, ngrokChildSpec, ngrokConfigCandidates, ngrokRuntime } from "../tunnel-providers/ngrok.js";

beforeEach(() => {
  spawnMock.mockReset();
  execSyncMock.mockReset();
  _resetNgrokBinaryCache();
  _setNgrokBinaryAvailable(true);
});
afterEach(() => vi.restoreAllMocks());

describe("ngrok spec — URL parsing (3.1)", () => {
  it("urlRegex parses the public URL from a json log line", () => {
    const line = '{"lvl":"info","msg":"started tunnel","addr":"http://localhost:8000","url":"https://ab12cd.ngrok-free.app"}';
    const m = line.match(ngrokChildSpec.urlRegex);
    expect(m?.[0]).toBe("https://ab12cd.ngrok-free.app");
  });

  it("urlRegex ignores the localhost addr field", () => {
    const line = '{"addr":"http://localhost:8000","url":"https://x.ngrok-free.app"}';
    expect(line.match(ngrokChildSpec.urlRegex)?.[0]).not.toContain("localhost");
  });

  it("buildArgs uses --log-format json and adds --url for a reserved domain", () => {
    expect(ngrokChildSpec.buildArgs(8000, undefined)).toEqual(["http", "8000", "--log", "stdout", "--log-format", "json"]);
    expect(ngrokChildSpec.buildArgs(8000, "myapp.ngrok.app")).toContain("--url");
    expect(ngrokChildSpec.buildArgs(8000, "myapp.ngrok.app")).toContain("https://myapp.ngrok.app");
  });

  it("mock-spawn: createTunnel resolves the parsed URL", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    // isEnrolled must pass — stub via the spec by spying.
    vi.spyOn(ngrokChildSpec, "isEnrolled").mockReturnValue(true);

    const p = ngrokRuntime.createTunnel(8000, "myapp.ngrok.app");
    // Emit the json log line asynchronously as ngrok would.
    setTimeout(() => {
      child.stdout.emit("data", Buffer.from('{"msg":"started tunnel","url":"https://myapp.ngrok.app"}\n'));
    }, 0);
    const url = await p;
    expect(url).toBe("https://myapp.ngrok.app");
    expect(spawnMock).toHaveBeenCalledWith(expect.stringMatching(/ngrok/), expect.arrayContaining(["http", "8000"]), expect.any(Object));
    await ngrokRuntime.deleteTunnel(8000);
  });
});

describe("ngrok enrollment (3.2)", () => {
  it("candidate config paths include an ngrok.yml", () => {
    const paths = ngrokConfigCandidates("/home/u");
    expect(paths.some((p) => p.endsWith("ngrok.yml"))).toBe(true);
  });

  it("isNgrokEnrolled true only when a config carries authtoken:", async () => {
    const fs = (await import("node:fs")).default;
    vi.spyOn(fs, "readFileSync").mockImplementation((p: any) =>
      String(p).endsWith("ngrok.yml") ? "version: 3\nauthtoken: 2abc_secret\n" : (() => { throw new Error("ENOENT"); })(),
    );
    expect(isNgrokEnrolled()).toBe(true);

    vi.spyOn(fs, "readFileSync").mockImplementation(() => "version: 3\n");
    expect(isNgrokEnrolled()).toBe(false);
  });
});

describe("ngrok reuses child scavenge (3.3)", () => {
  it("scavenges an orphan ngrok process bound to the port", () => {
    execSyncMock.mockReturnValue(
      Buffer.from(
        [
          "5555 ngrok http 8000 --log stdout --log-format json",
          "5556 ngrok http 9000 --log stdout",
          "5557 unrelated",
        ].join("\n"),
      ),
    );
    vi.spyOn(process, "kill").mockReturnValue(true);
    const killed = ngrokRuntime.scavengeOrphans(8000);
    expect(killed).toEqual([5555]);
  });
});
