// A sheet: slides in from the right on desktop, up from the bottom on phones.
// The behaviour (focus, Escape, scrolling) comes from the shared overlay.

import type { ReactNode } from "react";
import { Sheet as SharedSheet } from "@/components/overlay";

export function Sheet({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <SharedSheet
      open={open}
      onClose={onClose}
      title={title}
      sub={sub}
      width={wide ? 640 : 480}
      footer={footer && <div className="flex flex-wrap items-center justify-end gap-2">{footer}</div>}
    >
      {children}
    </SharedSheet>
  );
}
