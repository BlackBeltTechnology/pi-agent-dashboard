import { describe, expect, it } from "vitest";
import { matchTabs, type TabHaystack } from "../layout/match-tabs.js";

const t = (label: string, location: string): TabHaystack => ({ label, location });
const tabs = [
  t("Status Beszámoló.pdf", ""),
  t("Status Beszamolo 2.pdf", ""),
  t("memo.pdf", "Projektek/BOSCH"),
  t("zsh", "terminal"),
];
const labels = (q: string, from: TabHaystack[] = tabs) => matchTabs(from, q).map((m) => m.tab.label);

describe("matchTabs (scope-anchor-editor-pane-controls D7)", () => {
  it("#E5 token AND over label + location; prefixes excluded; blank query lists all", () => {
    expect(labels("beszamolo")).toEqual(["Status Beszámoló.pdf", "Status Beszamolo 2.pdf"]);
    expect(labels("bosch memo")).toEqual(["memo.pdf"]);
    expect(labels("bosch kickoff")).toEqual([]);
    expect(labels("term:")).toEqual([]);
    expect(labels("   ")).toHaveLength(4);
  });

  it("#E6 folds Latin marks only: ł, ß and Hebrew marks do not fold", () => {
    const hay = [t("Łódź.md", ""), t("Straße.md", ""), t("שָׁלוֹם.md", "")];
    expect(labels("lodz", hay)).toEqual([]);
    expect(labels("strasse", hay)).toEqual([]);
    expect(labels("שלום", hay)).toEqual([]);
    expect(labels("łódź", hay)).toEqual(["Łódź.md"]);
  });

  it("#E7 highlight range addresses the original string", () => {
    const [m] = matchTabs([tabs[0]], "beszamolo");
    const [s, e] = m.labelRanges[0];
    expect(tabs[0].label.slice(s, e)).toBe("Beszámoló");
    expect(e - s).toBe(9);
  });

  it("highlights location matches separately and merges overlapping token ranges", () => {
    const [m] = matchTabs([tabs[2]], "bosch memo");
    expect(m.locationRanges).toEqual([[10, 15]]);
    const [o] = matchTabs([t("abcdef", "")], "abc cde");
    expect(o.labelRanges).toEqual([[0, 5]]);
  });
});
