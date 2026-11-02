/**
 * pi-agent credential files (`auth.json`, `mcp-auth.json`, `providers.json`, `plugin-credentials.json`,
 * `models.json`, `mcp.json`, `system-one/auth.json`) join the dashboard-state guard's ALWAYS-refused tier:
 * the name set and its `<name>.*` sibling rule, the agent-dir set (server env ∪ `<home>/.pi/agent`), the
 * case rule (volume probe), the post-open (dev, ino) recheck and the plugin seam `readFileGuarded`.
 *
 * See change: close-security-map-high-findings
 * (D1; test-plan #E19–#E23, #E27–#E29, #E34–#E36, #P2, #X12, #X13, #X15).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetCredentialVolumeProbes,
  DashboardStateRefused,
  dashboardStateRefuses,
  isAgentCredentialFileSync,
  isDashboardStatePath,
  openStateChecked,
  readFileGuarded,
  readFileStateChecked,
  runWithStateCaller,
} from "../lib/dashboard-state-guard.js";

const NAMES = ["auth.json", "mcp-auth.json", "providers.json", "plugin-credentials.json", "models.json", "mcp.json", "system-one/auth.json"];
const MARK = "CRED-MARKER-77c1";

let home: string;
let origHome: string | undefined;
let origAgentEnv: string | undefined;
const agent = () => path.join(home, ".pi", "agent");
const dash = () => path.join(home, ".pi", "dashboard");

/** Does `dir` (a real, empty tmp dir) sit on a case-sensitive volume? */
function volumeIsCaseSensitive(dir: string): boolean {
  const probe = path.join(dir, "CaSeProbe");
  fs.writeFileSync(probe, "x");
  const sensitive = !fs.existsSync(path.join(dir, "caseprobe"));
  fs.rmSync(probe);
  return sensitive;
}
const tmpRoot = fs.realpathSync(os.tmpdir());
const SENSITIVE_VOLUME = (() => {
  const d = fs.mkdtempSync(path.join(tmpRoot, "cs-probe-"));
  try {
    return volumeIsCaseSensitive(d);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
})();

const write = (p: string, body = MARK) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

beforeEach(() => {
  origHome = process.env.HOME;
  origAgentEnv = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cred-guard-")));
  process.env.HOME = home;
  for (const n of NAMES) write(path.join(agent(), n));
  write(path.join(dash(), "config.json"), "{}");
  write(path.join(home, "notes.txt"), "n");
  __resetCredentialVolumeProbes();
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOME = origHome;
  if (origAgentEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = origAgentEnv;
  try {
    fs.chmodSync(agent(), 0o755);
  } catch {
    /* gone */
  }
  fs.rmSync(home, { recursive: true, force: true });
});

describe("E19 — name-set boundary (the sibling rule)", () => {
  const refusedNames = [
    "auth.json",
    "auth.json.",
    "auth.json.x",
    "auth.json.corrupt-20260101T000000Z",
    "models.json.d",
    "system-one/auth.json",
    "system-one/auth.json.bak",
    "mcp-auth.json.bak",
    "providers.json.tmp",
    "plugin-credentials.json.corrupt-1",
    "mcp.json.x",
  ];
  const admittedNames = [
    "auth.jsonx",
    "auth.json~",
    ".auth.json",
    "xauth.json",
    "skills/x/auth.json",
    "system-one/other.json",
    "settings.json",
    "trust.json",
  ];

  it.each(refusedNames)("%s in the agent dir is always refused (every caller, no caller)", async (name) => {
    const target = path.join(agent(), name);
    expect(await isDashboardStatePath(target)).toBe("always");
    expect(await dashboardStateRefuses(target)).toBe(true);
    const admittedCaller = { gatedAdmitted: () => true, unproven: () => false };
    await runWithStateCaller(admittedCaller, async () => expect(await dashboardStateRefuses(target)).toBe(true));
  });

  it.each(admittedNames)("%s is admitted exactly as before (no over-refusal)", async (name) => {
    expect(await isDashboardStatePath(path.join(agent(), name))).toBeNull();
    expect(await dashboardStateRefuses(path.join(agent(), name))).toBe(false);
  });

  it("`~/.pi/auth.json` (not in the agent dir) is admitted", async () => {
    expect(await isDashboardStatePath(path.join(home, ".pi", "auth.json"))).toBeNull();
  });

  it("every one of the seven names is refused, in the agent dir only", async () => {
    for (const n of NAMES) {
      expect(await dashboardStateRefuses(path.join(agent(), n)), n).toBe(true);
      expect(await dashboardStateRefuses(path.join(home, "proj", n)), `proj/${n}`).toBe(false);
    }
  });

  it("the synchronous grep predicate agrees on names and siblings, and sees a symlinked credential", () => {
    expect(isAgentCredentialFileSync(path.join(agent(), "auth.json"))).toBe(true);
    expect(isAgentCredentialFileSync(path.join(agent(), "models.json"))).toBe(true);
    write(path.join(agent(), "mcp.json.bak"));
    expect(isAgentCredentialFileSync(path.join(agent(), "mcp.json.bak"))).toBe(true);
    expect(isAgentCredentialFileSync(path.join(agent(), "settings.json"))).toBe(false);
    expect(isAgentCredentialFileSync(path.join(home, "notes.txt"))).toBe(false);
    fs.mkdirSync(path.join(home, "proj"));
    fs.symlinkSync(path.join(agent(), "auth.json"), path.join(home, "proj", "auth.json"));
    expect(isAgentCredentialFileSync(path.join(home, "proj", "auth.json"))).toBe(true); // name + realpath compare
    write(path.join(home, "proj", "plain", "auth.json"));
    expect(isAgentCredentialFileSync(path.join(home, "proj", "plain", "auth.json"))).toBe(false);
  });
});

describe("E20 — a directory named like a credential: only the entry itself is refused", () => {
  it("children are admitted by name; the directory entries themselves are refused; a hard link to the inode is caught by identity", async () => {
    write(path.join(agent(), "models.json.d", "frag.json"), "frag");
    write(path.join(agent(), "auth.json.bak", "x.txt"), "x");
    expect(await dashboardStateRefuses(path.join(agent(), "models.json.d", "frag.json"))).toBe(false);
    expect(await dashboardStateRefuses(path.join(agent(), "auth.json.bak", "x.txt"))).toBe(false);
    expect(await dashboardStateRefuses(path.join(agent(), "models.json.d"))).toBe(true);
    expect(await dashboardStateRefuses(path.join(agent(), "auth.json.bak"))).toBe(true);

    // A hard link NAMED like an admitted child but sharing the credential's inode.
    fs.rmSync(path.join(agent(), "models.json.d", "frag.json"));
    fs.linkSync(path.join(agent(), "auth.json"), path.join(agent(), "models.json.d", "frag.json"));
    expect(await dashboardStateRefuses(path.join(agent(), "models.json.d", "frag.json"))).toBe(false); // path-level: admitted…
    await expect(openStateChecked(path.join(agent(), "models.json.d", "frag.json"))).rejects.toBeInstanceOf(DashboardStateRefused); // …identity: refused
  });
});

describe("E21 — a relocated agent directory is covered", () => {
  it("relocated + default credential files are refused; whitespace/unset → default only", async () => {
    const relocated = path.join(home, "srv", "pi-agent");
    write(path.join(relocated, "auth.json"));
    write(path.join(relocated, "auth.json.bak"));
    process.env.PI_CODING_AGENT_DIR = relocated;
    for (const p of [path.join(relocated, "auth.json"), path.join(relocated, "auth.json.bak"), path.join(agent(), "auth.json")]) {
      expect(await dashboardStateRefuses(p), p).toBe(true);
    }
    process.env.PI_CODING_AGENT_DIR = "   ";
    expect(await dashboardStateRefuses(path.join(relocated, "auth.json"))).toBe(false);
    expect(await dashboardStateRefuses(path.join(agent(), "auth.json"))).toBe(true);
    delete process.env.PI_CODING_AGENT_DIR;
    expect(await dashboardStateRefuses(path.join(relocated, "auth.json"))).toBe(false);
    expect(await dashboardStateRefuses(path.join(agent(), "auth.json"))).toBe(true);
  });

  it("a `~/…` value is tilde-expanded; a trailing slash is the same directory", async () => {
    write(path.join(home, "alt-agent", "models.json"));
    process.env.PI_CODING_AGENT_DIR = "~/alt-agent";
    expect(await dashboardStateRefuses(path.join(home, "alt-agent", "models.json"))).toBe(true);
    process.env.PI_CODING_AGENT_DIR = `${path.join(home, "alt-agent")}${path.sep}`;
    expect(await dashboardStateRefuses(path.join(home, "alt-agent", "models.json"))).toBe(true);
  });

  it("a symlinked agent dir is refused under both the link and the real spelling", async () => {
    write(path.join(home, "real-agent", "auth.json"));
    fs.symlinkSync(path.join(home, "real-agent"), path.join(home, "link-agent"));
    process.env.PI_CODING_AGENT_DIR = path.join(home, "link-agent");
    expect(await dashboardStateRefuses(path.join(home, "link-agent", "auth.json"))).toBe(true);
    expect(await dashboardStateRefuses(path.join(home, "real-agent", "auth.json"))).toBe(true);
  });
});

describe("E22 — the agent-dir set follows HOME / PI_CODING_AGENT_DIR (no stale cache)", () => {
  it("refusal follows the live env", async () => {
    const a = path.join(home, "srv", "a");
    const b = path.join(home, "srv", "b");
    write(path.join(a, "auth.json"));
    write(path.join(b, "auth.json"));
    process.env.PI_CODING_AGENT_DIR = a;
    expect(await dashboardStateRefuses(path.join(a, "auth.json"))).toBe(true);
    process.env.PI_CODING_AGENT_DIR = b;
    expect(await dashboardStateRefuses(path.join(b, "auth.json"))).toBe(true);
    expect(await dashboardStateRefuses(path.join(a, "auth.json"))).toBe(false); // no stale entry, no over-refusal
    delete process.env.PI_CODING_AGENT_DIR;
    expect(await dashboardStateRefuses(path.join(agent(), "auth.json"))).toBe(true);

    const home2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cred-guard2-")));
    try {
      write(path.join(home2, ".pi", "agent", "auth.json"));
      process.env.HOME = home2;
      expect(await dashboardStateRefuses(path.join(home2, ".pi", "agent", "auth.json"))).toBe(true);
      expect(await dashboardStateRefuses(path.join(agent(), "auth.json"))).toBe(false); // the first home's default left the set (no stale cache)
    } finally {
      fs.rmSync(home2, { recursive: true, force: true });
    }
  });
});

describe("E23 — a session-side PI_CODING_AGENT_DIR override is a documented residual", () => {
  it("server env unset: `/elsewhere/auth.json` (a session's own agent dir) is NOT refused", async () => {
    const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "elsewhere-")));
    try {
      write(path.join(elsewhere, "auth.json"));
      expect(await dashboardStateRefuses(path.join(elsewhere, "auth.json"))).toBe(false);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe("E34 / E35 / E36 — the case rule (volume probe)", () => {
  /** Spy `fs.promises.stat`: the swapped-case agent dir (`.pi/AGENT`) answers via `swapped`, everything else is real. */
  function probeSpy(swapped: (realStat: typeof fsp.stat) => Promise<unknown>, alsoFail: string[] = []) {
    const realStat = fsp.stat.bind(fsp);
    const calls: string[] = [];
    vi.spyOn(fsp, "stat").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
      const s = String(p);
      if (s === path.join(home, ".pi", "AGENT")) {
        calls.push(s);
        return swapped(realStat as never);
      }
      if (alsoFail.includes(s)) {
        calls.push(s);
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return (realStat as (...a: unknown[]) => Promise<fs.Stats>)(p, ...rest);
    }) as never);
    return calls;
  }

  it("E34 case-sensitive volume (probe ENOENT): `Auth.json` is a distinct file, not refused by name; a hard link to the inode IS (identity)", async () => {
    probeSpy(async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    // (names that exist in no case: a folding host's `realpath` would otherwise canonicalize `Auth.json`)
    expect(await dashboardStateRefuses(path.join(agent(), "Auth.json.bak"))).toBe(false);
    expect(await dashboardStateRefuses(path.join(agent(), "MODELS.json.corrupt"))).toBe(false);
    expect(await dashboardStateRefuses(path.join(agent(), "auth.json"))).toBe(true); // exact name unaffected
    // A link NAMED `Auth.json` elsewhere shares the inode: admitted by name, refused after open.
    fs.mkdirSync(path.join(home, "proj"));
    fs.linkSync(path.join(agent(), "auth.json"), path.join(home, "proj", "Auth.json"));
    expect(await dashboardStateRefuses(path.join(home, "proj", "Auth.json"))).toBe(false);
    await expect(openStateChecked(path.join(home, "proj", "Auth.json"))).rejects.toBeInstanceOf(DashboardStateRefused);
  });

  it.skipIf(!SENSITIVE_VOLUME)("E34 real case-sensitive volume: a distinct `Auth.json` is admitted, `auth.json` refused", async () => {
    write(path.join(agent(), "Auth.json"), "distinct");
    expect(await dashboardStateRefuses(path.join(agent(), "Auth.json"))).toBe(false);
    expect(await dashboardStateRefuses(path.join(agent(), "auth.json"))).toBe(true);
    expect(await readFileStateChecked(path.join(agent(), "Auth.json"), "utf-8")).toBe("distinct");
  });

  it("E35 case-folding volume (probe returns the same dev/ino): `AUTH.JSON` and `Models.Json.Bak` are refused", async () => {
    probeSpy(async (realStat) => realStat(agent()));
    expect(await dashboardStateRefuses(path.join(agent(), "AUTH.JSON"))).toBe(true);
    expect(await dashboardStateRefuses(path.join(agent(), "Models.Json.Bak"))).toBe(true);
    expect(await dashboardStateRefuses(path.join(agent(), "SETTINGS.JSON"))).toBe(false); // folding does not widen the set
  });

  it.skipIf(SENSITIVE_VOLUME)("E35 real case-folding volume: `AUTH.JSON` IS `auth.json`", async () => {
    expect(await dashboardStateRefuses(path.join(agent(), "AUTH.JSON"))).toBe(true);
    expect(await dashboardStateRefuses(path.join(agent(), "Models.Json.Bak"))).toBe(true);
  });

  it("E36 a probe failure (EACCES) counts as folding; one probe per directory, cached across requests", async () => {
    const calls = probeSpy(async () => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    });
    expect(await dashboardStateRefuses(path.join(agent(), "Auth.json.bak"))).toBe(true);
    expect(await dashboardStateRefuses(path.join(agent(), "Auth.json.bak"))).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("E36 ENOENT on both the swapped name and the directory counts as folding", async () => {
    const calls = probeSpy(
      async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      [agent()],
    );
    expect(await dashboardStateRefuses(path.join(agent(), "Auth.json.bak"))).toBe(true);
    expect(await dashboardStateRefuses(path.join(agent(), "Auth.json.bak"))).toBe(true);
    expect(calls.filter((c) => c.endsWith("AGENT"))).toHaveLength(1);
  });
});

describe("P2 — per-open guard overhead is structurally bounded", () => {
  it("≤ 1 readdir of the agent dir per open; the volume probe ≤ 1 per dir; path-level checks list nothing", async () => {
    const realReaddir = fsp.readdir.bind(fsp);
    let agentListings = 0;
    vi.spyOn(fsp, "readdir").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p) === agent()) agentListings++;
      return (realReaddir as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
    }) as never);
    const realStat = fsp.stat.bind(fsp);
    let probes = 0;
    vi.spyOn(fsp, "stat").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p) === path.join(home, ".pi", "AGENT")) probes++;
      return (realStat as (...a: unknown[]) => Promise<fs.Stats>)(p, ...rest);
    }) as never);

    for (let i = 0; i < 100; i++) await dashboardStateRefuses(path.join(home, "notes.txt"));
    expect(agentListings).toBe(0); // path-level decisions never list the directory
    for (let i = 0; i < 100; i++) expect(await readFileStateChecked(path.join(home, "notes.txt"), "utf-8")).toBe("n");
    expect(agentListings).toBeLessThanOrEqual(100); // ≤ 1 per open
    expect(agentListings).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) await dashboardStateRefuses(path.join(agent(), "Auth.json.bak")); // case-only match needs the probe
    expect(probes).toBe(1);
  });
});

