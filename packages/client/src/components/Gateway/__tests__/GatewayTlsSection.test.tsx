import type { TlsCertStatus, TlsStatus, TlsStatusDetail } from "@blackbelt-technology/pi-dashboard-shared/tls-status.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gatewayApi from "../../../lib/gateway/gateway-api.js";
import * as tlsApi from "../../../lib/gateway/tls-api.js";
import { GatewayTlsSection } from "../GatewayTlsSection.js";
import { registerTlsSourceGroup, type TlsSourceGroupProps } from "../tls-source-groups.js";

/**
 * Built-in HTTPS section: status mapping, gates + fixes, switch, Renew now,
 * field errors, source-group registry, 5 s convergence. Fixtures mirror the
 * approved board (`mockups/tls.html`, `S.*`).
 * (test-plan #E29, #E30, #E35, #E36, #E37, #E49, #E50, #E52). See change: add-tailscale-cert-tls.
 */

const NOW = Date.parse("2026-10-19T09:00:00Z");
const IPV4 = "100.83.0.1";
const NAME = "studio.tail4e2a.ts.net";
const day = (n: number): number => NOW + n * 86_400_000;

const cert = (o: Partial<TlsCertStatus> = {}): TlsCertStatus => ({
  name: NAME,
  sourceId: "tailscale",
  sourceType: "tailscale",
  kind: "magicdns",
  held: true,
  notAfter: day(89),
  advertise: true,
  stage: "idle",
  ...o,
});
const base = (o: Partial<TlsStatusDetail> = {}): TlsStatusDetail => ({
  enabled: true,
  bound: true,
  port: 8443,
  host: IPV4,
  gates: [],
  sources: [{ id: "tailscale", type: "tailscale", details: { ipv4: IPV4 } }],
  certs: [],
  ...o,
});

const S = {
  off: { enabled: false, bound: false } as TlsStatus,
  daemon: base({ host: "127.0.0.1", sources: [{ id: "tailscale", type: "tailscale" }], gates: [{ id: "tailscale-running", ok: false, sourceId: "tailscale" }] }),
  gates: base({
    host: "127.0.0.1",
    gates: [
      { id: "https-certs", ok: false, sourceId: "tailscale" },
      { id: "bind-reachable", ok: false },
    ],
  }),
  issuing: base({ certs: [cert({ held: false, notAfter: undefined, stage: "requesting" })] }),
  ready: base({ certs: [cert()] }),
  renewing: base({ certs: [cert({ notAfter: day(28), stage: "requesting" })] }),
  failedHeld: base({ certs: [cert({ notAfter: day(14), lastError: "dial tcp: no such host", nextAttemptAt: NOW + 20 * 60_000 })] }),
  failedNone: base({ certs: [cert({ held: false, notAfter: undefined, lastError: "rate limited", nextAttemptAt: NOW + 160 * 60_000 })] }),
  portBusy: base({ bound: false, bindError: "EADDRINUSE: address already in use", certs: [cert()] }),
};

let status: TlsStatus | null;
let getStatus: ReturnType<typeof vi.spyOn>;
let putConfig: ReturnType<typeof vi.spyOn>;
let getConfig: ReturnType<typeof vi.spyOn>;
let issue: ReturnType<typeof vi.spyOn>;

const mount = (props: Partial<React.ComponentProps<typeof GatewayTlsSection>> = {}) =>
  render(<GatewayTlsSection now={() => NOW} {...props} />);

