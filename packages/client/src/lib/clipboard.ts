/**
 * copyText — clipboard write with a non-secure-context fallback.
 *
 * `navigator.clipboard.writeText` requires HTTPS or localhost. Remote
 * dashboard deployments over plain HTTP (zrok/ngrok tunnels) lack it, so
 * we fall back to a hidden `<textarea>` + `document.execCommand("copy")`.
 *
 * Returns true when the copy succeeded by either path.
 *
 * See change: register-bash-and-tool-install-help.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea path.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      return document.execCommand("copy");
    } finally {
      // Guarantee the hidden node is removed even if execCommand throws.
      ta.remove();
    }
  } catch {
    return false;
  }
}