describe.skipIf(process.getuid?.() === 0)("X12 — the guard degrades safely when the agent dir cannot be listed", () => {
  it("EACCES readdir: no throw; named files still refused; non-credential admitted", async () => {
    write(path.join(agent(), "skills", "x", "SKILL.md"), "# s");
    fs.chmodSync(agent(), 0o000);
    expect(await dashboardStateRefuses(path.join(agent(), "auth.json"))).toBe(true);
    expect(await dashboardStateRefuses(path.join(agent(), "auth.json.bak"))).toBe(true); // by name, no listing needed
    expect(await dashboardStateRefuses(path.join(agent(), "skills", "x", "SKILL.md"))).toBe(false);
    await expect(readFileStateChecked(path.join(home, "notes.txt"), "utf-8")).resolves.toBe("n"); // post-open recheck: no 500
  });
});

describe("X12 — the directory vanishes between the name match and readdir", () => {
  it("a readdir failure is best-effort: opens still succeed for ordinary files, credentials still refused", async () => {
    vi.spyOn(fsp, "readdir").mockImplementation((async (p: fs.PathLike) => {
      if (String(p).startsWith(agent())) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return [];
    }) as never);
    await expect(readFileStateChecked(path.join(home, "notes.txt"), "utf-8")).resolves.toBe("n");
    await expect(openStateChecked(path.join(agent(), "auth.json"))).rejects.toBeInstanceOf(DashboardStateRefused); // the named file is still stat'ed
    expect(await dashboardStateRefuses(path.join(agent(), "models.json"))).toBe(true);
  });
});

