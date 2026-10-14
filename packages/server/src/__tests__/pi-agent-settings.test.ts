import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PI_RETRY_DEFAULTS,
  applyPiSettingsPatch,
  computePiSettingsEtag,
  readPiRetryPolicy,
  readPiSettings,
  validatePiRetryPolicy,
  withPiSettingsLock,
  writePiRetryPolicy,
  writePiSettingsRaw,
} from "../pi-agent-settings.js";

const lockfile = createRequire(import.meta.url)("proper-lockfile") as typeof import("proper-lockfile");

/**
 * pi's global settings.json: retry block (pi-retry-settings) + the typed/raw
 * editor, token, lock and atomic write (pi-agent-settings-editor).
 * Real tmp agent dir per test (via the `agentDirEnv` seam).
 * See changes: retry-forever-with-stop-control, edit-pi-agent-settings.
 */
describe("pi-agent-settings", () => {
  let dir: string;
  let file: string;
  let deps: { agentDirEnv: string };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-agent-"));
    file = join(dir, "settings.json");
    deps = { agentDirEnv: dir };
  });

  const seed = (text: string | object) => writeFileSync(file, typeof text === "string" ? text : JSON.stringify(text, null, 2));
  const onDisk = () => readFileSync(file, "utf-8");
  const json = () => JSON.parse(onDisk());
  const token = () => readPiSettings(deps).etag;

  /** Hold the real pi-style lock on the settings path. */
  const holdLock = async () => lockfile.lock(file, { realpath: false, stale: 10_000 });

  const valid = {
    enabled: true,
    maxRetries: 24,
    baseDelayMs: 2000,
    provider: { maxRetries: 0, maxRetryDelayMs: 60000 },
  };

  describe("retry read", () => {
    it("returns pi's defaults when the file does not exist", () => {
      expect(readPiRetryPolicy(deps)).toEqual(PI_RETRY_DEFAULTS);
    });

    it("returns defaults when there is no retry block", () => {
      seed({ extensions: [] });
      expect(readPiRetryPolicy(deps)).toEqual(PI_RETRY_DEFAULTS);
    });

    it("reads all six fields", () => {
      seed({
        retry: { enabled: false, maxRetries: 24, baseDelayMs: 5000, provider: { timeoutMs: 3600000, maxRetries: 5, maxRetryDelayMs: 0 } },
      });
      expect(readPiRetryPolicy(deps)).toEqual({
        enabled: false,
        maxRetries: 24,
        baseDelayMs: 5000,
        provider: { timeoutMs: 3600000, maxRetries: 5, maxRetryDelayMs: 0 },
      });
    });

    it("omits provider.timeoutMs when absent (SDK default)", () => {
      seed({ retry: { provider: { maxRetries: 2 } } });
      const out = readPiRetryPolicy(deps);
      expect("timeoutMs" in out.provider).toBe(false);
      expect(out.provider.maxRetries).toBe(2);
      expect(out.provider.maxRetryDelayMs).toBe(60000);
    });
  });

  describe("retry write is merge-preserving", () => {
    it("preserves unrelated top-level keys", async () => {
      const untouched = {
        packages: ["@blackbelt-technology/pi-dashboard-extension"],
        extensions: ["/x/bridge.js"],
        dashboardPluginBridges: [{ id: "flows" }],
        enabledModels: ["anthropic/*"],
      };
      seed(untouched);
      expect((await writePiRetryPolicy(valid, deps)).ok).toBe(true);
      for (const [k, v] of Object.entries(untouched)) expect(json()[k]).toEqual(v);
    });

    it("preserves UNKNOWN keys inside retry and retry.provider", async () => {
      seed({ retry: { someFutureKnob: "keep-me", maxRetries: 3, provider: { futureProviderKnob: 42, maxRetries: 0 } } });
      await writePiRetryPolicy(valid, deps);
      expect(json().retry.someFutureKnob).toBe("keep-me");
      expect(json().retry.provider.futureProviderKnob).toBe(42);
    });

    it("writes all six fields", async () => {
      await writePiRetryPolicy(
        { enabled: false, maxRetries: 10, baseDelayMs: 4000, provider: { timeoutMs: 1000, maxRetries: 3, maxRetryDelayMs: 0 } },
        deps,
      );
      expect(json().retry).toMatchObject({
        enabled: false,
        maxRetries: 10,
        baseDelayMs: 4000,
        provider: { timeoutMs: 1000, maxRetries: 3, maxRetryDelayMs: 0 },
      });
    });

    it("OMITS provider.timeoutMs when undefined rather than writing 0/null", async () => {
      seed({ retry: { provider: { timeoutMs: 999 } } });
      await writePiRetryPolicy(valid, deps);
      expect("timeoutMs" in json().retry.provider).toBe(false);
    });

    it("round-trips through read", async () => {
      const p = { enabled: false, maxRetries: 12, baseDelayMs: 5000, provider: { maxRetries: 1, maxRetryDelayMs: 0 } };
      await writePiRetryPolicy(p, deps);
      expect(readPiRetryPolicy(deps)).toEqual(p);
    });

    it("refuses an unparseable file instead of overwriting it from {}", async () => {
      seed('{ "packages": [');
      const r = await writePiRetryPolicy(valid, deps);
      expect(r).toMatchObject({ ok: false, error: "parse" });
      expect(onDisk()).toBe('{ "packages": [');
    });

    it("never touches a project .pi/settings.json", async () => {
      const proj = mkdtempSync(join(tmpdir(), "pi-proj-"));
      mkdirSync(join(proj, ".pi"));
      writeFileSync(join(proj, ".pi", "settings.json"), "SENTINEL");
      await writePiRetryPolicy(valid, deps);
      expect(readFileSync(join(proj, ".pi", "settings.json"), "utf-8")).toBe("SENTINEL");
    });
  });

  describe("retry validation", () => {
    it("accepts large attempt counts (no clamp)", () => {
      expect(validatePiRetryPolicy({ ...valid, maxRetries: 100 })).toEqual([]);
    });

    it.each([
      [{ ...valid, maxRetries: -1 }, "maxRetries"],
      [{ ...valid, maxRetries: 1.5 }, "maxRetries"],
      [{ ...valid, baseDelayMs: 0 }, "baseDelayMs"],
      [{ ...valid, enabled: "yes" }, "enabled"],
      [{ ...valid, provider: { maxRetries: -1, maxRetryDelayMs: 0 } }, "provider.maxRetries"],
      [{ ...valid, provider: { maxRetries: 0, maxRetryDelayMs: -5 } }, "provider.maxRetryDelayMs"],
      [{ ...valid, provider: { timeoutMs: 0, maxRetries: 0, maxRetryDelayMs: 0 } }, "provider.timeoutMs"],
    ])("rejects %o on field %s", (bad, field) => {
      expect(validatePiRetryPolicy(bad).map((e) => e.field)).toContain(field);
    });

    it("rejects a missing provider block", () => {
      expect(validatePiRetryPolicy({ enabled: true, maxRetries: 3, baseDelayMs: 2000 }).map((e) => e.field)).toContain("provider");
    });

    it("does not write when invalid", async () => {
      const res = await writePiRetryPolicy({ ...valid, maxRetries: -1 }, deps);
      expect(res.ok).toBe(false);
      expect(res.errors?.length).toBeGreaterThan(0);
      expect(existsSync(file)).toBe(false);
    });
  });

  // ── E1–E4 (read), E5 (agent dir) ───────────────────────────────────
  describe("read", () => {
    it("E2 absent file → {} / '' / 'absent'", () => {
      expect(readPiSettings(deps)).toMatchObject({ settings: {}, raw: "", etag: "absent" });
    });

    it("E3 unparseable → parseError, raw-byte token", () => {
      const raw = '{ "steeringMode": ';
      seed(raw);
      const s = readPiSettings(deps);
      expect(s.parseError).toBeTruthy();
      expect(s.settings).toEqual({});
      expect(s.raw).toBe(raw);
      expect(s.etag).toBe(createHash("sha256").update(raw).digest("hex"));
    });

    it("E4 BOM stripped before parsing", () => {
      seed('\uFEFF{"steeringMode":"all"}');
      const s = readPiSettings(deps);
      expect(s.settings.steeringMode).toBe("all");
      expect(s.parseError).toBeUndefined();
    });

    it("E5 PI_CODING_AGENT_DIR override: reads/writes the alt dir, never the home one", async () => {
      const alt = join(dir, "alt");
      mkdirSync(alt);
      writeFileSync(join(alt, "settings.json"), '{"steeringMode":"all"}');
      const homeSentinel = mkdtempSync(join(tmpdir(), "pi-home-"));
      mkdirSync(join(homeSentinel, ".pi", "agent"), { recursive: true });
      writeFileSync(join(homeSentinel, ".pi", "agent", "settings.json"), "SENTINEL");
      const d = { agentDirEnv: alt, home: homeSentinel };
      expect(readPiSettings(d).settings.steeringMode).toBe("all");
      const r = await applyPiSettingsPatch({ steeringMode: "one-at-a-time" }, readPiSettings(d).etag, d);
      expect(r.ok).toBe(true);
      expect(JSON.parse(readFileSync(join(alt, "settings.json"), "utf-8")).steeringMode).toBe("one-at-a-time");
      expect(readFileSync(join(homeSentinel, ".pi", "agent", "settings.json"), "utf-8")).toBe("SENTINEL");
    });
  });

  // ── Typed patch ─────────────────────────────────────────────────────
  describe("typed patch", () => {
    it("E6 merge-preserving across nested blocks and unknown siblings", async () => {
      const before = { packages: ["npm:x"], retry: { enabled: false }, compaction: { enabled: true, futureKnob: 1 } };
      seed(before);
      const r = await applyPiSettingsPatch({ compaction: { reserveTokens: 20000 } }, token(), deps);
      expect(r.ok).toBe(true);
      expect(json().compaction).toEqual({ enabled: true, futureKnob: 1, reserveTokens: 20000 });
      expect(json().packages).toEqual(before.packages);
      expect(json().retry).toEqual(before.retry);
    });

    it("E7 null leaf deletes the key", async () => {
      seed({ steeringMode: "all" });
      await applyPiSettingsPatch({ steeringMode: null }, token(), deps);
      expect("steeringMode" in json()).toBe(false);
    });

    it("null-only patch does not conjure an empty block", async () => {
      seed({ steeringMode: "all" });
      await applyPiSettingsPatch({ compaction: { reserveTokens: null } }, token(), deps);
      expect("compaction" in json()).toBe(false);
    });

    it("E8 whole-block null → invalid, file untouched", async () => {
      seed({ compaction: { enabled: true } });
      const before = onDisk();
      const r = await applyPiSettingsPatch({ compaction: null }, token(), deps);
      expect(r).toMatchObject({ ok: false, error: "invalid" });
      expect(JSON.stringify((r as { errors: unknown }).errors)).toContain("compaction");
      expect(onDisk()).toBe(before);
    });

    it.each([
      [-1, false],
      [0, true],
      [1, true],
      [1.5, false],
      ["5", false],
      [2 ** 31, true],
    ])("E9 compaction.reserveTokens = %j → ok=%s", async (value, expectOk) => {
      seed({});
      const before = onDisk();
      const r = await applyPiSettingsPatch({ compaction: { reserveTokens: value } }, token(), deps);
      expect(r.ok).toBe(expectOk);
      if (expectOk) expect(json().compaction.reserveTokens).toBe(value);
      else {
        expect(JSON.stringify((r as { errors: unknown }).errors)).toContain("compaction.reserveTokens");
        expect(onDisk()).toBe(before);
      }
    });

    it.each([
      ["steeringMode", "all", true],
      ["steeringMode", "one-at-a-time", true],
      ["steeringMode", "ALL", false],
      ["steeringMode", "", false],
      ["followUpMode", "all", true],
      ["followUpMode", "ALL", false],
      ["defaultProjectTrust", "ask", true],
      ["defaultProjectTrust", "always", true],
      ["defaultProjectTrust", "never", true],
      ["defaultProjectTrust", "maybe", false],
      ["quietStartup", true, true],
      ["quietStartup", false, true],
      ["quietStartup", "header", true],
      ["quietStartup", "quiet", false],
      ["quietStartup", 1, false],
    ])("E10 %s = %j → ok=%s", async (key, value, expectOk) => {
      seed({});
      const r = await applyPiSettingsPatch({ [key]: value }, token(), deps);
      expect(r.ok).toBe(expectOk);
      if (!expectOk) {
        expect(JSON.stringify((r as { errors: unknown }).errors)).toContain(key);
        expect(json()).toEqual({});
      }
    });

    it("E11 mixed valid+invalid applies nothing", async () => {
      seed({ a: 1 });
      const before = onDisk();
      const r = await applyPiSettingsPatch({ steeringMode: "all", compaction: { reserveTokens: -1 } }, token(), deps);
      expect(r.ok).toBe(false);
      expect(JSON.stringify((r as { errors: unknown }).errors)).toContain("compaction.reserveTokens");
      expect(onDisk()).toBe(before);
    });

    it("E12 non-typed pi key is rejected with a JSON-editor pointer", async () => {
      seed({});
      const r = await applyPiSettingsPatch({ shellPath: "/bin/sh" }, token(), deps);
      expect(r.ok).toBe(false);
      const msg = JSON.stringify((r as { errors: unknown }).errors);
      expect(msg).toContain("shellPath");
      expect(msg).toMatch(/JSON/);
      expect(json()).toEqual({});
    });

    it.each(["defaultProvider", "defaultModel", "defaultThinkingLevel"])("E13 managed key %s is rejected", async (key) => {
      seed({});
      const r = await applyPiSettingsPatch({ [key]: "x" }, token(), deps);
      expect(r).toMatchObject({ ok: false, error: "invalid" });
      expect(json()).toEqual({});
    });

    it("E14 unparseable current file → parse, byte-identical", async () => {
      seed('{ "a": ');
      const before = onDisk();
      const r = await applyPiSettingsPatch({ steeringMode: "all" }, token(), deps);
      expect(r).toMatchObject({ ok: false, error: "parse" });
      expect(onDisk()).toBe(before);
    });
  });

  // ── Raw writer ──────────────────────────────────────────────────────
  describe("raw write", () => {
    const put = (obj: unknown) => writePiSettingsRaw(typeof obj === "string" ? obj : JSON.stringify(obj), token(), deps);
    const fieldsOf = (r: unknown) => ((r as { errors?: { field: string }[] }).errors ?? []).map((e) => e.field);

    it("E15 unknown keys pass; text is 2-space JSON + newline", async () => {
      seed({});
      const r = await put({ someFutureKey: { a: 1 } });
      expect(r.ok).toBe(true);
      expect(onDisk()).toBe(`${JSON.stringify({ someFutureKey: { a: 1 } }, null, 2)}\n`);
    });

    it("E16 partial retry is accepted", async () => {
      seed({});
      expect((await put({ retry: { enabled: true, maxAgentDelayMs: 5000 } })).ok).toBe(true);
    });

    it.each([
      [{ retry: { baseDelayMs: 0 } }, "retry.baseDelayMs", false],
      [{ retry: { baseDelayMs: 1 } }, "", true],
      [{ retry: { provider: { timeoutMs: 0 } } }, "retry.provider.timeoutMs", false],
      [{ retry: { provider: { timeoutMs: 1 } } }, "", true],
      [{ retry: 5 }, "retry", false],
      [{ retry: [] }, "retry", false],
      [{ retry: { provider: [] } }, "retry.provider", false],
      [{ retry: { provider: 5 } }, "retry.provider", false],
    ])("E17 retry rules %j", async (body, field, expectOk) => {
      seed({});
      const before = onDisk();
      const r = await put(body);
      expect(r.ok).toBe(expectOk);
      if (!expectOk) {
        expect(fieldsOf(r)).toContain(field);
        expect(onDisk()).toBe(before);
      }
    });

    it.each(["{ \"a\": 1,, }", "[1,2]", '"x"', "null"])("E18 bad JSON shape %s", async (text) => {
      seed({ a: 1 });
      const before = onDisk();
      const r = await put(text);
      expect(r).toMatchObject({ ok: false, error: "invalid" });
      expect(onDisk()).toBe(before);
    });

    it("E19 typed-key types are enforced in raw", async () => {
      seed({});
      expect(fieldsOf(await put({ steeringMode: "x" }))).toContain("steeringMode");
      expect(fieldsOf(await put({ compaction: { reserveTokens: -1 } }))).toContain("compaction.reserveTokens");
    });

    it.each([
      [{ npmCommand: "curl x | sh" }, "npmCommand", false],
      [{ npmCommand: ["npm"] }, "", true],
      [{ enabledModels: [123] }, "enabledModels", false],
      [{ enabledModels: ["a/b"] }, "", true],
      [{ packages: [42] }, "packages", false],
      [{ packages: ["npm:x", { source: "y" }] }, "", true],
      [{ shellPath: 5 }, "shellPath", false],
      [{ shellCommandPrefix: "x" }, "", true],
      [{ modelThinkingLevels: { a: "loud" } }, "modelThinkingLevels", false],
      [{ modelThinkingLevels: { a: "high" } }, "", true],
    ])("E20 %j", async (body, field, expectOk) => {
      seed({});
      const r = await put(body);
      expect(r.ok).toBe(expectOk);
      if (!expectOk) expect(fieldsOf(r)).toContain(field);
    });

    it("E21 legacy skills object accepted; skills [1] rejected", async () => {
      seed({});
      expect((await put({ skills: { customDirectories: ["~/s"] } })).ok).toBe(true);
      expect(fieldsOf(await put({ skills: [1] }))).toContain("skills");
    });

    it("E23 repairs an unparseable file", async () => {
      seed('{ "a": ');
      const r = await put({ steeringMode: "all" });
      expect(r.ok).toBe(true);
      expect(json()).toEqual({ steeringMode: "all" });
    });

    it("E24 managed keys are substituted from disk and reported", async () => {
      const disk = { defaultModel: "claude-opus-5-5", defaultProvider: "anthropic" };
      // (a) different value
      seed(disk);
      let r = await put({ ...disk, defaultModel: "other" });
      expect(json()).toMatchObject(disk);
      expect(r).toMatchObject({ ok: true, restoredKeys: ["defaultModel"] });
      // (b) omitted
      seed(disk);
      r = await put({ defaultModel: "claude-opus-5-5" });
      expect(json()).toMatchObject(disk);
      expect(r).toMatchObject({ ok: true, restoredKeys: ["defaultProvider"] });
      // (c) identical
      seed(disk);
      r = await put(disk);
      expect(json()).toMatchObject(disk);
      expect(r).toMatchObject({ ok: true, restoredKeys: [] });
    });
  });

  // ── Token ───────────────────────────────────────────────────────────
  describe("token", () => {
    it("E25 reformat + key reorder (nested) is not a conflict", async () => {
      seed({ a: 1, compaction: { enabled: true, reserveTokens: 5 } });
      const t = token();
      seed('{\n"compaction":{"reserveTokens":5,"enabled":true},\n\n"a":1}');
      expect((await applyPiSettingsPatch({ steeringMode: "all" }, t, deps)).ok).toBe(true);
    });

    it("E26 managed keys are excluded from the token", async () => {
      seed({ a: 1, defaultModel: "x" });
      const t = token();
      seed({ a: 1, defaultModel: "y", defaultProvider: "p" });
      expect((await applyPiSettingsPatch({ steeringMode: "all" }, t, deps)).ok).toBe(true);
    });

    it("E27 a real change → stale with current state; external change kept", async () => {
      seed({ steeringMode: "one-at-a-time" });
      const t = token();
      seed({ steeringMode: "all" });
      const r = await applyPiSettingsPatch({ followUpMode: "all" }, t, deps);
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ error: "stale", state: { settings: { steeringMode: "all" } } });
      expect(json()).toEqual({ steeringMode: "all" });
    });

    it("E28 re-baselines from the write result", async () => {
      seed({});
      const r1 = await applyPiSettingsPatch({ steeringMode: "all" }, token(), deps);
      expect(r1.ok).toBe(true);
      const t1 = (r1 as { state: { etag: string } }).state.etag;
      expect(t1).toBe(token());
      expect((await applyPiSettingsPatch({ followUpMode: "all" }, t1, deps)).ok).toBe(true);
    });

    it("E29 'absent' token is stale once another writer creates the file", async () => {
      expect(token()).toBe("absent");
      seed({ a: 1 });
      expect(await applyPiSettingsPatch({ steeringMode: "all" }, "absent", deps)).toMatchObject({ ok: false, error: "stale" });
    });

    it("computePiSettingsEtag: absent / unparseable", () => {
      expect(computePiSettingsEtag(null)).toBe("absent");
      expect(computePiSettingsEtag("{")).toBe(createHash("sha256").update("{").digest("hex"));
    });
  });

  // ── File handling ───────────────────────────────────────────────────
  describe("file handling", () => {
    it("E30 first write creates dir + file", async () => {
      const fresh = join(dir, "nested", "agent");
      const d = { agentDirEnv: fresh };
      const r = await applyPiSettingsPatch({ steeringMode: "all" }, "absent", d);
      expect(r.ok).toBe(true);
      expect(JSON.parse(readFileSync(join(fresh, "settings.json"), "utf-8"))).toEqual({ steeringMode: "all" });
    });

    it("E31 symlink is preserved; lock sits at settings.json.lock", async () => {
      const real = join(dir, "real.json");
      writeFileSync(real, "{}");
      symlinkSync(real, file);
      let lockSeen = false;
      await withPiSettingsLock(() => {
        lockSeen = existsSync(`${file}.lock`) && !existsSync(`${real}.lock`);
        return { value: null };
      }, {}, deps);
      expect(lockSeen).toBe(true);
      const r = await applyPiSettingsPatch({ steeringMode: "all" }, token(), deps);
      expect(r.ok).toBe(true);
      expect(lstatSync(file).isSymbolicLink()).toBe(true);
      expect(JSON.parse(readFileSync(real, "utf-8"))).toEqual({ steeringMode: "all" });
    });

    it("E32 file mode is preserved", async () => {
      seed({});
      chmodSync(file, 0o600);
      await applyPiSettingsPatch({ steeringMode: "all" }, token(), deps);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    });

    it("never leaves a tmp file behind on success", async () => {
      seed({});
      await applyPiSettingsPatch({ steeringMode: "all" }, token(), deps);
      expect(readdirSync(dir).sort()).toEqual(["settings.json"]);
    });
  });

  // ── Lock / failure modes ────────────────────────────────────────────
  describe("lock coordination", () => {
    it("X1 held lock beyond the budget → busy, file untouched (typed + raw)", async () => {
      seed({ a: 1 });
      const before = onDisk();
      const t = token();
      const release = await holdLock();
      try {
        expect(await applyPiSettingsPatch({ steeringMode: "all" }, t, deps)).toEqual({ ok: false, error: "busy" });
        expect(await writePiSettingsRaw("{}", t, deps)).toEqual({ ok: false, error: "busy" });
      } finally {
        await release();
      }
      expect(onDisk()).toBe(before);
    });

    it("X2 held lock on the LINK path → busy; link target untouched", async () => {
      const real = join(dir, "real.json");
      writeFileSync(real, "{}");
      symlinkSync(real, file);
      const release = await holdLock();
      try {
        expect(await applyPiSettingsPatch({ steeringMode: "all" }, token(), deps)).toEqual({ ok: false, error: "busy" });
      } finally {
        await release();
      }
      expect(readFileSync(real, "utf-8")).toBe("{}");
    });

    it("X4 lock released within the budget → ok", async () => {
      seed({});
      const t = token();
      const release = await holdLock();
      setTimeout(() => void release(), 60);
      expect((await applyPiSettingsPatch({ steeringMode: "all" }, t, deps)).ok).toBe(true);
      expect(json().steeringMode).toBe("all");
    });

    it("X5 stale lock (>10 s, no holder) is reclaimed", async () => {
      seed({});
      mkdirSync(`${file}.lock`);
      const old = new Date(Date.now() - 11_000);
      utimesSync(`${file}.lock`, old, old);
      expect((await applyPiSettingsPatch({ steeringMode: "all" }, token(), deps)).ok).toBe(true);
    });

    it("X6 tmp write failure → io; target byte-identical; no tmp left", async () => {
      seed({ a: 1 });
      const before = onDisk();
      const r = await applyPiSettingsPatch({ steeringMode: "all" }, token(), {
        ...deps,
        fs: {
          writeFile: async () => {
            throw new Error("disk full");
          },
        },
      });
      expect(r).toMatchObject({ ok: false, error: "io" });
      expect(onDisk()).toBe(before);
      expect(readdirSync(dir).sort()).toEqual(["settings.json"]);
    });

    it("releases the lock after a write (next writer is not busy)", async () => {
      seed({});
      await applyPiSettingsPatch({ steeringMode: "all" }, token(), deps);
      expect(existsSync(`${file}.lock`)).toBe(false);
    });
  });
});
