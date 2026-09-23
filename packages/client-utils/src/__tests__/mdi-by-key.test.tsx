/**
 * Lazy full-MDI-icon-set loader (test-plan #E3, #F1, #X1).
 *
 * See change: harden-ios-safari-memory-and-ws-diagnostics.
 */

import { mdiCheck, mdiRefresh } from "@mdi/js";
import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetMdiIconSetForTests,
  __setMdiIconSetImporterForTests,
  loadMdiIconSet,
  resolveMdiIconSync,
  useMdiIconByKey,
} from "../mdi-by-key.js";

const realImporter = () => import("@mdi/js/commonjs/mdi.js");

beforeEach(() => __resetMdiIconSetForTests());
afterEach(() => {
  cleanup();
  __resetMdiIconSetForTests();
});

function Probe({ iconKey }: { iconKey: string }) {
  const path = useMdiIconByKey(iconKey);
  return path ? <svg data-key={iconKey}><path d={path} /></svg> : null;
}

describe("resolveMdiIconSync (test-plan #E3)", () => {
  it("returns null for every key before the set is loaded", () => {
    expect(resolveMdiIconSync("mdiRefresh")).toBeNull();
  });

  it("resolves a valid key and rejects unknown/bad-prefix/empty/null keys", async () => {
    const set = await loadMdiIconSet();
    expect(set).not.toBeNull();
    expect(resolveMdiIconSync("mdiRefresh")).toBe(mdiRefresh);
    expect(resolveMdiIconSync("mdiTotallyMadeUpName")).toBeNull();
    expect(resolveMdiIconSync("refresh")).toBeNull();
    expect(resolveMdiIconSync("")).toBeNull();
    expect(resolveMdiIconSync(null)).toBeNull();
  });
});

describe("useMdiIconByKey — shared single load (test-plan #F1)", () => {
  it("runs the dynamic import exactly once for 5 consumers mounted in one tick", async () => {
    const spy = vi.fn(realImporter);
    __setMdiIconSetImporterForTests(spy);
    const keys = ["mdiRefresh", "mdiCheck", "mdiClose", "mdiPlay", "mdiStop"];
    const { container } = render(
      <>
        {keys.map((k) => (
          <Probe key={k} iconKey={k} />
        ))}
      </>,
    );
    await waitFor(() => expect(container.querySelectorAll("svg")).toHaveLength(5));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("useMdiIconByKey — keys that cannot resolve", () => {
  it("does not fetch the icon set for empty or non-mdi keys", async () => {
    const spy = vi.fn(realImporter);
    __setMdiIconSetImporterForTests(spy);
    render(
      <>
        <Probe iconKey="refresh" />
        <Probe iconKey="" />
      </>,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("useMdiIconByKey — import failure (test-plan #X1)", () => {
  it("renders nothing on a failed import, then retries on the next mount", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let calls = 0;
      __setMdiIconSetImporterForTests(() => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error("chunk fetch failed")) : realImporter();
      });

      const first = render(<Probe iconKey="mdiCheck" />);
      await waitFor(() => expect(calls).toBe(1));
      // Let the rejection settle.
      await new Promise((r) => setTimeout(r, 0));
      expect(first.container.querySelector("svg")).toBeNull();
      first.unmount();

      const second = render(<Probe iconKey="mdiCheck" />);
      await waitFor(() =>
        expect(second.container.querySelector("path")?.getAttribute("d")).toBe(mdiCheck),
      );
      expect(calls).toBe(2);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
