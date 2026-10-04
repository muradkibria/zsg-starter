// A small in-page dialog (never the browser's own), for things the shared
// confirm can't hold: a code shown once, or a typed confirmation.

import type { ReactNode } from "react";
import { Dialog } from "@/components/overlay";

export function Modal({ title, children, onClose, footer }: { title: ReactNode; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  return (
    <Dialog onClose={onClose} title={title} footer={footer}>
      <div className="mt-3 text-sm text-ink-2">{children}</div>
    </Dialog>
  );
}
