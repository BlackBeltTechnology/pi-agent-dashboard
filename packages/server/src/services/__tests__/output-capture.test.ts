/**
 * Output capture of dashboard-started native / attached children
 * (add-services-settings-ui). Test-plan: E16–E20.
 */
import fs from "node:fs";
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { afterEach, describe, expect, it } from "vitest";
import { AttachedDriver } from "../attached-driver.js";
import { OUTPUT_CAP_BYTES, OutputCapture } from "../output-capture.js";
import { servicesPaths } from "../paths.js";
import { makeManager, tmpRoot } from "./helpers.js";
import { cleanup, nativeDefOf, nativeHarness } from "./logs-helpers.js";

const roots: string[] = [];
afterEach(() => cleanup(roots));

describe("E16 — a new start clears the previous output in place", () => {
  it("keeps the inode, mode 0600, and hands the child an O_APPEND descriptor", async () => {
    const h = nativeHarness(nativeDefOf());
    roots.push(...h.roots);
    fs.mkdirSync(h.paths.runDir("docling"), { recursive: true });
    fs.writeFileSync(h.paths.outputLog("docling"), "old 1\nold 2\n".repeat(5));
    const before = fs.statSync(h.paths.outputLog("docling")).ino;
    await h.manager.start("docling");
    const st = fs.statSync(h.paths.outputLog("docling"));
    expect(st.size).toBe(0);
    expect(st.ino).toBe(before);
    expect(st.mode & 0o777).toBe(0o600);
    const opts = h.spawn.mock.calls[0][2] as { stdio: unknown[] };
    expect(opts.stdio[0]).toBe("ignore");
    expect(typeof opts.stdio[1]).toBe("number");
    expect(opts.stdio[2]).toBe(opts.stdio[1]);
  });
});

describe("E17 — cap boundary", () => {
  it("only 1 MiB + 1 is truncated; the next child write lands at offset 0", async () => {
    const h = nativeHarness(nativeDefOf());
    roots.push(...h.roots);
    await h.manager.start("docling");
    const file = h.paths.outputLog("docling");
    for (const [size, truncated] of [[OUTPUT_CAP_BYTES - 1, false], [OUTPUT_CAP_BYTES, false], [OUTPUT_CAP_BYTES + 1, true]] as const) {
      fs.truncateSync(file, size);
      await h.manager.capOutputs();
      expect(fs.statSync(file).size).toBe(truncated ? 0 : size);
    }
    fs.appendFileSync(file, "next line\n"); // what the O_APPEND child would do
    expect(fs.readFileSync(file, "utf8")).toBe("next line\n");
  });
});

describe("E18 — an unleased idle child is capped too", () => {
  it("truncates in place within a sweep, same inode", async () => {
    const h = nativeHarness(nativeDefOf());
    roots.push(...h.roots);
    await h.manager.start("docling");
    expect((await h.manager.status("docling")).leases).toBe(0);
    const file = h.paths.outputLog("docling");
    const ino = fs.statSync(file).ino;
    fs.truncateSync(file, 1.5 * 1024 * 1024);
    await h.manager.capOutputs();
    const st = fs.statSync(file);
    expect([st.size, st.ino]).toEqual([0, ino]);
  });
});

describe("E19 — path fallback is identity-checked", () => {
  const setup = () => {
    const root = tmpRoot("svc-cap-");
    roots.push(root);
    const paths = servicesPaths(root);
    fs.mkdirSync(paths.runDir("svc"), { recursive: true });
    const file = paths.outputLog("svc");
    return { paths, file };
  };

  it("no descriptor held: matching (dev, ino) → truncated by path; differing → untouched", async () => {
    const { paths, file } = setup();
    fs.writeFileSync(file, Buffer.alloc(2048));
    const cap = new OutputCapture(paths, fs, 1024);
    const st = fs.statSync(file);
    expect(await cap.enforceCap("svc", { dev: st.dev, ino: st.ino + 1 })).toBe("untouched");
    expect(fs.statSync(file).size).toBe(2048);
    expect(await cap.enforceCap("svc", { dev: st.dev, ino: st.ino })).toBe("truncated-path");
    expect(fs.statSync(file).size).toBe(0);
  });

  it("no record at all → untouched", async () => {
    const { paths, file } = setup();
    fs.writeFileSync(file, Buffer.alloc(2048));
    expect(await new OutputCapture(paths, fs, 1024).enforceCap("svc", null)).toBe("untouched");
  });

  it("descriptor truncation throws → falls back to the path", async () => {
    const { paths, file } = setup();
    const io = { ...fs, ftruncateSync: () => { throw new Error("EPERM"); } } as unknown as typeof fs;
    const cap = new OutputCapture(paths, io, 1024);
    cap.open("svc");
    fs.appendFileSync(file, Buffer.alloc(2048));
    const st = fs.statSync(file);
    expect(await cap.enforceCap("svc", { dev: st.dev, ino: st.ino })).toBe("truncated-path");
    expect(fs.statSync(file).size).toBe(0);
    cap.closeAll();
  });

  it("checks of one service never run concurrently", async () => {
    const { paths, file } = setup();
    fs.writeFileSync(file, Buffer.alloc(2048));
    const order: string[] = [];
    const io = {
      ...fs,
      statSync: ((f: string) => {
        order.push("stat");
        return fs.statSync(f);
      }) as typeof fs.statSync,
      truncateSync: ((f: string, n: number) => {
        order.push("truncate");
        fs.truncateSync(f, n);
      }) as typeof fs.truncateSync,
    } as unknown as typeof fs;
    const cap = new OutputCapture(paths, io, 1024);
    const st = fs.statSync(file);
    await Promise.all([cap.enforceCap("svc", st), cap.enforceCap("svc", st)]);
    // each check = stat (+ truncate); serialised, the second one finds the file already empty
    expect(order).toEqual(["stat", "truncate", "stat"]);
    expect(fs.statSync(file).size).toBe(0);
  });
});

describe("E20 — a process the dashboard did not start gets no output file", () => {
  it("attached instance adopted as external: no output.log, no start.json", async () => {
    const root = tmpRoot("svc-ext-");
    roots.push(root);
    const def = {
      id: "app",
      mode: "attached",
      endpoints: { http: "http://127.0.0.1:9" },
      process: { name: "app" },
      lifecycle: { start: { linux: ["app"] } },
      health: { kind: "tcp", endpoint: "http" },
      origin: "user",
    } as ServiceDefinition;
    const { writeDefinitions } = await import("./helpers.js");
    writeDefinitions(root, [def]);
    const paths = servicesPaths(root);
    const output = new OutputCapture(paths);
    const attached = new AttachedDriver({ run: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }), platform: "linux", findProcesses: async () => [99], output });
    const h = makeManager(root, { drivers: { attached }, output });
    expect((await h.manager.start("app")).state).toBe("healthy");
    expect(fs.existsSync(paths.outputLog("app"))).toBe(false);
    expect(fs.existsSync(paths.startRecord("app"))).toBe(false);
  });
});
