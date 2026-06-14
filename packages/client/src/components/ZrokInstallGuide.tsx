import React, { useState, useEffect } from "react";
import { getApiBase } from "../lib/api-context.js";
import { Icon } from "@mdi/react";
import { mdiArrowLeft, mdiOpenInNew } from "@mdi/js";
import type { TunnelStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { t as i18nT } from "../lib/i18n";

interface Props {
  onBack: () => void;
}

type ServerOs = "darwin" | "linux" | "win32" | string;

function useServerOs(): ServerOs {
  const [os, setOs] = useState<ServerOs>("linux");
  useEffect(() => {
    fetch(`${getApiBase()}/api/tunnel-status`)
      .then((r) => r.json())
      .then((data: TunnelStatus) => setOs(data.serverOs))
      .catch(() => {});
  }, []);
  return os;
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg p-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap">
      {children}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
      {children}
    </div>
  );
}

function DarwinGuide() {
  return (
    <>
      <Section title={i18nT("auto.1_install_zrok", undefined, "1. Install zrok")}>
        <p className="text-sm text-[var(--text-secondary)] mb-2">
          {i18nT("auto.install_via_homebrew", undefined, "Install via Homebrew:")}
        </p>
        <CodeBlock>{`brew install zrok`}</CodeBlock>
      </Section>
      <EnrollAndVerify />
    </>
  );
}

function LinuxGuide() {
  return (
    <>
      <Section title={i18nT("auto.1_install_zrok", undefined, "1. Install zrok")}>
        <p className="text-sm text-[var(--text-secondary)] mb-2">
          {i18nT("auto.install_via_the_official_install_script", undefined, "Install via the official install script:")}
        </p>
        <CodeBlock>{`curl -sSLf https://get.openziti.io/install.bash | sudo bash -s zrok`}</CodeBlock>
        <p className="text-sm text-[var(--text-tertiary)] mt-2">
          {i18nT("auto.or_on_debian_ubuntu_via_apt", undefined, "Or on Debian/Ubuntu via apt:")}
        </p>
        <CodeBlock>{`# Add the OpenZiti repo
curl -sSLf https://get.openziti.io/install.bash | sudo bash -s openziti-controller
sudo apt install zrok`}</CodeBlock>
      </Section>
      <EnrollAndVerify />
    </>
  );
}

function WindowsGuide() {
  return (
    <>
      <Section title={i18nT("auto.1_install_zrok", undefined, "1. Install zrok")}>
        <p className="text-sm text-[var(--text-secondary)] mb-2">
          {i18nT("auto.install_via_chocolatey", undefined, "Install via Chocolatey:")}
        </p>
        <CodeBlock>{`choco install zrok`}</CodeBlock>
        <p className="text-sm text-[var(--text-tertiary)] mt-2">
          {i18nT("auto.or_via_scoop", undefined, "Or via Scoop:")}
        </p>
        <CodeBlock>{`scoop bucket add openziti https://github.com/openziti/scoop-bucket.git
scoop install zrok`}</CodeBlock>
      </Section>
      <EnrollAndVerify />
    </>
  );
}

function EnrollAndVerify() {
  return (
    <>
      <Section title={i18nT("auto.2_create_account_enroll", undefined, "2. Create Account & Enroll")}>
        <p className="text-sm text-[var(--text-secondary)] mb-2">
          {i18nT("auto.sign_up_at", undefined, "Sign up at")}{" "}
          <a href="https://myzrok.io" target="_blank" rel="noopener" className="text-blue-400 hover:underline">
            myzrok.io
          </a>{" "}
          {i18nT("auto.to_get_your_invite_token_then", undefined, "to get your invite token, then enroll:")}
        </p>
        <CodeBlock>{`zrok enable <your-token>`}</CodeBlock>
        <p className="text-sm text-[var(--text-tertiary)] mt-2">
          {i18nT("auto.this_stores_your_api_token_in", undefined, "This stores your API token in zrok's own config directory\n          (")}<code className="text-xs bg-[var(--bg-surface)] px-1 py-0.5 rounded font-mono">~/.zrok2/environment.json</code>{i18nT("auto.the_dashboard_reads_this_file_to", undefined, ").\n          The dashboard reads this file to detect enrollment — no keys are\n          copied into the dashboard config.")}
        </p>
      </Section>
      <Section title={i18nT("auto.3_verify", undefined, "3. Verify")}>
        <p className="text-sm text-[var(--text-secondary)] mb-2">
          {i18nT("auto.check_that_zrok_is_working", undefined, "Check that zrok is working:")}
        </p>
        <CodeBlock>{`zrok version`}</CodeBlock>
      </Section>
    </>
  );
}

