import { describe, expect, it } from "vitest";
import { isSameOriginByHost } from "../auth/cors-origin.js";
import {
  classifyAdmittedHostname,
  type HostAdmissionOptions,
  isHostAdmitted,
} from "../auth/host-admission.js";

/**
 * Pure host-admission decision (test-plan #E1–#E6, #E8).
 * See change: add-host-allowlist-admission.
 */

const everything = (over: Partial<HostAdmissionOptions> = {}): HostAdmissionOptions => ({
  allowedHosts: ["dash.home.arpa"],
  publicBaseUrls: ["https://pi.example.com:8443"],
  configuredOrigins: ["https://dash.example"],
  getLiveTunnelOrigins: () => ["https://abc.share.zrok.io"],
  bindHost: "dash-host",
  ...over,
});

describe("#E1 hostname-only normalisation", () => {
  const opts: HostAdmissionOptions = { allowedHosts: ["dash.home.arpa"] };
  it("strips port, case-folds, strips a trailing dot, strips IPv6 brackets", () => {
    expect(isHostAdmitted("dash.home.arpa:9443", opts)).toBe(true);
    expect(isHostAdmitted("DASH.home.arpa.", opts)).toBe(true);
    expect(isHostAdmitted("[::1]:8000", opts)).toBe(true);
  });
});

describe("#E2 fail closed on missing / malformed Host", () => {
  it("never admits an unparsable or absent Host", () => {
    const opts = everything();
    for (const host of [
      undefined,
      "",
      "evil.example/@localhost",
      "a b",
      ".local",
      "127.1",
      "2130706433",
      "[dash.home.arpa]",
    ]) {
      expect(isHostAdmitted(host, opts), String(host)).toBe(false);
    }
  });
});

describe("#E3 IP-literal rule on a wildcard bind", () => {
  const opts: HostAdmissionOptions = { bindHost: "0.0.0.0", allowedHosts: [] };
  it("admits any IP literal, refuses a name", () => {
    for (const host of ["192.168.1.50:8000", "[fe80::1]:8000", "::ffff:127.0.0.1", "10.4.0.9"]) {
      expect(isHostAdmitted(host, opts), host).toBe(true);
    }
    expect(isHostAdmitted("rebind.example", opts)).toBe(false);
  });
});

describe("#E4 bind-address name", () => {
  const opts: HostAdmissionOptions = { bindHost: "dash-host" };
  it("admits exactly the bind name", () => {
    expect(isHostAdmitted("dash-host:8000", opts)).toBe(true);
    expect(isHostAdmitted("dash-host2:8000", opts)).toBe(false);
  });
});

describe("#E5 .local label boundary", () => {
  const opts: HostAdmissionOptions = {};
  it("admits label.local, refuses bare .local and lookalikes", () => {
    expect(isHostAdmitted("mac.local", opts)).toBe(true);
    expect(isHostAdmitted("a.b.local", opts)).toBe(true);
    expect(isHostAdmitted(".local", opts)).toBe(false);
    expect(isHostAdmitted("local", opts)).toBe(false);
    expect(isHostAdmitted("evil.localx", opts)).toBe(false);
  });
});

describe("#E6 derived sources + unparseable entries", () => {
  it("admits each derived host, skips unparseable entries without throwing", () => {
    const opts: HostAdmissionOptions = {
      publicBaseUrls: ["https://pi.example.com:8443", "not a url"],
      configuredOrigins: ["https://dash.example", "not a url"],
      getLiveTunnelOrigins: () => ["https://abc.share.zrok.io", "not a url"],
      allowedHosts: ["dash.home.arpa", "not a url"],
    };
    for (const host of ["pi.example.com", "dash.example", "abc.share.zrok.io", "dash.home.arpa"]) {
      expect(isHostAdmitted(host, opts), host).toBe(true);
    }
    expect(isHostAdmitted("xyz.share.zrok.io", opts)).toBe(false);
  });

  it("reports the first-matching source", () => {
    expect(classifyAdmittedHostname("pi.example.com", everything())).toBe("public-base-url");
    expect(classifyAdmittedHostname("dash.example", everything())).toBe("cors-origin");
    expect(classifyAdmittedHostname("abc.share.zrok.io", everything())).toBe("live-tunnel");
    expect(classifyAdmittedHostname("dash.home.arpa", everything())).toBe("allowed-host");
    expect(classifyAdmittedHostname("localhost", everything())).toBe("loopback");
    expect(classifyAdmittedHostname("10.0.0.5", everything())).toBe("ip-address");
    expect(classifyAdmittedHostname("dash-host", everything())).toBe("bind-address");
    expect(classifyAdmittedHostname("mac.local", everything())).toBe("local");
  });
});

describe("#E8 same-origin-by-Host tightened only in enforce", () => {
  const base = {
    configuredOrigins: [] as string[],
    trustedNetworks: [] as string[],
    allowedHosts: ["dash.home.arpa"],
  };
  it("report keeps today's rule; enforce requires an admissible Host", () => {
    expect(
      isSameOriginByHost("http://rebind.example:8000", "rebind.example:8000", {
        ...base,
        hostGateMode: "report",
      }),
    ).toBe(true);
    expect(
      isSameOriginByHost("http://rebind.example:8000", "rebind.example:8000", {
        ...base,
        hostGateMode: "enforce",
      }),
    ).toBe(false);
    expect(
      isSameOriginByHost("http://mac.local:8000", "mac.local:8000", {
        ...base,
        hostGateMode: "enforce",
      }),
    ).toBe(true);
    expect(
      isSameOriginByHost("http://mac.local:8000", "mac.local:8000", {
        ...base,
        hostGateMode: "report",
      }),
    ).toBe(true);
  });
});
