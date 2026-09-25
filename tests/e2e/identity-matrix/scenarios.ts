/**
 * D21 identity SETUP MATRIX — one dashboard per operator setup (openspec:
 * add-multi-user-identity-plane, design D21, test-plan LK-*). Each row boots its
 * own dashboard (own HOME, own port) against the shared fake OIDC issuer; the
 * specs assert what an operator actually gets for that setup.
 *
 * Shared by global-setup (to boot) and the specs (to assert) — keep it data only.
 */

export type ResolverMode = "on" | "off" | "dead";
export type LoginPluginMode = "none" | "good" | "broken";
export type Extra = "none" | "bogus-provider" | "github-provider" | "absent-policy" | "login-unconfigured";

export interface Scenario {
  id: string;
  title: string;
  resolver: ResolverMode;
  loginPlugin: LoginPluginMode;
  /** Is `identity-login-plane` listed in `identity.trustedResolverPlugins`? */
  trustLoginPlugin: boolean;
  extra: Extra;
  expect: {
    /** Identity enforced (login-config `active:true`). */
    armed: boolean;
    /** Startup `[identity] identity is NOT enforced` reason, or null for none. */
    disarmReason: RegExp | null;
    /** Legacy cookie auth mounted (D8) — changes the remote refusal code + /auth/status shape. */
    legacyAuth: boolean;
    /** Extra startup log line that must appear. */
    logLine?: RegExp;
  };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "A", title: "resolver + trusted login plugin (fully configured)",
    resolver: "on", loginPlugin: "good", trustLoginPlugin: true, extra: "none",
    expect: { armed: true, disarmReason: null, legacyAuth: false },
  },
  {
    id: "B", title: "resolver only, no login plugin",
    resolver: "on", loginPlugin: "none", trustLoginPlugin: false, extra: "none",
    expect: { armed: false, disarmReason: /no login provider is registered/, legacyAuth: false },
  },
  {
    id: "C", title: "login plugin registers its descriptor then fails activation",
    resolver: "on", loginPlugin: "broken", trustLoginPlugin: true, extra: "none",
    expect: {
      armed: false, disarmReason: /no login provider is registered/, legacyAuth: false,
      logLine: /plugin 'identity-login-plane' failed to load; its resolver\/login registrations were released/,
    },
  },
  {
    id: "D", title: "fully configured + an auth.providers entry that resolves to nothing",
    resolver: "on", loginPlugin: "good", trustLoginPlugin: true, extra: "bogus-provider",
    expect: { armed: true, disarmReason: null, legacyAuth: false, logLine: /no providers resolved/ },
  },
  {
    id: "E", title: "no identity plugins (baseline)",
    resolver: "off", loginPlugin: "none", trustLoginPlugin: false, extra: "none",
    expect: { armed: false, disarmReason: null, legacyAuth: false },
  },
  {
    id: "F", title: "login plugin without a resolver",
    resolver: "off", loginPlugin: "good", trustLoginPlugin: true, extra: "none",
    expect: { armed: false, disarmReason: /no principal resolver is active/, legacyAuth: false },
  },
  {
    id: "G", title: "fully configured + named-but-absent trustedPolicyPlugin (D9)",
    resolver: "on", loginPlugin: "good", trustLoginPlugin: true, extra: "absent-policy",
    expect: { armed: false, disarmReason: /trustedPolicyPlugin 'nope-policy' registered 0 policies/, legacyAuth: false },
  },
  {
    id: "H", title: "fully configured + a MOUNTED legacy auth.providers connector (D8)",
    resolver: "on", loginPlugin: "good", trustLoginPlugin: true, extra: "github-provider",
    expect: { armed: false, disarmReason: /auth\.providers confidential cookie connectors are active/, legacyAuth: true },
  },
  {
    id: "I", title: "fully configured but the IdP is unreachable",
    resolver: "dead", loginPlugin: "good", trustLoginPlugin: true, extra: "none",
    expect: { armed: true, disarmReason: null, legacyAuth: false },
  },
  {
    id: "J", title: "login plugin present but NOT trusted",
    resolver: "on", loginPlugin: "good", trustLoginPlugin: false, extra: "none",
    expect: {
      armed: false, disarmReason: /no login provider is registered/, legacyAuth: false,
      logLine: /plugin 'identity-login-plane' is not trusted to publish a browser login config/,
    },
  },
  {
    id: "K", title: "login plugin installed + trusted, but Keycloak NOT configured",
    resolver: "on", loginPlugin: "good", trustLoginPlugin: true, extra: "login-unconfigured",
    expect: {
      armed: false, disarmReason: /no login provider is registered/, legacyAuth: false,
      logLine: /Keycloak not configured \(missing issuer, clientId\); sign-in NOT offered/,
    },
  },
];

/** Runtime state written by global-setup, read by the specs. */
export interface MatrixState {
  issuer: string;
  /** A non-loopback IPv4 of this host, or null when none exists (LAN checks skip). */
  lanHost: string | null;
  instances: Record<string, { port: number; home: string; log: string }>;
}
