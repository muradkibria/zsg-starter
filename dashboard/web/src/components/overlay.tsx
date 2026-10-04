// Sheets and dialogs: one implementation of the behaviour every overlay needs.
// - Escape closes the topmost overlay only (a confirm opened from a sheet closes first).
// - Tab stays inside the overlay, and focus goes back where it was on close.
// - The page behind doesn't scroll.
// - Focus starts on [data-autofocus]; otherwise, with a mouse, on the first field;
//   otherwise on the panel itself, so phones don't pop the keyboard on open.

import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';
const FIELDS = 'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select:not([disabled]), textarea:not([disabled])';

const stack: number[] = [];
let seq = 0;
let scrollLocks = 0;
let savedOverflow = "";

function trapTab(e: KeyboardEvent, panel: HTMLElement) {
  const els = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
  if (!els.length) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = els[0];
  const last = els[els.length - 1];
  const active = document.activeElement;
  if (!panel.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && (active === first || active === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Focus, Escape and scroll handling for any modal panel (use the components below where you can). */
export function useOverlay(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = ++seq;
    stack.push(id);
    const before = document.activeElement as HTMLElement | null;
    if (scrollLocks++ === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const t = setTimeout(() => {
      const p = panel.current;
      if (!p) return;
      const mouse = window.matchMedia?.("(pointer: fine)").matches ?? false;
      const target = p.querySelector<HTMLElement>("[data-autofocus]") ?? (mouse ? p.querySelector<HTMLElement>(FIELDS) : null) ?? p;
      target.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "Tab" && panel.current) {
        trapTab(e, panel.current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
      if (before && document.contains(before)) before.focus?.();
    };
  }, [open, panel]);
}

/** Close on a click that starts and ends on the backdrop (not a text selection dragged out of the panel). */
function useBackdropClose(onClose: () => void) {
  const down = useRef(false);
  return {
    onMouseDown: (e: MouseEvent) => {
      down.current = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent) => {
      if (down.current && e.target === e.currentTarget) onClose();
      down.current = false;
    },
  };
}

function CloseButton({ onClose, className }: { onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className={clsx("flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-paper-2 hover:text-ink", className)}
    >
      <X className="size-5" />
    </button>
  );
}

/** A panel from the right on desktop, a bottom sheet on phones. */
export function Sheet({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Desktop width in px (capped at 92% of the window) */
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const backdrop = useBackdropClose(onClose);
  useOverlay(open, panel, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-ink/30 md:items-stretch md:justify-end" {...backdrop}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ ["--sheet-w" as string]: `${width}px` }}
        className="flex max-h-[92dvh] w-full flex-col rounded-t-[20px] bg-white shadow-[var(--shadow-pop)] outline-none md:h-full md:max-h-none md:w-[var(--sheet-w)] md:max-w-[92vw] md:rounded-none md:rounded-l-2xl"
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line md:hidden" aria-hidden="true" />
        <header className="flex shrink-0 items-start gap-3 border-b border-rule px-5 pt-3 pb-3.5 md:pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 font-display text-xl leading-tight font-semibold break-words">
              {title}
            </h2>
            {sub && <div className="mt-1 text-[13px] text-muted">{sub}</div>}
          </div>
          <CloseButton onClose={onClose} className="-mt-1.5 -mr-2" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <footer className="shrink-0 border-t border-rule px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** A small centred dialog (a bottom card on phones). */
export function Dialog({
  open = true,
  onClose,
  title,
  sub,
  children,
  footer,
  closeButton,
  className,
}: {
  open?: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Show a × in the corner (dialogs with only a footer don't need one) */
  closeButton?: boolean;
  /** e.g. a wider max width */
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const backdrop = useBackdropClose(onClose);
  useOverlay(open, panel, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/30 p-4 md:items-center" {...backdrop}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx("max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-[var(--shadow-pop)] outline-none", className)}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 font-display text-xl font-semibold">
              {title}
            </h2>
            {sub && <p className="m-0 mt-0.5 text-sm text-muted">{sub}</p>}
          </div>
          {closeButton && <CloseButton onClose={onClose} className="-mt-2 -mr-3" />}
        </div>
        {children}
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
