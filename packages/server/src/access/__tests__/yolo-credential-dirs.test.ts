/**
 * YOLO never auto-allows a credential or browser-profile directory, and never starts with a root
 * that is or contains one (harden-agent-tool-guards D7). Rows T.35, T.73, T.74, T.75
 * (test-plan #E35, #E74, #E75, #E76).
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { browserProfileRoots } from "../forbidden-subjects.js";
import { __resetRefusalLedger, isRefused } from "../refusal-ledger.js";
import { YoloController } from "../yolo-session.js";

let tmp: string;
let home: string;
const MIN = 60_000;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yolo-cred-")));
  home = os.homedir();
  process.env.PI_ACCESS_REFUSALS_STORE = path.join(tmp, "refusals.json");
  __resetRefusalLedger();
});
afterEach(() => {
  delete process.env.PI_ACCESS_REFUSALS_STORE;
  __resetRefusalLedger();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const mk = (base: string, ...segs: string[]) => {
  const p = path.join(base, ...segs);
  fs.mkdirSync(p, { recursive: true });
  return fs.realpathSync(p);
};
const yolo = () =>
  new YoloController({ now: () => 1_000_000, hostGateMode: () => "enforce", isRefused, ladder: async () => [], onLog: () => {} });
const agent = (y: YoloController, p: string) => y.decideAgentPath({ path: p, hostGateMode: "enforce" });

describe("T.35 a root that is or contains a credential dir is refused", () => {
  it("env activation with ~/.config is refused; a control root activates", () => {
    const cfg = mk(home, ".config");
    mk(home, ".config", "gh");
    const y = yolo();
    expect(y.activateFromEnv(JSON.stringify([cfg]))).toEqual({ ok: false, reason: `forbidden root: ${cfg}` });
    expect(y.status()).toBeNull();
    const repo = mk(tmp, "repo");
    expect(y.activateFromEnv(JSON.stringify([repo]))).toMatchObject({ ok: true });
  });

  it("operator activation never offers ~/.config as a root", async () => {
    mk(home, ".config", "gh");
    const app = mk(home, ".config", "app");
    const y = yolo();
    const offered = await y.offerRoots(app);
    expect(offered).toContain(app);
    expect(offered).not.toContain(path.join(home, ".config"));
    expect(await y.activate({ durationMs: 15 * MIN, base: app, root: path.join(home, ".config") })).toEqual({ ok: false, reason: "root-not-offered" });
  });
});

describe("T.73 / T.74 / T.75 auto-allow", () => {
  it("unscoped YOLO never auto-allows credential dirs and a browser profile file; an ordinary file still does (T.75)", async () => {
    const y = yolo();
    expect(y.activateFromEnv("unscoped")).toMatchObject({ ok: true });
    const targets = [
      path.join(mk(home, ".aws"), "credentials"),
      path.join(mk(home, ".kube"), "config"),
      path.join(mk(home, ".docker"), "config.json"),
      path.join(mk(browserProfileRoots(process.platform, home, process.env)[0], "Default"), "Cookies"),
    ];
    for (const t of targets) {
      fs.writeFileSync(t, "x");
      expect(agent(y, t), t).toBeNull();
    }
    const other = mk(tmp, "other");
    fs.writeFileSync(path.join(other, "readme.md"), "x");
    expect(agent(y, path.join(other, "readme.md"))).toBe("auto-allow");
  });

  it("T.74 a symlink inside a scoped root pointing at ~/.aws is not auto-allowed (real path used)", async () => {
    const repo = mk(tmp, "repo");
    const aws = mk(home, ".aws");
    fs.writeFileSync(path.join(aws, "credentials"), "x");
    fs.symlinkSync(aws, path.join(repo, "aws"));
    const y = yolo();
    expect(await y.activate({ durationMs: 15 * MIN, base: repo })).toMatchObject({ ok: true });
    expect(agent(y, path.join(repo, "aws", "credentials"))).toBeNull();
    fs.writeFileSync(path.join(repo, "ok.txt"), "x");
    expect(agent(y, path.join(repo, "ok.txt"))).toBe("auto-allow");
  });

  it("T.75 control: scoped root /w/repo does not cover /w/other (ordinary prompt)", async () => {
    const repo = mk(tmp, "repo");
    const other = mk(tmp, "other");
    fs.writeFileSync(path.join(other, "readme.md"), "x");
    const y = yolo();
    await y.activate({ durationMs: 15 * MIN, base: repo });
    expect(agent(y, path.join(other, "readme.md"))).toBeNull();
  });
});
