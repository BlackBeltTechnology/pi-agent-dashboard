/** Minimal toast + polite live-region announcer (mockup `#toast` / `#announce`). */
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";

interface ToastApi {
  toast(msg: string): void;
  announce(msg: string): void;
}
const Ctx = createContext<ToastApi>({ toast() {}, announce() {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3500);
  }, []);
  const announce = useCallback((m: string) => {
    setLive("");
    setTimeout(() => setLive(m), 30);
  }, []);
  return (
    <Ctx.Provider value={{ toast, announce }}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" data-testid="announce">
        {live}
      </div>
      {msg ? (
        <div className="toast" role="status" data-testid="toast">
          {msg}
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

export const useToast = (): ToastApi => useContext(Ctx);
