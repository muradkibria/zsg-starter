// Toasts and confirm dialogs — in-page, never browser alert()/confirm().

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { Dialog } from "./overlay";
import { Button } from "./ui";

type ToastTone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: ToastTone;
  text: ReactNode;
}

interface ConfirmOpts {
  title: ReactNode;
  body?: ReactNode;
  confirm?: string;
  danger?: boolean;
}

interface Feedback {
  toast: (text: ReactNode, tone?: ToastTone) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
}

const Ctx = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const toast = useCallback((text: ReactNode, tone: ToastTone = "success") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 8000 : 4500);
  }, []);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })), []);

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl px-4 py-3 text-sm shadow-[var(--shadow-pop)]",
              t.tone === "success" && "bg-navy text-white",
              t.tone === "error" && "bg-red-ink text-white",
              t.tone === "info" && "bg-white text-ink border border-rule",
            )}
          >
            {t.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : t.tone === "error" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
            <div className="flex-1">{t.text}</div>
            <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="opacity-70 hover:opacity-100">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
      {dialog && (
        <Dialog
          onClose={() => close(false)}
          title={dialog.title}
          footer={
            <>
              <Button onClick={() => close(false)}>Cancel</Button>
              <Button variant={dialog.danger ? "danger" : "primary"} onClick={() => close(true)} data-autofocus>
                {dialog.confirm ?? "Confirm"}
              </Button>
            </>
          }
        >
          {dialog.body && <div className="mt-2 text-sm text-muted">{dialog.body}</div>}
        </Dialog>
      )}
    </Ctx.Provider>
  );
}

export function useFeedback(): Feedback {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFeedback outside FeedbackProvider");
  return v;
}
