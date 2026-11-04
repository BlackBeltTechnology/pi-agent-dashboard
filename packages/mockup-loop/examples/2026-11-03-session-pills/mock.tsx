// Example live-component mock: real client components, rings on the divs that change,
// a `why` per frame, and a `steps` flow (states drawn, not clicked).
// Lives in packages/mockup-loop/examples/ (NOT a mock root): never listed by default.
// Copy it to mockups/<yyyy-mm-dd-slug>/mock.tsx to start a mock. The E2E fixture copies it too.
// See changes: add-live-component-mock-site, fix-mock-site-ux.
// A mock = ONE PAGE (or flow). Frames are the full page at different widths / states.
// Accept / Reject applies to the whole page. Rings circle the divs that changed.
import type { ReactNode } from "react";
import { mdiCheckCircleOutline, mdiFolderRemoveOutline, mdiMagnify, mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { GitDirtyPill } from "@app/components/worktree/GitDirtyPill.tsx";
import { CwdGonePill } from "@app/components/folder/CwdGonePill.tsx";
import { InlineMessage } from "@app/components/primitives/InlineMessage.tsx";
import { Fix, Issue, Tap, type Mock } from "mock-site/kit";

const dirty = { dirtyCount: 7, staged: 2, unstaged: 3, untracked: 2, ahead: 3, behind: 1 } as never;
const smallDirty = { dirtyCount: 2, staged: 0, unstaged: 2, untracked: 0, ahead: 0, behind: 0 } as never;
const gone = { cwdMissing: true } as never;
const noop = () => {};

const sessions = [
  { name: "fix-login-redirect", folder: "~/work/web-app", time: "2m", state: "Working", git: dirty, missing: true },
  { name: "add-billing-export", folder: "~/work/web-app", time: "14m", state: "Idle", git: smallDirty, missing: false },
  { name: "docs-refresh", folder: "~/work/handbook", time: "1h", state: "Idle", git: undefined, missing: false },
];

// ---- page parts (parent markup + real components) ----
function Card({ s, variant, ring }: { s: (typeof sessions)[number]; variant: "current" | "proposed"; ring?: boolean }) {
  const pills =
    variant === "current" ? (
      <>
        {s.missing ? <CwdGonePill session={gone} /> : null}
        <GitDirtyPill status={s.git} onClick={noop} />
      </>
    ) : s.missing ? (
      <CwdGonePill session={gone} />
    ) : (
      <GitDirtyPill status={s.git} onClick={noop} />
    );
  return (
    <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium text-[var(--text-primary)] truncate">{s.name}</span>
        {ring && variant === "current" ? <Issue n={1} tip="Two pills compete for attention">{pills}</Issue> : null}
        {ring && variant === "proposed" ? <Fix n={1} tip="Missing folder wins, git pill hidden">{pills}</Fix> : null}
        {!ring ? pills : null}
        <span className="ml-auto text-xs text-[var(--text-tertiary)]">{s.time}</span>
      </div>
      <div className="mt-1 text-xs text-[var(--text-tertiary)] truncate">{s.folder} - {s.state}</div>
    </div>
  );
}

function Sidebar({ variant, phone }: { variant: "current" | "proposed"; phone?: boolean }) {
  return (
    <aside className={`flex flex-col gap-2 p-3 bg-[var(--bg-primary)] ${phone ? "" : "w-[300px] border-r border-[var(--border-primary)]"}`}>
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1 flex items-center gap-2 rounded-lg border border-[var(--border-primary)] px-2 py-1 text-xs text-[var(--text-tertiary)]">
          <Icon path={mdiMagnify} size={0.6} /> Search sessions
        </div>
        <button className="rounded-lg border border-[var(--border-primary)] p-1 text-[var(--text-secondary)]"><Icon path={mdiPlus} size={0.7} /></button>
      </div>
      {sessions.map((s, i) => <Card key={s.name} s={s} variant={variant} ring={i === 0} />)}
    </aside>
  );
}

function Detail({ variant }: { variant: "current" | "proposed" }) {
  const banner = (
    <InlineMessage severity="warning" icon={mdiFolderRemoveOutline} title="This session's folder no longer exists"
      actions={<>
        <button className="px-2 py-0.5 rounded border border-[var(--border-primary)] text-xs">Re-link folder</button>
        <button className="px-2 py-0.5 rounded border border-[var(--border-primary)] text-xs">Archive session</button>
      </>}>
      The worktree ~/work/web-app was removed outside the dashboard.
    </InlineMessage>
  );
  return (
    <main className="flex-1 flex flex-col gap-3 p-4 bg-[var(--bg-primary)] min-w-0">
      {variant === "proposed" ? (
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">fix-login-redirect</h2>
          <span className="text-xs text-[var(--text-tertiary)]">~/work/web-app</span>
        </div>
      ) : null}
      {variant === "current" ? (
        <Issue n={2} tip="No sign the folder is gone" block>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">fix-login-redirect</h2>
            <span className="text-xs text-[var(--text-tertiary)]">~/work/web-app</span>
          </div>
        </Issue>
      ) : (
        <Fix n={2} tip="Banner with recovery actions" block>{banner}</Fix>
      )}
      <div className="flex flex-col gap-2 text-sm">
        <div className="self-end max-w-[70%] rounded-xl bg-[var(--bg-tertiary)] px-3 py-2 text-[var(--text-primary)]">Fix the login redirect loop</div>
        <div className="max-w-[80%] rounded-xl border border-[var(--border-secondary)] px-3 py-2 text-[var(--text-secondary)]">
          The redirect loops because the session cookie is set after the 302. Moving the cookie write before the redirect.
        </div>
      </div>
    </main>
  );
}

// ---- re-link flow (frame 3): one state per step; Tap marks the click that leads on ----
const btn = "px-2 py-0.5 rounded border border-[var(--border-primary)] text-xs";
const RelinkBanner = () => (
  <InlineMessage severity="warning" icon={mdiFolderRemoveOutline} title="This session's folder no longer exists"
    actions={<><Tap><button className={btn}>Re-link folder</button></Tap><button className={btn}>Archive session</button></>}>
    ~/work/web-app was removed outside the dashboard.
  </InlineMessage>
);
const Picker = () => (
  <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 text-xs flex flex-col gap-1">
    <div className="text-[var(--text-tertiary)]">Pick the new folder</div>
    <div className="px-2 py-1 rounded text-[var(--text-secondary)]">~/work/web-app-old</div>
    <Tap><div className="px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">~/work/web-app-2</div></Tap>
    <div className="px-2 py-1 rounded text-[var(--text-secondary)]">Browse...</div>
  </div>
);
const Relinked = () => (
  <div className="flex flex-col gap-2">
    <InlineMessage severity="success" icon={mdiCheckCircleOutline} title="Re-linked to ~/work/web-app-2" />
    <Card s={{ ...sessions[0], folder: "~/work/web-app-2", time: "now", state: "Idle", missing: false }} variant="proposed" />
  </div>
);

const Page = ({ variant }: { variant: "current" | "proposed" }): ReactNode => (
  <div className="flex min-h-[420px]"><Sidebar variant={variant} /><Detail variant={variant} /></div>
);
const PhonePage = ({ variant }: { variant: "current" | "proposed" }): ReactNode => <Sidebar variant={variant} phone />;

const mock: Mock = {
  title: "Sessions page - missing folder",
  category: "Sessions",
  change: "add-live-component-mock-site",
  frames: [
    { title: "Sessions page - desktop", width: 1040, why: "Missing folder wins over git; the page says why and offers a way out.",
      current: <Page variant="current" />, proposed: <Page variant="proposed" /> },
    { title: "Sessions page - phone", phone: true, why: "Same rule at 375px: one pill per row.",
      current: <PhonePage variant="current" />, proposed: <PhonePage variant="proposed" /> },
    { title: "Re-link flow - after the click", width: 300, why: "Each state is drawn: the reviewer never has to click.",
      steps: [
        { label: "folder gone", proposed: <RelinkBanner /> },
        { label: "picker open", proposed: <Picker /> },
        { label: "re-linked", proposed: <Relinked /> },
      ] },
  ],
};
export default mock;
