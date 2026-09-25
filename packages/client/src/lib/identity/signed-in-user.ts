/**
 * Who is signed in, for the D22 user line. `/auth/status` sits outside `/api/`,
 * so the device-auth fetch wrapper does not attach the bearer: send the
 * in-memory identity token explicitly. Null whenever there is nothing to show
 * (no identity token, plane not enforced, no principal, network failure).
 */

import { getAccessToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";
import { useEffect, useState } from "react";
import { getApiBase } from "../api/api-context.js";
import { fetchLoginConfig, type LoginConfig } from "./login-config.js";

export interface SignedInUser {
  sub: string;
  name?: string;
  email?: string;
}

export interface SignedIn {
  user: SignedInUser;
  config: LoginConfig;
}

export async function loadSignedInUser(deps: {
  token: string | null;
  apiBase: string;
  fetchFn: typeof fetch;
  fetchConfig: () => Promise<LoginConfig>;
}): Promise<SignedIn | null> {
  if (!deps.token) return null;
  try {
    const res = await deps.fetchFn(`${deps.apiBase}/auth/status`, { headers: { Authorization: `Bearer ${deps.token}` } });
    const data = (await res.json()) as { authEnabled?: boolean; principal?: SignedInUser };
    if (data.authEnabled !== true || !data.principal?.sub) return null;
    return { user: data.principal, config: await deps.fetchConfig() };
  } catch {
    return null;
  }
}

/** Load once per connect; `connected` re-triggers after a reconnect. */
export function useSignedInUser(connected: boolean): SignedIn | null {
  const [value, setValue] = useState<SignedIn | null>(null);
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    void loadSignedInUser({ token: getAccessToken(), apiBase: getApiBase(), fetchFn: fetch, fetchConfig: fetchLoginConfig }).then((v) => {
      if (alive) setValue(v);
    });
    return () => {
      alive = false;
    };
  }, [connected]);
  return value;
}