describe("X13 — the credential file or its parent swapped after the check", () => {
  it("`D/auth.json` admitted by the path check; D then becomes a symlink to the agent dir: the handle matches, refused", async () => {
    write(path.join(home, "D", "auth.json"), "decoy");
    expect(await dashboardStateRefuses(path.join(home, "D", "auth.json"))).toBe(false);
    fs.renameSync(path.join(home, "D"), path.join(home, "D.orig"));
    fs.symlinkSync(agent(), path.join(home, "D"));
    await expect(openStateChecked(path.join(home, "D", "auth.json"))).rejects.toBeInstanceOf(DashboardStateRefused);
  });

  it("a decoy swapped for a symlink / hard link to a sibling credential (`auth.json.bak`) is refused", async () => {
    write(path.join(agent(), "auth.json.corrupt-1"));
    write(path.join(home, "decoy.txt"), "d");
    fs.rmSync(path.join(home, "decoy.txt"));
    fs.linkSync(path.join(agent(), "auth.json.corrupt-1"), path.join(home, "decoy.txt"));
    await expect(openStateChecked(path.join(home, "decoy.txt"))).rejects.toBeInstanceOf(DashboardStateRefused);
  });
});

describe("X14 — a missing credential file (fresh install) is refused on its name", () => {
  it("no `auth.json` on disk: still refused (never a signal distinguishing absence from presence)", async () => {
    fs.rmSync(path.join(agent(), "auth.json"));
    expect(await dashboardStateRefuses(path.join(agent(), "auth.json"))).toBe(true);
    expect(await dashboardStateRefuses(path.join(agent(), "nosuchfile.json"))).toBe(false);
  });
});

