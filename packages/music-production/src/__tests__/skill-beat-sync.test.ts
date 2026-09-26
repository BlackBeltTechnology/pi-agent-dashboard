/**
 * #E26: beat-sync-video SKILL.md pins the scene-grid lock and the HyperFrames
 * punch adapter with its verification. See change: add-music-production-skills.
 */
import { describe, expect, it } from "vitest";
import { skill } from "./files";

const text = skill("beat-sync-video");

describe("beat-sync-video SKILL.md", () => {
  it("locks the scene grid to the music edit", () => {
    expect(text).toMatch(/root duration = music duration/i);
    expect(text).toContain("downbeats_video");
    expect(text).toMatch(/scene boundary[\s\S]{0,40}on each confirmed drop/i);
    expect(text).toMatch(/compress or stretch the scene/i);
  });

  it("documents the HyperFrames adapter", () => {
    expect(text).toMatch(/\.cam` wrapper INSIDE each sub-composition/);
    expect(text).toContain("immediateRender:false");
    expect(text).toContain("data-layout-allow-overflow");
    expect(text).toMatch(/alternate the horizontal jolt direction/i);
  });

  it("verifies punches with a snapshot pair and an edge-bleed check", () => {
    expect(text).toMatch(/snapshot pair/i);
    expect(text).toMatch(/edge-bleed check/i);
  });

  it("carries the approved recipe values", () => {
    expect(text).toMatch(/\| big \| 1\.12 \|/);
    expect(text).toMatch(/\| mid \| 1\.07 \|/);
  });
});
