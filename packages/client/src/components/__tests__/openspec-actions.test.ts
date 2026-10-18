/**
 * `deriveOpenSpecActions` — one primary per ChangeState, overflow parity
 * between the card (includeDetach) and the composer (no Detach), and the
 * working / ended / not-found gates.
 *
 * test-plan #E6 (task 8.6) + task 3.1 table.
 * See change: redesign-composer-session-strip (D2).
 */
import { ChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { deriveOpenSpecActions, type OpenSpecActionsCtx } from "../openspec/openspec-actions.js";

const WF = {
  all: ["new", "propose", "explore", "continue", "ff", "apply", "verify", "archive", "bulk-archive"],
  core: ["propose", "explore", "apply", "archive"],
  noArchive: ["new", "propose", "explore", "continue", "ff", "apply", "verify", "bulk-archive"],
} as const;

const base = (over: Partial<OpenSpecActionsCtx> = {}): OpenSpecActionsCtx => ({
  attached: true,
  found: true,
  state: ChangeState.IMPLEMENTING,
  wf: (w) => (WF.all as readonly string[]).includes(w),
  isEnded: false,
  working: false,
  showArchiveAnyway: false,
  includeDetach: true,
  idPrefix: "",
  ...over,
});

const EXPECTED_PRIMARY: Record<keyof typeof WF, Record<ChangeState, string | undefined>> = {
  all: { PLANNING: "continue", READY: "apply", IMPLEMENTING: "apply", COMPLETE: "archive" },
  core: { PLANNING: undefined, READY: "apply", IMPLEMENTING: "apply", COMPLETE: "archive" },
  noArchive: { PLANNING: "continue", READY: "apply", IMPLEMENTING: "apply", COMPLETE: "verify" },
};

describe("deriveOpenSpecActions (#E6)", () => {
  const states = [ChangeState.PLANNING, ChangeState.READY, ChangeState.IMPLEMENTING, ChangeState.COMPLETE];
  const wfs = Object.keys(WF) as Array<keyof typeof WF>;

  for (const state of states) {
    for (const w of wfs) {
      it(`${state} × wf:${w} — same primary for card and composer; overflow differs only by detach`, () => {
        const wf = (name: string) => (WF[w] as readonly string[]).includes(name);
        const card = deriveOpenSpecActions(base({ state, wf, includeDetach: true }));
        const composer = deriveOpenSpecActions(base({ state, wf, includeDetach: false, idPrefix: "composer-" }));
        expect(card.primary?.key).toBe(EXPECTED_PRIMARY[w][state]);
        expect(composer.primary?.key).toBe(card.primary?.key);
        const cardKeys = card.overflow.map((a) => a.key);
        expect(cardKeys.at(-1)).toBe("detach");
        expect(composer.overflow.map((a) => a.key)).toEqual(cardKeys.slice(0, -1));
      });
    }
  }

  it("composer ids are prefixed; card ids are unchanged (#745)", () => {
    const card = deriveOpenSpecActions(base());
    const composer = deriveOpenSpecActions(base({ idPrefix: "composer-", includeDetach: false }));
    expect(card.primary?.testId).toBe("apply-btn");
    expect(composer.primary?.testId).toBe("composer-apply-btn");
    expect(card.overflow.map((a) => a.testId)).toEqual(["explore-menu-item", "detach-btn"]);
    expect(composer.overflow.map((a) => a.testId)).toEqual(["composer-explore-menu-item"]);
  });

  it("COMPLETE: Verify goes into ⋯; Archive-anyway only when flagged", () => {
    const c = deriveOpenSpecActions(base({ state: ChangeState.COMPLETE }));
    expect(c.overflow.map((a) => a.key)).toEqual(["verify", "explore", "detach"]);
    const anyway = deriveOpenSpecActions(base({ showArchiveAnyway: true }));
    expect(anyway.overflow.map((a) => a.key)).toEqual(["archiveAnyway", "explore", "detach"]);
  });

  it.each([true, false])("ended → only detach (includeDetach=%s)", (includeDetach) => {
    const r = deriveOpenSpecActions(base({ isEnded: true, includeDetach }));
    expect(r.primary).toBeUndefined();
    expect(r.overflow.map((a) => a.key)).toEqual(includeDetach ? ["detach"] : []);
  });

  it.each([true, false])("attached but not found → only detach (includeDetach=%s)", (includeDetach) => {
    const r = deriveOpenSpecActions(base({ found: false, state: undefined, includeDetach }));
    expect(r.primary).toBeUndefined();
    expect(r.overflow.map((a) => a.key)).toEqual(includeDetach ? ["detach"] : []);
  });

  it("working → every item blocked with a reason, except detach", () => {
    const r = deriveOpenSpecActions(base({ state: ChangeState.COMPLETE, working: true }));
    expect(r.primary?.blocked).toBe(true);
    expect(r.primary?.blockedReasonKey).toBe("session.sessionIsStreaming");
    for (const a of r.overflow) expect(a.blocked).toBe(a.key !== "detach");
    const unattached = deriveOpenSpecActions(base({ attached: false, found: false, state: undefined, working: true }));
    expect(unattached.unattached.every((a) => a.blocked)).toBe(true);
  });

  it("unattached: New / Propose / Explore, wf-gated; composer keeps composer-explore-btn", () => {
    const card = deriveOpenSpecActions(base({ attached: false, found: false, state: undefined }));
    expect(card.unattached.map((a) => a.testId)).toEqual(["new-change-btn", "propose-btn", "explore-unattached-btn"]);
    const composerCore = deriveOpenSpecActions(
      base({ attached: false, found: false, state: undefined, idPrefix: "composer-", includeDetach: false, wf: (w) => (WF.core as readonly string[]).includes(w) }),
    );
    expect(composerCore.unattached.map((a) => a.testId)).toEqual(["composer-propose-btn", "composer-explore-btn"]);
    expect(deriveOpenSpecActions(base({ attached: false, found: false, isEnded: true })).unattached).toEqual([]);
  });
});

// A change with a CLI `error` derives to PLANNING (empty artifacts) and blocks
// its rendered PLANNING candidates with the literal message.
// See change: use-openspec-status-all (test-plan #F2, #F3, #F6).
describe("deriveOpenSpecActions — change with a CLI error", () => {
  const MSG = "Invalid YAML in metadata file";
  const broken = (over: Partial<OpenSpecActionsCtx> = {}) =>
    base({ state: ChangeState.PLANNING, error: MSG, ...over });

  it("#F2 primary continue and the ff item are blocked with the literal reason; explore/detach are not; no archive", () => {
    const r = deriveOpenSpecActions(broken());
    expect(r.primary).toMatchObject({ key: "continue", blocked: true, blockedReason: MSG });
    const ff = r.overflow.find((a) => a.key === "ff");
    expect(ff).toMatchObject({ blocked: true, blockedReason: MSG });
    expect(r.overflow.find((a) => a.key === "explore")?.blocked).toBe(false);
    expect(r.overflow.find((a) => a.key === "detach")?.blocked).toBe(false);
    const keys = [r.primary?.key, ...r.overflow.map((a) => a.key)];
    expect(keys).not.toContain("archive");
    expect(keys).not.toContain("archiveAnyway");
  });

  it("#F3 continue workflow disabled: ff is the blocked primary and no continue action exists", () => {
    const wf = (w: string) => (WF.all as readonly string[]).includes(w) && w !== "continue";
    const r = deriveOpenSpecActions(broken({ wf }));
    expect(r.primary).toMatchObject({ key: "ff", blocked: true, blockedReason: MSG });
    expect([r.primary?.key, ...r.overflow.map((a) => a.key)]).not.toContain("continue");
  });

  it("#F6 error + streaming: the reason is the error message, not the streaming reason; detach stays enabled", () => {
    const r = deriveOpenSpecActions(broken({ working: true }));
    expect(r.primary).toMatchObject({ blocked: true, blockedReason: MSG });
    expect(r.primary?.blockedReasonKey).toBeUndefined();
    expect(r.overflow.find((a) => a.key === "explore")).toMatchObject({ blocked: true, blockedReasonKey: "session.sessionIsStreaming" });
    expect(r.overflow.find((a) => a.key === "detach")?.blocked).toBe(false);
  });

  it("no error → unchanged behaviour (no literal reason anywhere)", () => {
    const r = deriveOpenSpecActions(base({ state: ChangeState.PLANNING }));
    for (const a of [r.primary, ...r.overflow]) expect(a?.blockedReason).toBeUndefined();
    expect(r.primary?.blocked).toBe(false);
  });
});
