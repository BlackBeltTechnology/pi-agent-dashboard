/**
 * Trigger-taxonomy descriptor derivation: scheduled reports enabled, planned
 * categories report planned, and events under a planned category stay planned.
 * An enabled category surfaces its declared event baseline status.
 *
 * See change: redesign-automation-editor-and-board.
 */
import { describe, it, expect } from "vitest";
import {
  TriggerRegistry,
  deriveTriggerTaxonomy,
  onKindForCategory,
  categoryForOnKind,
  type TaxonomyCategory,
} from "../server/trigger-registry.js";
import { scheduleTrigger } from "../server/schedule-trigger.js";

function find(cats: ReturnType<typeof deriveTriggerTaxonomy>, id: string) {
  return cats.find((c) => c.category === id);
}

describe("deriveTriggerTaxonomy", () => {
  it("reports the scheduled category as enabled when schedule is registered", () => {
    const reg = new TriggerRegistry();
    reg.register(scheduleTrigger);
    const cats = deriveTriggerTaxonomy(reg);
    const scheduled = find(cats, "scheduled");
    expect(scheduled?.status).toBe("enabled");
    expect(scheduled?.events).toEqual([]);
  });

  it("reports an advertised-but-unwired category as planned", () => {
    const reg = new TriggerRegistry();
    reg.register(scheduleTrigger);
    const cats = deriveTriggerTaxonomy(reg);
    expect(find(cats, "git")?.status).toBe("planned");
  });

  it("keeps events planned within a planned category", () => {
    const reg = new TriggerRegistry();
    reg.register(scheduleTrigger);
    const openspec = find(deriveTriggerTaxonomy(reg), "openspec");
    expect(openspec?.status).toBe("planned");
    expect(openspec?.events.every((e) => e.status === "planned")).toBe(true);
  });

  it("reports a planned event within an enabled category as planned", () => {
    // Simulate a future where openspec is wired but proposal.added is not.
    const taxonomy: TaxonomyCategory[] = [
      {
        category: "openspec",
        label: "OpenSpec",
        multiType: true,
        events: [
          { event: "change.archived", label: "Change archived", baseStatus: "enabled" },
          { event: "proposal.added", label: "Proposal added", baseStatus: "planned" },
        ],
      },
    ];
    const reg = new TriggerRegistry();
    // Register a stub trigger under the openspec on-disk kind so the category
    // flips to enabled.
    reg.register({ kind: "openspec", parse: () => ({}), arm: () => ({ dispose() {} }) });
    const openspec = find(deriveTriggerTaxonomy(reg, taxonomy), "openspec");
    expect(openspec?.status).toBe("enabled");
    const byId = Object.fromEntries(openspec!.events.map((e) => [e.event, e.status]));
    expect(byId["change.archived"]).toBe("enabled");
    expect(byId["proposal.added"]).toBe("planned");
  });

  it("maps scheduled category id to the legacy schedule on-disk kind", () => {
    expect(onKindForCategory("scheduled")).toBe("schedule");
    expect(onKindForCategory("openspec")).toBe("openspec");
    expect(categoryForOnKind("schedule")).toBe("scheduled");
    expect(categoryForOnKind("openspec")).toBe("openspec");
  });
});