describe("E27 — readFileGuarded refuses a credential file, a symlink and a hard link", () => {
  it("resolves null for all three (no bytes)", async () => {
    fs.mkdirSync(path.join(home, "proj"));
    fs.symlinkSync(path.join(agent(), "auth.json"), path.join(home, "proj", "link"));
    fs.linkSync(path.join(agent(), "auth.json"), path.join(home, "proj", "hl"));
    for (const p of [path.join(agent(), "auth.json"), path.join(home, "proj", "link"), path.join(home, "proj", "hl")]) {
      expect(await readFileGuarded(p), p).toBeNull();
    }
  });
});

describe("E28 — readFileGuarded follows the request caller for the trust-gated tier", () => {
  it("unproven → null; trusted → content; no caller (internal) → content", async () => {
    const cfg = path.join(dash(), "config.json");
    write(cfg, "CFG");
    const unproven = { gatedAdmitted: () => false, unproven: () => true };
    const trusted = { gatedAdmitted: () => true, unproven: () => false };
    expect(await runWithStateCaller(unproven, () => readFileGuarded(cfg))).toBeNull();
    expect(await runWithStateCaller(trusted, () => readFileGuarded(cfg))).toBe("CFG");
    expect(await readFileGuarded(cfg)).toBe("CFG");
    write(path.join(dash(), "local", "token"), "T");
    expect(await runWithStateCaller(trusted, () => readFileGuarded(path.join(dash(), "local", "token")))).toBeNull(); // always tier
  });
});

