import { useCallback, useState, type ReactNode } from "react";
import { Button, Modal, Row, Stack } from "@kubebay/ui";
import { anyEditDirty, dirtyEditKeys } from "../lib/editGuard";
import { clearDraft } from "../lib/editRecovery";

/** "Discard changes?" — the answer to closing, switching or leaving with an unapplied YAML edit. */
export function DiscardChangesModal({
  onKeep,
  onDiscard,
  keys,
}: {
  onKeep: () => void;
  onDiscard: () => void;
  /** The editors being dropped; every dirty one when not given. */
  keys?: string[];
}) {
  return (
    <Modal label="Discard changes?" title="Discard changes?" onClose={onKeep} placement="center">
      <Stack gap={3}>
        <span className="muted small">You have YAML edits that were not applied. Closing this now loses them.</span>
        <Row gap={2} justify="end">
          <Button variant="ghost" onClick={onKeep}>
            Keep editing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              // Discarding is a choice, so the kept draft goes too: it is for crashes, not for this.
              (keys ?? dirtyEditKeys()).forEach(clearDraft);
              onDiscard();
            }}
          >
            Discard
          </Button>
        </Row>
      </Stack>
    </Modal>
  );
}

/**
 * Wrap an action that would drop an open YAML editor (closing the drawer,
 * changing tab). With no unapplied edit it runs at once; otherwise it waits for
 * "Discard". Render `modal` somewhere inside the host (inside a Drawer, so a
 * press in the dialog does not count as a press on the page behind it).
 */
export function useDiscardGuard(): {
  guard: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => void;
  modal: ReactNode;
} {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = useCallback(
    <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (!anyEditDirty()) fn(...args);
        else setPending(() => () => fn(...args));
      },
    [],
  );
  const modal = pending ? (
    <DiscardChangesModal
      onKeep={() => setPending(null)}
      onDiscard={() => {
        const run = pending;
        setPending(null);
        run();
      }}
    />
  ) : null;
  return { guard, modal };
}
