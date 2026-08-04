/**
 * `usePackageOperations.coreUpdate` — the typed pi-core entry point.
 *
 * See change: unify-pi-core-into-package-queue.
 */
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { packageQueue } from "../../lib/package/package-queue.js";
import { usePackageOperations } from "../usePackageOperations.js";

const PI = "@mariozechner/pi-coding-agent";
const PI_SRC = `pi-core:${PI}`;

type Api = ReturnType<typeof usePackageOperations>;

function Harness({ onRender }: { onRender: (api: Api) => void }) {
  const ops = usePackageOperations("global");
  onRender(ops);
  return null;
}

function jsonResponse(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Fetch mock whose response resolution is deferred to the test body. */
function makeDeferredFetchMock(payload: any, status = 200) {
  let resolveBody!: (r: Response) => void;
  const bodyPromise = new Promise<Response>((res) => {
    resolveBody = res;
  });
  const fetchMock = vi.fn(async () => bodyPromise);
  return { fetchMock, settle: () => resolveBody(jsonResponse(payload, status)) };
}

async function flush() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe("usePackageOperations — coreUpdate", () => {
  beforeEach(() => {
    packageQueue.__resetForTests();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("enqueues a pi-core op, holds runningSource until the POST resolves, then succeeds", async () => {
    const { fetchMock, settle } = makeDeferredFetchMock({
      success: true,
      data: { results: [{ name: PI, success: true }] },
    });
    vi.stubGlobal("fetch", fetchMock);

    let api!: Api;
    render(<Harness onRender={(a) => { api = a; }} />);

    await act(async () => {
      api.coreUpdate(PI);
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/pi-core/update");
    expect(JSON.parse(init.body as string)).toEqual({ packages: [PI] });

    expect(api.runningSource).toBe(PI_SRC);
    expect(api.statusFor(PI_SRC)).toBe("running");
    expect(api.isAnyRunning).toBe(true);

    await act(async () => {
      settle();
      await flush();
    });

    expect(api.runningSource).toBeNull();
    expect(api.statusFor(PI_SRC)).toBe("success");
    expect(api.isAnyRunning).toBe(false);
  });

  it("surfaces a failed result as an error keyed by the prefixed source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: { results: [{ name: PI, success: false, error: "boom" }] },
        }),
      ),
    );

    let api!: Api;
    render(<Harness onRender={(a) => { api = a; }} />);

    await act(async () => {
      api.coreUpdate(PI);
      await flush();
    });

    expect(api.statusFor(PI_SRC)).toBe("error");
    expect(api.messageFor(PI_SRC)).toBe("boom");
  });
});