describe("E29 — readFileGuarded: ordinary files and every other failure", () => {
  it("ordinary and non-UTF-8 files resolve a string; missing → ENOENT, directory → EISDIR (NOT null)", async () => {
    expect(await readFileGuarded(path.join(home, "notes.txt"))).toBe("n");
    fs.writeFileSync(path.join(home, "bin.txt"), Buffer.from([0xff, 0xfe, 0x41]));
    expect(typeof (await readFileGuarded(path.join(home, "bin.txt")))).toBe("string");
    await expect(readFileGuarded(path.join(home, "missing.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    fs.mkdirSync(path.join(home, "adir"));
    await expect(readFileGuarded(path.join(home, "adir"))).rejects.toMatchObject({ code: "EISDIR" });
  });

  it.skipIf(process.getuid?.() === 0)("an unreadable file rejects EACCES", async () => {
    write(path.join(home, "locked.txt"), "x");
    fs.chmodSync(path.join(home, "locked.txt"), 0o000);
    await expect(readFileGuarded(path.join(home, "locked.txt"))).rejects.toMatchObject({ code: "EACCES" });
  });
});

describe("X15 — readFileGuarded: a swap after the real-path decision", () => {
  it.each([
    ["symlink", (p: string, cred: string) => fs.symlinkSync(cred, p)],
    ["hard link", (p: string, cred: string) => fs.linkSync(cred, p)],
  ])("an ordinary path swapped for a %s to a credential file → null", async (_kind, swap) => {
    write(path.join(home, "swapme.txt"), "ordinary");
    const realRealpath = fsp.realpath.bind(fsp);
    let swapped = false;
    vi.spyOn(fsp, "realpath").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
      const out = await (realRealpath as (...a: unknown[]) => Promise<string>)(p, ...rest);
      if (!swapped && String(p) === path.join(home, "swapme.txt")) {
        swapped = true;
        fs.rmSync(path.join(home, "swapme.txt"));
        swap(path.join(home, "swapme.txt"), path.join(agent(), "auth.json"));
      }
      return out;
    }) as never);
    expect(await readFileGuarded(path.join(home, "swapme.txt"))).toBeNull();
    expect(swapped).toBe(true);
  });
});
