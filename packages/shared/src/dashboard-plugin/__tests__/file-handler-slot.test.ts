/**
 * `editor-pane-file-handler` slot taxonomy + shared helpers (#E6).
 * See change: add-editor-pane-file-handlers.
 */
import { describe, expect, it } from "vitest";
import {
  fileHandlerClaimKey,
  HANDLER_MAX_BYTES,
  parseFileHandlerClaimKey,
} from "../file-handler.js";
import type { FileHandlerProps, SlotPropsMap } from "../slot-props.js";
import { SLOT_DEFINITIONS, type SlotId, type SlotPredicateInput } from "../slot-types.js";

describe("editor-pane-file-handler slot taxonomy (#E6)", () => {
  it("is a `many`, react-only slot", () => {
    expect(SLOT_DEFINITIONS["editor-pane-file-handler"]).toMatchObject({ multiplicity: "many", payloadTier: "react-only" });
    const id: SlotId = "editor-pane-file-handler";
    expect(id).toBe("editor-pane-file-handler");
  });

  it("predicate input classifies to `never` (compile-time pin)", () => {
    // @ts-expect-error — a concrete input is a type error against `never`.
    const bad: SlotPredicateInput<"editor-pane-file-handler"> = { cwd: "/x" };
    expect(bad).toEqual({ cwd: "/x" });
  });

  it("props map entry is FileHandlerProps", () => {
    const p: SlotPropsMap["editor-pane-file-handler"] = {} as FileHandlerProps;
    expect(p).toBeDefined();
  });
});

describe("file-handler helpers", () => {
  it("HANDLER_MAX_BYTES is 128 MiB", () => expect(HANDLER_MAX_BYTES).toBe(134217728));
  it("claim key round-trips", () => {
    expect(fileHandlerClaimKey("wc", "word")).toBe("wc/word");
    expect(parseFileHandlerClaimKey("wc/word")).toEqual({ pluginId: "wc", claimId: "word" });
    for (const bad of ["", "wc", "wc/", "/word", "a/b/c"]) expect(parseFileHandlerClaimKey(bad)).toBeNull();
  });
});
