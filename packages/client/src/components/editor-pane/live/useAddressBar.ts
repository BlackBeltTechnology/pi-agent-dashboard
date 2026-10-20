/**
 * The viewer's editable address bar (change: improve-canvas-html-and-url-ux, D9).
 * Every submission goes through the shared `validateAddressPath` (via
 * `classifyAddress`): a path within the same target re-points the frame; a
 * different loopback port asks for an inline confirmation first; anything else is
 * refused with the frame unchanged. Nothing is registered by a same-target edit.
 */
import { useCallback, useState } from "react";
import { useI18n } from "../../../lib/i18n/i18n.js";
import { classifyAddress, displayDeep } from "../../../lib/live-preview/preview-policy.js";
import type { FramedTarget } from "./LiveFrame.js";

export interface PendingTarget {
  host: string;
  port: number;
  deep: string;
}

export function addressText(target: FramedTarget, deep: string): string {
  const d = displayDeep(deep);
  return target.kind === "static" ? d : `http://${target.host}:${target.port}/${d}`;
}

export function useAddressBar(
  target: FramedTarget,
  initialDeep: string,
  onLaunchPort?: (input: PendingTarget) => Promise<string | null>,
) {
  const { t } = useI18n();
  const [deep, setDeep] = useState(initialDeep);
  const [addr, setAddr] = useState(() => addressText(target, initialDeep));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTarget | null>(null);

  const errorText = useCallback(
    (reason: "invalid-path" | "loopback-only" | "invalid"): string => {
      if (reason === "invalid-path")
        return t("live.address.invalidPath", undefined, "Invalid path. Use a path inside this preview (no empty, . or .. segments).");
      if (reason === "loopback-only") return t("live.address.loopbackOnly", undefined, "Only localhost / 127.0.0.1 targets can be previewed.");
      return t("live.address.invalid", undefined, "Enter a valid address.");
    },
    [t],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setPending(null);
    const res = classifyAddress(addr, target.kind === "static" ? { kind: "static" } : { kind: "port", host: target.host, port: target.port });
    if (res.kind === "error") {
      setError(errorText(res.reason));
      return;
    }
    setError(null);
    if (res.kind === "same") {
      setDeep(res.deep);
      setAddr(addressText(target, res.deep));
    } else {
      setPending({ host: res.host, port: res.port, deep: res.deep });
    }
  };

  const addPending = async () => {
    if (!pending || !onLaunchPort) return;
    const err = await onLaunchPort(pending);
    if (err) setError(err);
    setPending(null);
  };

  return { deep, addr, setAddr, error, pending, submit, addPending, cancelPending: () => setPending(null) };
}
