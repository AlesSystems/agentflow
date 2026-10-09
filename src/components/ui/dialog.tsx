"use client";
// Dialog patterns adapted from shadcn/ui, MIT, copyright shadcn.
import * as Dialog from "@radix-ui/react-dialog";
export function Modal({
  title,
  open,
  onClose,
  children,
  panel = false,
  onRestore,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  panel?: boolean;
  onRestore?: () => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={panel ? "dialog task-panel" : "dialog"}
          onCloseAutoFocus={(event) => {
            if (onRestore) {
              event.preventDefault();
              onRestore();
            }
          }}
        >
          <div className="dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <button aria-label="Close" onClick={onClose}>
              Close
            </button>
          </div>
          <Dialog.Description className="sr-only">
            Inspect or update this workspace record.
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
