import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { applyPiSettingsPatch, RAW_LEGACY_TYPED, readPiSettings, writePiSettingsRaw } from "../pi-agent-settings.js";

/**
 * Typed patch over the full pi key schema, frozen raw validation and
 * sanitised parse errors. Real tmp agent dir per test.
 * See change: pi-settings-full-coverage (test-plan #E2–#E8, #E21).
 */
describe("pi-agent-settings typed keys", () => {
  let dir: string;
  let file: string;
  let deps: { agentDirEnv: string };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-typed-"));
    file = join(dir, "settings.json");
    deps = { agentDirEnv: dir };
  });

  const seed = (t: string | object) => writeFileSync(file, typeof t === "string" ? t : JSON.stringify(t, null, 2));
  const onDisk = () => readFileSync(file, "utf-8");
  const json = () => JSON.parse(onDisk());
  const token = () => readPiSettings(deps).etag;
  const patch = (p: unknown) => applyPiSettingsPatch(p, token(), deps);
  const errorsOf = (r: unknown) => JSON.stringify((r as { errors?: unknown }).errors ?? null);

  it("E2 bounded integers accept the bounds and reject one past them", async () => {
    for (const [key, ok, bad] of [
      ["autocompleteMaxVisible", [3, 20], [2, 21]],
      ["editorPaddingX", [0, 3], [-1, 4]],
    ] as const) {
      for (const v of ok) {
        seed({});
        expect(await patch({ [key]: v }), `${key}=${v}`).toMatchObject({ ok: true });
        expect(json()[key]).toBe(v);
      }
      for (const v of bad) {
        seed({ keep: 1 });
        const before = onDisk();
        const r = await patch({ [key]: v });
        expect(r, `${key}=${v}`).toMatchObject({ ok: false, error: "invalid" });
        expect(errorsOf(r)).toContain(key);
        expect(onDisk()).toBe(before);
      }
    }
  });

  it("E2 a TUI-only key is rejected with a JSON-editor pointer", async () => {
    seed({ a: 1 });
    const before = onDisk();
    const r = await patch({ tuiMode: "regular" });
    expect(r).toMatchObject({ ok: false, error: "invalid" });
    expect(errorsOf(r)).toMatch(/tuiMode.*JSON/);
    expect(onDisk()).toBe(before);
  });

  it("E3 mixed values: listed ones are written, true for terminal.images and unknown strings are rejected", async () => {
    for (const v of ["kitty", "iterm2", "auto", false]) {
      seed({});
      expect(await patch({ terminal: { images: v } }), String(v)).toMatchObject({ ok: true });
      expect(json().terminal.images).toBe(v);
    }
    for (const v of [true, "x"]) {
      seed({});
      const r = await patch({ terminal: { images: v } });
      expect(r, String(v)).toMatchObject({ ok: false, error: "invalid" });
      expect(errorsOf(r)).toContain("terminal.images");
    }
    for (const v of [true, false, "header"]) {
      seed({});
      expect(await patch({ quietStartup: v }), String(v)).toMatchObject({ ok: true });
      expect(json().quietStartup).toBe(v);
    }
    seed({});
    expect(await patch({ quietStartup: "x" })).toMatchObject({ ok: false, error: "invalid" });
  });

  it("E4 a newly typed scalar is written and unknown/other keys survive", async () => {
    const original = {
      compaction: { enabled: true, futureKnob: 1 },
      terminal: { futureLeaf: 2 },
      packages: ["npm:x"],
      retry: { enabled: false, provider: { maxRetries: 2 } },
    };
    seed(original);
    expect(await patch({ shellPath: "/bin/zsh", terminal: { images: false } })).toMatchObject({ ok: true });
    const next = json();
    expect(next.shellPath).toBe("/bin/zsh");
    expect(next.terminal).toEqual({ futureLeaf: 2, images: false });
    expect(next.compaction).toEqual(original.compaction);
    expect(next.packages).toEqual(original.packages);
    expect(next.retry).toEqual(original.retry);
  });

  it("E5 enabledModels is replaced whole; a bad array is rejected naming the key", async () => {
    seed({ enabledModels: ["anthropic/*", "openai/*"] });
    expect(await patch({ enabledModels: ["anthropic/*", "opencode-go/muse"] })).toMatchObject({ ok: true });
    expect(json().enabledModels).toEqual(["anthropic/*", "opencode-go/muse"]);
    for (const bad of [["a/*", ""], [123], "a/*"]) {
      seed({ enabledModels: ["x"] });
      const before = onDisk();
      const r = await patch({ enabledModels: bad });
      expect(r, JSON.stringify(bad)).toMatchObject({ ok: false, error: "invalid" });
      expect(errorsOf(r)).toContain("enabledModels");
      expect(onDisk()).toBe(before);
    }
  });

  it("E5 enabledModels = null deletes the key", async () => {
    seed({ enabledModels: ["a/*"], theme: "dark" });
    expect(await patch({ enabledModels: null })).toMatchObject({ ok: true });
    expect(json()).toEqual({ theme: "dark" });
  });

  it("E6 block null, JSON-only key and managed key are rejected with their own message", async () => {
    seed({});
    const block = await patch({ terminal: null });
    expect(errorsOf(block)).toMatch(/terminal cannot be removed as a whole block/);
    const tools = await patch({ defaultTools: ["read"] });
    expect(errorsOf(tools)).toMatch(/defaultTools.*JSON editor/);
    const managed = await patch({ defaultModel: "x" });
    expect(errorsOf(managed)).toMatch(/defaultModel is managed by the Default model control/);
    expect(json()).toEqual({});
  });

  it("E6 a dotted top-level key is not a form field", async () => {
    seed({});
    expect(await patch({ "compaction.enabled": true })).toMatchObject({ ok: false, error: "invalid" });
    expect(json()).toEqual({});
  });

  it("E7 raw mode does not check the newly typed keys", async () => {
    seed({});
    const r = await writePiSettingsRaw('{"transport":"quic","tuiMode":"weird","terminal":5}', token(), deps);
    expect(r).toMatchObject({ ok: true });
    expect(json()).toMatchObject({ transport: "quic", terminal: 5 });
  });

  it("E8 raw validation list is frozen to the 10 pre-change keys", () => {
    expect([...RAW_LEGACY_TYPED].sort()).toEqual(
      [
        "branchSummary.reserveTokens",
        "branchSummary.skipPrompt",
        "compaction.enabled",
        "compaction.keepRecentTokens",
        "compaction.reserveTokens",
        "defaultProjectTrust",
        "followUpMode",
        "hideThinkingBlock",
        "quietStartup",
        "steeringMode",
      ].sort(),
    );
    expect(Object.isFrozen(RAW_LEGACY_TYPED)).toBe(true);
  });

  it("E8 raw still rejects a legacy key of the wrong type", async () => {
    seed({});
    const r = await writePiSettingsRaw('{"compaction":{"reserveTokens":-1}}', token(), deps);
    expect(r).toMatchObject({ ok: false, error: "invalid" });
  });

  describe("E21 parse errors never quote file content", () => {
    const TRUNCATED = '{"anthropicApiKey": "sk-ant-secret-value';
    const BARE = '{"k": sk-ant-SEC}';

    it.each([TRUNCATED, BARE])("readPiSettings parseError for %s", (text) => {
      seed(text);
      const { parseError } = readPiSettings(deps);
      expect(parseError).toMatch(/^Invalid JSON( at line \d+, column \d+)?$/);
      expect(parseError).not.toContain("sk-ant");
    });

    it.each([TRUNCATED, BARE])("raw PUT error for %s", async (text) => {
      seed("{}");
      const r = await writePiSettingsRaw(text, token(), deps);
      expect(r).toMatchObject({ ok: false, error: "invalid" });
      const msg = (r as { errors: { message: string }[] }).errors[0].message;
      expect(msg).toMatch(/^Invalid JSON( at line \d+, column \d+)?$/);
      expect(msg).not.toContain("sk-ant");
    });

    it("typed patch over an unparseable file returns a sanitised parseError", async () => {
      seed(TRUNCATED);
      const r = await applyPiSettingsPatch({ steeringMode: "all" }, token(), deps);
      expect(r).toMatchObject({ ok: false, error: "parse" });
      expect((r as { parseError: string }).parseError).not.toContain("sk-ant");
    });
  });
});
