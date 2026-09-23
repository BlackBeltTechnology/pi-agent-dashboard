/**
 * D22 user line, pinned to the bottom of the session list (bottom-left).
 * Mockup: openspec/changes/add-multi-user-identity-plane/mockups/login-logout.html
 * (state 4). Rendered only while identity is enforced AND a principal resolved.
 */

import { clearAccessToken, getIdToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";
import { mdiLogout } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { signOutTarget } from "../../lib/identity/dashboard-login.js";
import { providerById } from "../../lib/identity/login-config.js";
import { useLoginSession } from "../../lib/identity/login-session.js";
import { type SignedInUser, useSignedInUser } from "../../lib/identity/signed-in-user.js";

/** "Anna Kovacs" → "AK"; "anna@x" → "A"; "" → "?". */
export function initialsOf(display: string): string {
  const words = display.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : words[0][0];
  return letters.toUpperCase();
}

export function UserBar({ user, label, onSignOut }: { user: SignedInUser; label?: string; onSignOut: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const display = user.name ?? user.email ?? user.sub;
  const detail = [user.name ? user.email : undefined, label].filter(Boolean).join(" · ");
  return (
    <div
      data-testid="user-bar"
      className="flex items-center gap-2 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-xs"
    >
      <span
        aria-hidden="true"
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border border-[var(--border-secondary)] bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--text-primary)]"
      >
        {initialsOf(display)}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate font-semibold text-[var(--text-primary)]">{display}</div>
        {detail && (
          <div className="truncate text-[var(--text-tertiary)]">
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
            {detail}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onSignOut}
        data-testid="user-bar-signout"
        className="focus-ring inline-flex items-center gap-1 rounded-md border border-[var(--border-secondary)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <Icon path={mdiLogout} size={0.5} />
        {t("identity.signOut", undefined, "Sign out")}
      </button>
    </div>
  );
}

/** Self-loading bar for the session list: who is signed in + Sign out. */
export function SignedInUserBar({ connected }: { connected: boolean }): React.JSX.Element | null {
  const signedIn = useSignedInUser(connected);
  const { providerId } = useLoginSession();
  if (!signedIn) return null;
  // The provider this page signed in with (D25); single-provider ⇒ the first.
  const provider = providerById(signedIn.config, providerId) ?? signedIn.config.providers[0];
  return (
    <UserBar
      user={signedIn.user}
      label={provider?.label}
      onSignOut={() => {
        // Drop the in-memory bearer first, then let the plugin end the IdP
        // session and land on its postLogoutUrl (D22).
        // The id_token (memory only) rides along as id_token_hint so the IdP
        // does not stop on its own "Do you want to log out?" page.
        const target = signOutTarget(provider, window.location.origin, getIdToken());
        clearAccessToken();
        window.location.assign(target);
      }}
    />
  );
}
