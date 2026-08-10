import { describe, expect, it } from "vitest";
import { errKeyForCode, resolveServerMessage } from "../lib/api/server-error.js";

type Vars = Record<string, string | number>;
// A fake language-aware translator matching the i18n runtime contract.
function makeT(dict: Record<string, string>) {
  return (key: string, vars?: Vars, fallback?: string) => {
    const tpl = dict[key] ?? fallback ?? key;
    return vars ? tpl.replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? "")) : tpl;
  };
}

describe("errKeyForCode", () => {
  it("normalises SCREAMING_SNAKE and dotted codes into err.* keys", () => {
    expect(errKeyForCode("PREFLIGHT_FAILED")).toBe("err.preflight_failed");
    expect(errKeyForCode("git.not_a_repo")).toBe("err.git.not_a_repo");
    expect(errKeyForCode("FORK-DEGRADED TO NEW")).toBe("err.fork_degraded_to_new");
  });
});

describe("resolveServerMessage", () => {
  const hu = makeT({ "err.git.not_a_repo": "Nem git tároló", "err.dir_missing": "A könyvtár {path} nem létezik" });

  it("renders the translated err.* text for a coded error", () => {
    expect(
      resolveServerMessage({ code: "git.not_a_repo", message: "not a git repository" }, hu),
    ).toBe("Nem git tároló");
  });

  it("interpolates vars into the translation", () => {
    expect(
      resolveServerMessage({ code: "DIR_MISSING", vars: { path: "/x" }, message: "missing" }, hu),
    ).toBe("A könyvtár /x nem létezik");
  });

  it("falls back to the server message for an unmapped code (never a bare code)", () => {
    const out = resolveServerMessage({ code: "UNKNOWN_CODE", message: "Something broke" }, hu);
    expect(out).toBe("Something broke");
    expect(out).not.toContain("UNKNOWN_CODE");
    expect(out).not.toContain("err.");
  });

  it("uses the message alone when no code is present", () => {
    expect(resolveServerMessage({ message: "plain error" }, hu)).toBe("plain error");
  });
});
