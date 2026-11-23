// Live viewer (editor pane) UI for serve-live-previews-on-capability-origin, design D7 + D11:
//   1. tier-5 (/preview/<pid>/) base-path hint with copy  (replaces the root-absolute dead-end hint)
//   2. copy feedback / fallback states
//   3. base changed after a holder left (pid rotated)
//   4. cookie-reset banner (duplicate pi_dash_* cookie 400)
//   5. mock site inside an opaque tier-5 frame: visible "storage unavailable" notice
// Current = SHIPPED LiveHeader + RootAbsoluteHint + the FrameBody iframe classes (LiveFrame.tsx:78-92).
// Proposed notices use the contract's one notice implementation (SettingsNotice, ui-contract "notice")
// and a labelled copy button at the viewer BTN size (copyText from lib/util/clipboard).
import { SettingsNotice } from "@blackbelt-technology/dashboard-plugin-runtime";
import { LiveHeader } from "@app/components/editor-pane/live/LiveHeader.tsx";
import { RootAbsoluteHint } from "@app/components/editor-pane/live/LiveFrameParts.tsx";
import { mdiCheck, mdiContentCopy } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Fix, Issue, type Mock, Tap } from "mock-site/kit";
import type { ReactNode } from "react";

const noop = () => {};
const BASE = "/preview/q3ZtV8nKx2LwP0aYc7Rb1g/";
const NEW_BASE = "/preview/Hd4sQ9mTe6UyB2vXk8NjfA/";
const BTN =
  "inline-flex min-h-[28px] items-center gap-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";

/** The editor-pane viewer shell: real LiveHeader, notices slot, frame body (FrameBody classes). */
function Viewer({ addr, notices, frame }: { addr: string; notices?: ReactNode; frame: ReactNode }) {
  return (
    <div className="flex h-[440px] min-h-0 flex-col border border-[var(--border-primary)] bg-[var(--bg-primary)]">
      <LiveHeader
        onBack={noop}
        root={null}
        addr={addr}
        addrInvalid={false}
        onAddrChange={noop}
        onSubmit={(e) => e.preventDefault()}
        restricted={false}
        onReload={noop}
        scriptsOn={null}
        onScriptsChange={noop}
        openHref={null}
        onOpen={noop}
      />
      {notices}
      {frame}
    </div>
  );
}

/** Blank iframe body exactly as FrameBody renders a page whose scripts never load. */
const BlankFrame = () => <div aria-label="preview frame" className="min-h-[16rem] flex-1 border-0 bg-white" />;

/** A rendered preview (what the page looks like once the server runs under the base). */
const RenderedFrame = () => (
  <div className="min-h-[16rem] flex-1 overflow-hidden bg-white p-4 text-[13px] text-neutral-800">
    <div className="mb-3 flex items-center gap-2 border-b border-neutral-200 pb-2">
      <b>Dashboard mocks</b>
      <span className="ml-auto rounded border border-neutral-300 px-2 py-0.5 text-[11px]">Theme: System</span>
    </div>
    <div className="font-semibold">File links - chat pill</div>
    <div className="mt-1 text-neutral-500">Chat · 3 frames</div>
  </div>
);

/** Base path as selectable mono text + the shipped CopyButton (failure stays visible: text is selectable). */
function BaseRow({ base, copiedHint }: { base: string; copiedHint?: boolean }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <code
        data-testid="live-preview-base"
        className="min-w-0 select-all break-all rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--text-primary)]"
      >
        {base}
      </code>
      {/* Labelled copy at the viewer BTN size (shipped CopyButton is 26x18, under the 24 px AA target).
          Uses lib/util/clipboard copyText; the label itself flips to "Copied" and is announced. */}
      <Tap>
        <button type="button" className={BTN} data-testid="live-preview-base-copy" aria-label="Copy base path">
          <Icon path={copiedHint ? mdiCheck : mdiContentCopy} size={0.6} />
          <span aria-live="polite">{copiedHint ? "Copied" : "Copy"}</span>
        </button>
      </Tap>
    </div>
  );
}

/** Proposed tier-5 hint: says what to do, gives the exact value, offers the one next action (Reload). */
function BasePathHint({ base, copied }: { base: string; copied?: boolean }) {
  return (
    <div className="mx-2 mt-1">
      <SettingsNotice
        tone="info"
        testId="live-hint-base-path"
        actions={
          <button type="button" className={BTN} data-testid="live-hint-reload">
            Reload
          </button>
        }
      >
        <strong className="font-semibold">Restart your server with this base</strong>
        <p className="m-0">This dashboard address cannot give the preview its own origin, so it runs under a path.</p>
        <BaseRow base={base} copiedHint={copied} />
        <p className="m-0 mt-1.5 text-[11px]">
          Vite: <code className="font-mono">vite --base {base}</code> · Next.js: <code className="font-mono">basePath</code>
        </p>
      </SettingsNotice>
    </div>
  );
}

function BaseChangedNotice() {
  return (
    <div className="mx-2 mt-1">
      <SettingsNotice
        tone="warning"
        role="alert"
        testId="live-hint-base-changed"
        actions={
          <button type="button" className={BTN}>
            Reload
          </button>
        }
      >
        <strong className="font-semibold">The preview path changed</strong>
        <p className="m-0">Another viewer of this server signed out, so the old path stopped working. Restart your server with the new base.</p>
        <BaseRow base={NEW_BASE} />
        <p className="m-0 mt-1.5 text-[11px]">
          Old path: <code className="font-mono line-through">{BASE}</code>
        </p>
      </SettingsNotice>
    </div>
  );
}

