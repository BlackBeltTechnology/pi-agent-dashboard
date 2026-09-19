import { describe, expect, it } from "vitest";
import { assignSlideIds, edgeId, foldAscii, messageId, parseHeading, SLIDE_ID_PATTERN, slugify } from "../ids.js";

describe("slugify / foldAscii", () => {
  it("folds Hungarian accents to ASCII", () => {
    expect(foldAscii("Ágensrajok őrült űrhajó")).toBe("Agensrajok orult urhajo");
    expect(slugify("Ágensrajok")).toBe("agensrajok");
    expect(slugify("Rendszer-architektúra")).toBe("rendszer-architektura");
  });

  it("falls back to `slide` for an empty heading", () => {
    expect(slugify("")).toBe("slide");
    expect(slugify("!!!")).toBe("slide");
  });

  it("never emits the reserved deck3d- prefix", () => {
    expect(slugify("deck3d intro")).toBe("s-deck3d-intro");
  });
});

describe("parseHeading", () => {
  it("splits an explicit pin", () => {
    expect(parseHeading("Final {#pin}")).toEqual({ title: "Final", pin: "pin" });
  });
  it("leaves an unpinned heading alone", () => {
    expect(parseHeading("Agent Loop")).toEqual({ title: "Agent Loop" });
  });
});

describe("assignSlideIds", () => {
  it("resolves collisions with -<ordinal> in order (E3)", () => {
    const ids = assignSlideIds([
      { title: "Ágensrajok" },
      { title: "Agensrajok" },
      { title: "Agensrajok" },
      { title: "" },
      { title: "Final", pin: "pin" },
    ]);
    expect(ids).toEqual(["agensrajok", "agensrajok-2", "agensrajok-3", "slide", "pin"]);
    for (const id of ids) expect(id).toMatch(SLIDE_ID_PATTERN);
  });
});

describe("edgeId / messageId", () => {
  it("uses source-order ordinals, not render counters", () => {
    expect(edgeId("L_A", "B_C", 0)).toBe("L_A->B_C#0");
    expect(edgeId("A", "B", 1)).toBe("A->B#1");
    expect(messageId(3)).toBe("m3");
  });
});
