"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft } from "lucide-react";

// rDash modal shell, modelled on rDash's "Add Invoice (Against Order)" modal:
// centered white card (~560px, 6px radius, black/40 overlay); header row
// "←  <title>" (16px semibold black) with a divider; body with generous
// vertical spacing; footer (divider) with a red primary + outlined Cancel.
// TODO(verify): that modal's CSS is not in docs/ui-reference — paddings /
// label colour taken from the description; check against rDash.
export function RdModal({
  open,
  title,
  testId,
  onClose,
  showBack = true,
  closable = true,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  testId: string;
  onClose: () => void;
  /** "←" in the header closes like Cancel. */
  showBack?: boolean;
  /** false = Esc / overlay don't close (e.g. a result the user must acknowledge). */
  closable?: boolean;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => (!o && closable ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          data-testid={testId}
          onEscapeKeyDown={(e) => (closable ? undefined : e.preventDefault())}
          onPointerDownOutside={(e) => (closable ? undefined : e.preventDefault())}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[calc(100%-32px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-rd bg-white font-gilroy shadow-xl outline-none"
        >
          <div className="flex shrink-0 items-center gap-5 border-b border-rd-border px-5 py-4">
            {showBack ? (
              <button type="button" aria-label="Back" onClick={onClose} className="text-rd-black">
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : null}
            <Dialog.Title className="text-[16px] font-semibold text-rd-black">{title}</Dialog.Title>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">{children}</div>
          <div className="flex shrink-0 gap-[10px] border-t border-rd-border px-5 py-4">{footer}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
