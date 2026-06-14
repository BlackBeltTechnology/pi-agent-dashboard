---

### First-launch unblocking (unsigned binaries)

The Windows installers and macOS DMGs are not yet code-signed / notarized.
Both OSes will block first-launch with a security warning. These are not
malware — the artifacts are the exact ones produced by
[`.github/workflows/publish.yml`](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/main/.github/workflows/publish.yml)
against this tag. Pick whichever workaround fits your workflow.

**Tracking:** Authenticode signing → change `windows-authenticode-signing`;
macOS notarization → change `macos-notarization` (planned). This section
will shrink and eventually disappear as each lands.

#### Windows — SmartScreen warning

SmartScreen will show **"Windows protected your PC"** the first time you
run any `.exe` artifact (Setup, or any `.exe` extracted from a ZIP).

**Option A — at the SmartScreen dialog:**

1. Click **More info**.
2. Click **Run anyway**.

**Option B — pre-clear the Mark-of-the-Web:**

1. Right-click the downloaded `.exe` (or the `.zip`) → **Properties**.
2. At the bottom of the **General** tab, tick **Unblock** next to
   *"This file came from another computer..."*.
3. Click **OK** and run as normal.

For ZIP archives, **unblock the archive itself before extracting** so
the contained `.exe`s inherit the cleared zone.

#### macOS — Gatekeeper / quarantine

macOS will refuse to launch the app on first run with **"PI Dashboard
cannot be opened because the developer cannot be verified"** or silently
quarantine it.

**Option A — control-click the app:**

1. Open the DMG and drag **PI Dashboard** to **Applications**.
2. In **Applications**, **right-click (or Control-click) PI Dashboard →
   Open**.
3. Click **Open** in the confirmation dialog. Subsequent launches are
   unrestricted.

**Option B — clear the quarantine attribute from the terminal:**

```bash
xattr -d com.apple.quarantine "/Applications/PI Dashboard.app"
```

If the DMG itself is being blocked, clear it on the mounted volume
before copying:

```bash
xattr -d com.apple.quarantine "/Volumes/PI Dashboard/PI Dashboard.app"
```
