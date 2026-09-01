import type { JSX } from "react";
import { useCallback, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import type { SignatureComponentProps } from "./context.js";

/**
 * Self-contained pointer-event signature canvas exporting a base64 PNG data URL.
 * Zero third-party dependency (design D10). Colours come from the theme via
 * `currentColor`, never a literal, so the token-lint gate stays satisfied.
 */
export function SignatureCanvas({
  value,
  onChange,
  disabled,
  readOnly,
  ariaLabel,
  clearLabel,
}: SignatureComponentProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const ctx = useCallback(() => {
    const canvas = canvasRef.current;
    return canvas ? canvas.getContext("2d") : null;
  }, []);

  // Restore an existing value (prefill / read-only).
  useEffect(() => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (value) {
      const img = new Image();
      img.onload = () => c.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.onerror = () => {}; // ignore decode failures (e.g. non-DOM test envs)
      img.src = value;
    }
  }, [value, ctx]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || readOnly) return;
    drawing.current = true;
    last.current = pos(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled || readOnly) return;
    const c = ctx();
    const p = pos(e);
    if (!c || !last.current) return;
    c.strokeStyle = "currentColor";
    c.lineWidth = 2;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(last.current.x, last.current.y);
    c.lineTo(p.x, p.y);
    c.stroke();
    last.current = p;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (canvas && c) c.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };

  return (
    <Stack spacing={1}>
      <Box
        component="canvas"
        ref={canvasRef}
        width={480}
        height={160}
        role="img"
        aria-label={ariaLabel}
        tabIndex={disabled || readOnly ? -1 : 0}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          width: "100%",
          maxWidth: 480,
          touchAction: "none",
          color: "text.primary",
          cursor: disabled || readOnly ? "not-allowed" : "crosshair",
          bgcolor: "background.paper",
        }}
      />
      {!readOnly && (
        <Box>
          <Button size="small" onClick={clear} disabled={disabled}>
            {clearLabel}
          </Button>
        </Box>
      )}
    </Stack>
  );
}