function CookieResetNotice() {
  return (
    <div className="mx-2 mt-1">
      <SettingsNotice
        tone="warning"
        role="alert"
        testId="live-cookie-reset"
        actions={
          <button type="button" className={BTN} data-testid="live-cookie-reset-reopen">
            Reopen preview
          </button>
        }
      >
        <strong className="font-semibold">A preview reset dashboard cookies; reopen it to continue</strong>
        <p className="m-0">The previewed page set a cookie with a dashboard name. The dashboard cleared it and closed the preview.</p>
      </SettingsNotice>
    </div>
  );
}

/** Mock-site chrome (package plain CSS --mk-* tokens) inside an opaque tier-5 frame. */
function MockSiteOpaque({ variant }: { variant: "current" | "proposed" }) {
  const notice = (
    <div role="status" className="mk-missing" style={{ borderColor: "var(--mk-line)", borderStyle: "solid" }}>
      <b style={{ color: "var(--mk-fg)" }}>Storage unavailable in this preview.</b> This frame has no origin of its own, so these are off:
      <ul>
        <li>remembered theme, highlights and pane heights</li>
        <li>pane height sync and find-in-frame</li>
        <li>highlight sync between panes</li>
      </ul>
      Open the mock site directly for the full experience.
    </div>
  );
  return (
    <div className="min-h-[16rem] flex-1 overflow-hidden p-4" style={{ background: "var(--mk-page)", color: "var(--mk-fg)", fontSize: 13 }}>
      <div className="mk-bar" style={{ position: "static" }}>
        <b>Dashboard mocks</b>
      </div>
      {variant === "current" ? (
        <Issue n={5} tip="Blank: storage throws, page dies" block>
          <div style={{ height: 140 }} />
        </Issue>
      ) : (
        <Fix n={5} tip="Renders + names what is off" block>
          <div>
            {notice}
            <div style={{ marginTop: 10, fontWeight: 600 }}>File links - chat pill</div>
            <div style={{ color: "var(--mk-muted)" }}>Chat · 3 frames</div>
          </div>
        </Fix>
      )}
    </div>
  );
}

const ADDR = "localhost:5299";

const mock: Mock = {
  title: "Live viewer - preview path and resets",
  category: "Editor pane",
  change: "serve-live-previews-on-capability-origin",
  frames: [
    {
      title: "Tunnel viewer - dev server needs a base path",
      width: 560,
      why: "Today a dead-end hint over a blank frame; proposed: the exact base, copy, and the one next step.",
      current: (
        <Viewer
          addr={ADDR}
          notices={
            <Issue n={1} tip="Dead end: no value, wrong advice" block>
              <RootAbsoluteHint />
            </Issue>
          }
          frame={<BlankFrame />}
        />
      ),
      proposed: (
        <Viewer
          addr={ADDR}
          notices={
            <Fix n={1} tip="Exact base + copy + Reload" block>
              <BasePathHint base={BASE} />
            </Fix>
          }
          frame={<BlankFrame />}
        />
      ),
    },
    {
      title: "Copy and restart flow",
      width: 420,
      why: "Each state drawn: copy, confirmation, then the page renders after the restart + Reload.",
      steps: [
        { label: "hint shown", proposed: <Viewer addr={ADDR} notices={<BasePathHint base={BASE} />} frame={<BlankFrame />} /> },
        { label: "copied", proposed: <Viewer addr={ADDR} notices={<BasePathHint base={BASE} copied />} frame={<BlankFrame />} /> },
        { label: "restarted + reloaded", proposed: <Viewer addr={ADDR} frame={<RenderedFrame />} /> },
      ],
    },
    {
      title: "Narrow pane - base path wraps, never truncates",
      width: 340,
      why: "The base is a secret path the user must copy exactly; it wraps instead of ellipsing.",
      proposed: <Viewer addr={ADDR} notices={<BasePathHint base={BASE} />} frame={<BlankFrame />} />,
    },
    {
      title: "Preview path changed",
      width: 560,
      why: "A holder signed out, so the shared pid was dropped (D-U7): say why, give the new base.",
      proposed: (
        <Viewer
          addr={ADDR}
          notices={
            <Fix n={3} tip="Why + new base + Reload" block>
              <BaseChangedNotice />
            </Fix>
          }
          frame={<BlankFrame />}
        />
      ),
    },
    {
      title: "Cookie reset - LAN preview closed",
      width: 560,
      why: "Duplicate dashboard cookie refused (400): frame blanked, cause named, manual reopen only.",
      proposed: (
        <Viewer
          addr="localhost:5173"
          notices={
            <Fix n={4} tip="Alert + manual Reopen, no loop" block>
              <CookieResetNotice />
            </Fix>
          }
          frame={<BlankFrame />}
        />
      ),
    },
    {
      title: "Mock site in an opaque tier-5 frame",
      width: 560,
      why: "No origin means no storage: today the page dies blank; proposed it renders and says what is off.",
      current: <Viewer addr={ADDR} frame={<MockSiteOpaque variant="current" />} />,
      proposed: <Viewer addr={ADDR} frame={<MockSiteOpaque variant="proposed" />} />,
    },
  ],
};
export default mock;