beforeEach(() => {
  status = S.ready;
  getStatus = vi.spyOn(tlsApi, "getTlsStatus").mockImplementation(async () => status);
  getConfig = vi.spyOn(gatewayApi, "getConfig").mockResolvedValue({
    tls: { enabled: true, port: 9443, host: "127.0.0.1", sources: [{ type: "tailscale" }] },
  });
  putConfig = vi.spyOn(gatewayApi, "putConfig").mockResolvedValue(undefined);
  issue = vi.spyOn(tlsApi, "issueTlsNow").mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const pill = () => screen.getByTestId("gateway-tls-pill");

describe("#E35 status → pill mapping", () => {
  it("never shows Off before the first status read; Checking… instead", async () => {
    let resolve!: (s: TlsStatus | null) => void;
    getStatus.mockImplementation(() => new Promise((r) => { resolve = r; }));
    mount();
    expect(pill().textContent).toContain("Checking…");
    expect(screen.queryByText("Off")).toBeNull();
    expect(screen.queryByTestId("gateway-tls-enabled")).toBeNull();
    await act(async () => resolve(S.off));
    expect(pill().textContent).toContain("Off");
  });

  const cases: Array<[string, TlsStatus, string]> = [
    ["off", S.off, "Off"],
    ["daemon down / gates", S.daemon, "Setup needed"],
    ["issuing", S.issuing, "Getting certificate…"],
    ["ready", S.ready, "On"],
    ["renewing (still held)", S.renewing, "On"],
    ["renewal failing", S.failedHeld, "On, renewal failing"],
    ["failed", S.failedNone, "Failed"],
    ["port busy", S.portBusy, "Stopped"],
  ];
  for (const [name, fixture, word] of cases) {
    it(`${name} → "${word}" with an icon`, async () => {
      status = fixture;
      mount();
      await waitFor(() => expect(pill().textContent).toContain(word));
      expect(pill().querySelector("svg")).not.toBeNull();
    });
  }

  it("an unknown running stage reads Working… on the row", async () => {
    status = base({ certs: [cert({ held: false, notAfter: undefined, stage: "validating-dns" })] });
    mount();
    await waitFor(() => expect(screen.getByTestId("gateway-tls-cert").textContent).toContain("Working…"));
  });
});

describe("#E29 gates with their fixes", () => {
  beforeEach(() => {
    status = S.gates;
  });

  it("shows both gate fixes, the Use <ipv4> action and the connect-by-name note once certificates exist", async () => {
    mount();
    await screen.findByTestId("gateway-tls-gate-https-certs");
    expect(screen.getByTestId("gateway-tls-gate-bind-reachable")).toBeDefined();
    expect(screen.getByTestId("gateway-tls-use-ipv4").textContent).toBe(`Use ${IPV4}`);
    const link = screen.getByTestId("gateway-tls-admin-link") as HTMLAnchorElement;
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.target).toBe("_blank");
  });

  it("the connect-by-name note names the certificate and warns about IP addresses", async () => {
    status = S.ready;
    mount();
    const note = await screen.findByTestId("gateway-tls-name-note");
    expect(note.textContent).toContain("Connect using this name");
    expect(note.textContent).toContain(IPV4);
    expect(screen.getByTestId("gateway-tls-url").textContent).toBe(`https://${NAME}:8443`);
  });

  it("Set up Tailscale above calls the page handler; Check now re-checks the source", async () => {
    status = S.daemon;
    const onSetup = vi.fn();
    mount({ onSetupRequested: onSetup });
    fireEvent.click(await screen.findByTestId("gateway-tls-setup-tailscale"));
    expect(onSetup).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("gateway-tls-check-tailscale-running"));
    await waitFor(() => expect(issue).toHaveBeenCalledWith("tailscale", undefined));
    // No Use-IPv4 button while the address is unknown.
    expect(screen.queryByTestId("gateway-tls-use-ipv4")).toBeNull();
  });
});

describe("#E30 one-click host keeps sibling keys", () => {
  it("PUTs the stored tls block with only host changed", async () => {
    status = S.gates;
    mount();
    fireEvent.click(await screen.findByTestId("gateway-tls-use-ipv4"));
    await waitFor(() => expect(putConfig).toHaveBeenCalledTimes(1));
    expect(putConfig).toHaveBeenCalledWith({
      tls: { enabled: true, port: 9443, host: IPV4, sources: [{ type: "tailscale" }] },
    });
  });
});

describe("#E36 Renew now", () => {
  it("posts {sourceId, name} and is disabled with Working… while requesting", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("gateway-tls-issue-now"));
    await waitFor(() => expect(issue).toHaveBeenCalledWith("tailscale", NAME));

    cleanup();
    status = S.issuing;
    mount();
    const btn = (await screen.findByTestId("gateway-tls-issue-now")) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("Working…");
  });

  it("offers Try again now when no certificate is held", async () => {
    status = S.failedNone;
    mount();
    expect((await screen.findByTestId("gateway-tls-issue-now")).textContent).toContain("Try again now");
    expect(screen.getByTestId("gateway-tls-last-error").textContent).toBe("rate limited");
  });
});

describe("#E37 port rejected at the field", () => {
  it("marks the input invalid with a linked role=alert and sends one PUT", async () => {
    putConfig.mockRejectedValue(new Error("tls.port 8000 is already used by port"));
    mount();
    const input = (await screen.findByTestId("gateway-tls-port")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "8000" } });
    fireEvent.click(screen.getByTestId("gateway-tls-apply"));
    const alert = await screen.findByTestId("gateway-tls-port-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(alert.textContent).toContain("8000");
    expect(putConfig).toHaveBeenCalledTimes(1);
  });

  it("an out-of-range port is refused locally without a PUT", async () => {
    mount();
    fireEvent.change(await screen.findByTestId("gateway-tls-port"), { target: { value: "70000" } });
    fireEvent.click(screen.getByTestId("gateway-tls-apply"));
    expect((await screen.findByTestId("gateway-tls-port-error")).textContent).toContain("1 to 65535");
    expect(putConfig).not.toHaveBeenCalled();
  });
});

