import { useState, useEffect } from "react";
import { getApiBase } from "../lib/api/api-context.js";

export interface AuthStatus {
  authenticated: boolean;
  authEnabled?: boolean;
  user?: { name: string; email: string; provider: string };
}

/**
 * Fetch auth status from the server.
 * Returns { loading, authStatus }.
 * If auth is not configured, authStatus.authEnabled will be false.
 */
export function useAuthStatus() {
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    fetch(`${getApiBase()}/auth/status`)
      .then((res) => res.json())
      .then((data) => setAuthStatus(data))
      .catch(() => {
        // If /auth/status 404s, auth is not enabled
        setAuthStatus({ authenticated: true, authEnabled: false });
      })
      .finally(() => setLoading(false));
  }, []);

  return { loading, authStatus };
}

/**
 * Redirect to login page. Used when WebSocket is rejected with 401.
 */
export function redirectToLogin() {
  window.location.href = `${getApiBase()}/auth/login?return=${encodeURIComponent(window.location.pathname)}`;
}
