/**
 * Secret masking for every setup log line and handoff text.
 * See change: add-gmail-auto-setup.
 */

/** Google OAuth client secrets: `GOCSPX-` + url-safe base64. */
const CLIENT_SECRET_RE = /GOCSPX-[A-Za-z0-9_-]+/g;

export function maskSecrets(text: string): string {
  return text.replace(CLIENT_SECRET_RE, "GOCSPX-***");
}
