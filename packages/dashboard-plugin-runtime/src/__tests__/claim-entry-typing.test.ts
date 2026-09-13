/**
 * Type-contract tests for the slot-keyed `ClaimEntry<S>`.
 *
 * These tests have NO runtime assertions; they exist to lock the type-level
 * contract introduced in change `slot-generic-claim-entry`. Each block either
 * compiles (✓) or relies on `@ts-expect-error` to assert that a mis-shaped
 * registration is rejected by the type-checker (✓ if the directive flips
 * green — i.e. the error did materialize).
 *
 * Running `tsc --noEmit` (or `npm run lint`) is what actually validates these
 * assertions. Vitest just gives us a place to keep them adjacent to other
 * registry tests.
 */
import { describe, it, expect } from "vitest";
import type { ClaimEntry, FolderDescriptor } from "../slot-registry.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Sample predicates with realistic narrow signatures.
const sessionPredicate = (s: DashboardSession | null | undefined): boolean =>
  Boolean(s?.id);
const folderPredicate = (f: FolderDescriptor): boolean => f.cwd.length > 0;
// A legacy `unknown`-typed predicate, simulating an external plugin that
// retained the old broad contract.
const unknownPredicate = (_p: unknown): boolean => true;

describe("ClaimEntry<S> typing contract", () => {
  it("accepts a session-shaped predicate on a session-scoped slot", () => {
    const entry: ClaimEntry<"session-card-badge"> = {
      pluginId: "test",
      priority: 100,
      slot: "session-card-badge",
      predicate: sessionPredicate,
    };
    expect(entry.slot).toBe("session-card-badge");
  });

  it("classifies composer-context-group as session-scoped (DashboardSession)", () => {
    // Adding a slot id without classifying its predicate input is a build
    // failure via `_AssertAllSlotsPredicateClassified` in slot-types.ts; this
    // pins the runtime-observable classification for the new slot.
    const entry: ClaimEntry<"composer-context-group"> = {
      pluginId: "test",
      priority: 100,
      slot: "composer-context-group",
      predicate: sessionPredicate,
    };
    expect(entry.slot).toBe("composer-context-group");
  });

  it("rejects a folder-shaped predicate on composer-context-group", () => {
    const entry: ClaimEntry<"composer-context-group"> = {
      pluginId: "test",
      priority: 100,
      slot: "composer-context-group",
      // @ts-expect-error — folderPredicate takes FolderDescriptor, which is not
      // assignable to SlotPredicateInput<"composer-context-group"> = DashboardSession.
      predicate: folderPredicate,
    };
    expect(entry.slot).toBe("composer-context-group");
  });

  it("accepts a folder-shaped predicate on a folder-scoped slot", () => {
    const entry: ClaimEntry<"sidebar-folder-section"> = {
      pluginId: "test",
      priority: 100,
      slot: "sidebar-folder-section",
      predicate: folderPredicate,
    };
    expect(entry.slot).toBe("sidebar-folder-section");
  });

  it("accepts a legacy unknown-typed predicate on any slot (non-breaking)", () => {
    const sessionEntry: ClaimEntry<"session-card-badge"> = {
      pluginId: "test",
      priority: 100,
      slot: "session-card-badge",
      predicate: unknownPredicate,
    };
    const folderEntry: ClaimEntry<"sidebar-folder-section"> = {
      pluginId: "test",
      priority: 100,
      slot: "sidebar-folder-section",
      predicate: unknownPredicate,
    };
    expect(sessionEntry.slot).toBe("session-card-badge");
    expect(folderEntry.slot).toBe("sidebar-folder-section");
  });

  it("rejects a session-shaped predicate on a folder-scoped slot", () => {
    const entry: ClaimEntry<"sidebar-folder-section"> = {
      pluginId: "test",
      priority: 100,
      slot: "sidebar-folder-section",
      // @ts-expect-error — sessionPredicate takes DashboardSession,
      // which is not assignable to SlotPredicateInput<"sidebar-folder-section"> = FolderDescriptor.
      predicate: sessionPredicate,
    };
    expect(entry.slot).toBe("sidebar-folder-section");
  });

  it("rejects a folder-shaped predicate on a session-scoped slot", () => {
    const entry: ClaimEntry<"session-card-badge"> = {
      pluginId: "test",
      priority: 100,
      slot: "session-card-badge",
      // @ts-expect-error — folderPredicate takes FolderDescriptor,
      // which is not assignable to SlotPredicateInput<"session-card-badge"> = DashboardSession | null | undefined.
      predicate: folderPredicate,
    };
    expect(entry.slot).toBe("session-card-badge");
  });

  it("compiles (but does not invoke) a predicate on a predicate-irrelevant slot", () => {
    // Under method-shorthand bivariance, `(s: DashboardSession | null | undefined) => boolean`
    // is assignable to `(input: never) => boolean`. The contract intentionally
    // accepts this for backward compatibility — filter helpers never invoke the
    // registered predicate on settings-section / tool-renderer / descriptor-only
    // slots, so the function is dead code at runtime.
    const entry: ClaimEntry<"settings-section"> = {
      pluginId: "test",
      priority: 100,
      slot: "settings-section",
      predicate: sessionPredicate,
    };
    expect(entry.slot).toBe("settings-section");
  });
});
