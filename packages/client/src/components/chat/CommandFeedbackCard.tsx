import React from "react";
import { Icon } from "@mdi/react";
import { mdiLoading, mdiCheckCircle, mdiAlertCircle } from "@mdi/js";

interface Props {
  command: string;
  status: string;
  message?: string;
}

export function CommandFeedbackCard({ command, status, message }: Props) {
  const config = {
    started: {
      icon: mdiLoading,
      iconClass: "animate-spin text-blue-400",
      bgClass: "bg-blue-500/10 border-blue-500/20",
      label: "in progress",
    },
    completed: {
      icon: mdiCheckCircle,
      iconClass: "text-green-400",
      bgClass: "bg-green-500/10 border-green-500/20",
      label: "completed",
    },
    error: {
      icon: mdiAlertCircle,
      iconClass: "text-red-400",
      bgClass: "bg-red-500/10 border-red-500/20",
      label: "failed",
    },
  }[status] ?? {
    icon: mdiLoading,
    iconClass: "text-[var(--text-tertiary)]",
    bgClass: "bg-[var(--bg-tertiary)] border-[var(--border-subtle)]",
    label: status,
  };

  return (
    <div className="mt-1 mb-1">
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${config.bgClass}`}>
        <Icon path={config.icon} size={0.55} className={config.iconClass} />
        <code className="font-mono text-[var(--text-primary)]">{command}</code>
        <span className="text-[var(--text-tertiary)]">{config.label}</span>
        {message && status === "error" && (
          <span className="text-red-400 ml-1">— {message}</span>
        )}
      </div>
    </div>
  );
}