describe("#E49 switch write failure reverts", () => {
  it("returns to off with an inline alert and sends one PUT", async () => {
    status = S.off;
    putConfig.mockRejectedValue(new Error("HTTP 500"));
    mount();
    const sw = await screen.findByTestId("gateway-tls-enabled");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    const alert = await screen.findByTestId("gateway-tls-switch-error");
    expect(alert.getAttribute("role")).toBe("alert");
    await waitFor(() => expect(screen.getByTestId("gateway-tls-enabled").getAttribute("aria-checked")).toBe("false"));
    expect(putConfig).toHaveBeenCalledTimes(1);
  });

  it("turning it on seeds the tailscale source when none is configured", async () => {
    status = S.off;
    getConfig.mockResolvedValue({ tls: { enabled: false, port: 8443, host: "127.0.0.1", sources: [] } });
    mount();
    fireEvent.click(await screen.findByTestId("gateway-tls-enabled"));
    await waitFor(() => expect(putConfig).toHaveBeenCalledTimes(1));
    expect(putConfig).toHaveBeenCalledWith({ tls: { enabled: true, sources: [{ type: "tailscale" }] } });
  });

  it("never seeds (and never writes) when the config read fails", async () => {
    status = S.off;
    getConfig.mockRejectedValue(new Error("HTTP 500"));
    mount();
    fireEvent.click(await screen.findByTestId("gateway-tls-enabled"));
    expect((await screen.findByTestId("gateway-tls-switch-error")).textContent).toContain("HTTP 500");
    expect(putConfig).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("gateway-tls-enabled").getAttribute("aria-checked")).toBe("false"));
  });

  it("does not re-seed when sources already exist", async () => {
    status = S.off;
    mount();
    fireEvent.click(await screen.findByTestId("gateway-tls-enabled"));
    await waitFor(() => expect(putConfig).toHaveBeenCalledTimes(1));
    expect(putConfig).toHaveBeenCalledWith({ tls: { enabled: true } });
  });
});

describe("#E50 source group registry", () => {
  it("renders a registered group via its component and an unregistered type via the generic rows", async () => {
    const Custom = ({ source, certs }: TlsSourceGroupProps) => (
      <div data-testid={`custom-${source.id}`}>custom group with {certs.length} cert</div>
    );
    registerTlsSourceGroup("custom-type", Custom);
    status = base({
      sources: [
        { id: "tailscale", type: "tailscale" },
        { id: "mine", type: "custom-type" },
        { id: "fake", type: "unregistered" },
      ],
      certs: [cert(), cert({ name: "a.test", sourceId: "mine", sourceType: "custom-type" }), cert({ name: "b.test", sourceId: "fake", sourceType: "unregistered" })],
    });
    mount();
    expect((await screen.findByTestId("gateway-tls-source-tailscale")).textContent).toContain("Tailscale");
    expect(screen.getByTestId("custom-mine").textContent).toBe("custom group with 1 cert");
    const generic = screen.getByTestId("gateway-tls-source-fake");
    expect(within(generic).getByText("b.test")).toBeDefined();
    expect(within(generic).getByTestId("gateway-tls-issue-now").textContent).toContain("Renew now");
    expect(within(generic).getByText(/Valid · /)).toBeDefined();
  });
});

describe("#E52 status converges without a reload", () => {
  it("shows On within one 5 s tick, never overlaps reads, and re-reads right after Renew now", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    status = S.issuing;
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(pill().textContent).toContain("Getting certificate…");
    expect(getStatus).toHaveBeenCalledTimes(1);

    status = S.ready;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(pill().textContent).toBe("On");
    expect(getStatus).toHaveBeenCalledTimes(2);

    // A slow read: the next tick must not start a second one.
    let release!: (s: TlsStatus) => void;
    getStatus.mockImplementation(() => new Promise((r) => { release = r; }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getStatus).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getStatus).toHaveBeenCalledTimes(3); // skipped while in flight
    await act(async () => release(S.ready));

    // Renew now → an immediate read (not waiting for the next tick).
    getStatus.mockImplementation(async () => status);
    const before = getStatus.mock.calls.length;
    fireEvent.click(screen.getByTestId("gateway-tls-issue-now"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(issue).toHaveBeenCalledTimes(1);
    expect(getStatus.mock.calls.length).toBeGreaterThan(before);
  });
});
