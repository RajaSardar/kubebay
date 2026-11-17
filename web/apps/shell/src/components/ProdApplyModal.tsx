import { Button, Modal, Row, Stack } from "@kubebay/ui";

/** Asked before a YAML Apply (never a dry-run) on a cluster whose name looks like production. */
export function ProdApplyModal({
  context,
  target,
  onCancel,
  onConfirm,
}: {
  context: string;
  /** What is being changed, e.g. "ConfigMap example" or "the YAML". */
  target: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal label="Apply to production?" title="Apply to production?" onClose={onCancel} placement="center">
      <Stack gap={3}>
        <span className="muted small">
          {`${context} looks like a production cluster. This applies ${target} to it now. The name is only a guess, so check the cluster before you go on.`}
        </span>
        <Row gap={2} justify="end">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {`Apply to ${context}`}
          </Button>
        </Row>
      </Stack>
    </Modal>
  );
}