export function ZrokInstallGuide({ onBack }: Props) {
  const serverOs = useServerOs();

  const osLabel = serverOs === "darwin" ? "macOS" : serverOs === "win32" ? "Windows" : "Linux";

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-primary)]">
        <button
          onClick={onBack}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title={i18nT("auto.back", undefined, "Back")}
          data-testid="tunnel-guide-back"
        >
          <Icon path={mdiArrowLeft} size={0.8} />
        </button>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          {i18nT("auto.tunnel_setup_install_zrok", undefined, "Tunnel Setup — Install zrok (")}{osLabel})
        </h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          {i18nT("auto.zrok_enables_secure_public_tunnels_to", undefined, "zrok enables secure public tunnels to your dashboard server.\n          Follow the steps below to install and configure it on your")}{" "}
          <strong>{osLabel}</strong> server.
        </p>

        {serverOs === "darwin" && <DarwinGuide />}
        {serverOs === "win32" && <WindowsGuide />}
        {serverOs !== "darwin" && serverOs !== "win32" && (
          <>
            {serverOs !== "linux" && (
              <p className="text-xs text-[var(--text-tertiary)] mb-4 italic">
                {i18nT("auto.your_server_os_was_not_recognized", undefined, "Your server OS was not recognized — showing Linux instructions.\n                Check")} <a href="https://docs.zrok.io" target="_blank" rel="noopener" className="text-blue-400 hover:underline">docs.zrok.io</a> {i18nT("auto.for_your_platform", undefined, "for your platform.")}
              </p>
            )}
            <LinuxGuide />
          </>
        )}

        <Section title={i18nT("auto.4_restart_the_dashboard_server", undefined, "4. Restart the Dashboard Server")}>
          <p className="text-sm text-[var(--text-secondary)] mb-2">
            {i18nT("auto.the_tunnel_is", undefined, "The tunnel is")} <strong>{i18nT("auto.enabled_by_default", undefined, "enabled by default")}</strong> (<code className="text-xs bg-[var(--bg-surface)] px-1 py-0.5 rounded font-mono">{i18nT("auto.tunnel_enabled_true", undefined, "tunnel.enabled: true")}</code>).
            After installing and enrolling zrok, restart the dashboard server —
            it will automatically detect zrok and open a tunnel on startup.
            The tunnel URL will appear in the server logs.
          </p>
          <CodeBlock>{`pi-dashboard stop && pi-dashboard start`}</CodeBlock>
          <p className="text-sm text-[var(--text-tertiary)] mt-2">
            {i18nT("auto.to_disable_auto_tunnel_set", undefined, "To disable auto-tunnel, set")} <code className="text-xs bg-[var(--bg-surface)] px-1 py-0.5 rounded font-mono">tunnel.enabled</code> to{" "}
            <code className="text-xs bg-[var(--bg-surface)] px-1 py-0.5 rounded font-mono">false</code> {i18nT("auto.in_settings_or_pass", undefined, "in Settings or pass")}{" "}
            <code className="text-xs bg-[var(--bg-surface)] px-1 py-0.5 rounded font-mono">--no-tunnel</code> {i18nT("auto.on_the_cli", undefined, "on the CLI.")}
          </p>
        </Section>

        <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
          <a
            href="https://docs.zrok.io"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-sm text-blue-400 hover:underline"
          >
            {i18nT("auto.official_zrok_documentation", undefined, "Official zrok documentation")}
            <Icon path={mdiOpenInNew} size={0.5} />
          </a>
        </div>
      </div>
    </div>
  );
}
