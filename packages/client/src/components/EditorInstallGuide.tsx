import React from "react";
import { Icon } from "@mdi/react";
import { mdiCodeBraces, mdiApple, mdiLinux, mdiLanguageJavascript, mdiMicrosoftVisualStudioCode } from "@mdi/js";
import { t as i18nT } from "../lib/i18n";

interface Props {
  onRetry?: () => void;
}

export function EditorInstallGuide({ onRetry }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-[var(--text-primary)]">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center">
          <Icon path={mdiCodeBraces} size={2} className="mx-auto mb-3 text-blue-400 opacity-60" />
          <h2 className="text-xl font-semibold">{i18nT("auto.code_server_not_found", undefined, "code-server not found")}</h2>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            {i18nT("auto.install_code_server_to_use_the", undefined, "Install code-server to use the embedded VS Code editor.")}
          </p>
        </div>

        <div className="space-y-4">
          {/* macOS */}
          <div className="bg-[var(--bg-surface)] rounded-lg p-4 border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <Icon path={mdiApple} size={0.7} />
              <span className="font-medium text-sm">{i18nT("auto.macos", undefined, "macOS")}</span>
            </div>
            <code className="block bg-[var(--bg-primary)] rounded px-3 py-2 text-xs font-mono text-green-400">
              {i18nT("auto.brew_install_code_server", undefined, "brew install code-server")}
            </code>
          </div>

          {/* Linux */}
          <div className="bg-[var(--bg-surface)] rounded-lg p-4 border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <Icon path={mdiLinux} size={0.7} />
              <span className="font-medium text-sm">{i18nT("auto.linux", undefined, "Linux")}</span>
            </div>
            <code className="block bg-[var(--bg-primary)] rounded px-3 py-2 text-xs font-mono text-green-400">
              {i18nT("auto.curl_fssl_https_code_server_dev", undefined, "curl -fsSL https://code-server.dev/install.sh | sh")}
            </code>
          </div>

          {/* npm */}
          <div className="bg-[var(--bg-surface)] rounded-lg p-4 border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <Icon path={mdiLanguageJavascript} size={0.7} />
              <span className="font-medium text-sm">{i18nT("auto.npm_any_platform", undefined, "npm (any platform)")}</span>
            </div>
            <code className="block bg-[var(--bg-primary)] rounded px-3 py-2 text-xs font-mono text-green-400">
              {i18nT("auto.npm_install_g_code_server", undefined, "npm install -g code-server")}
            </code>
          </div>

          {/* openvscode-server */}
          <div className="bg-[var(--bg-surface)] rounded-lg p-4 border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <Icon path={mdiMicrosoftVisualStudioCode} size={0.7} />
              <span className="font-medium text-sm">{i18nT("auto.open_vscode_server_alternative", undefined, "Open VSCode Server (alternative)")}</span>
            </div>
            <code className="block bg-[var(--bg-primary)] rounded px-3 py-2 text-xs font-mono text-green-400 whitespace-pre-wrap">
              {'npm install -g @anthropic-ai/claude-code-vscode-server'}
            </code>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              {i18nT("auto.alternative_to_code_server_also_auto", undefined, "Alternative to code-server. Also auto-detected.")}
            </p>
          </div>
        </div>

        <div className="text-center space-y-2">
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              {i18nT("auto.retry_detection", undefined, "Retry Detection")}
            </button>
          )}
          <p className="text-xs text-[var(--text-tertiary)]">
            {i18nT("auto.after_installing_click_retry_detection_you", undefined, "After installing, click Retry Detection. You can also set a custom binary path in Settings → Editor.")}
          </p>
        </div>
      </div>
    </div>
  );
}
