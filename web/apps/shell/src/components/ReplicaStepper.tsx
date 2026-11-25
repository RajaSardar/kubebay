import { Badge, Button, Row, TextField } from "@kubebay/ui";

/** Replica count held at 0 or more, whole numbers only. */
export function clampReplicas(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * The replica count editor for Scale: − and + (Shift = 10), ±5 buttons, and a field you can type a
 * number into (the way to make a big jump). Shows "Unsaved" while the count differs from `current`, so it is
 * clear there is something to apply. The caller owns the value and the Apply button.
 */
export function ReplicaStepper({
  value,
  current,
  onChange,
  disabled,
}: {
  value: number;
  /** The live replica count; undefined while it is not known. */
  current?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const by = (d: number) => onChange(clampReplicas(value + d));
  const atZero = value <= 0;
  const step = (label: string, d: number, text: string) => (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      disabled={disabled || (d < 0 && atZero)}
      onClick={(e) => by(Math.abs(d) === 1 && e.shiftKey ? d * 10 : d)}
    >
      {text}
    </Button>
  );
  return (
    <Row align="center" gap={1} wrap>
      {step("Decrease replicas by 5", -5, "−5")}
      {step("Decrease replicas", -1, "−")}
      <TextField
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        aria-label="Replicas"
        className="mono"
        style={{ width: "6ch", textAlign: "center" }}
        disabled={disabled}
        value={String(value)}
        onChange={(e) => onChange(clampReplicas(Number(e.target.value)))}
        onKeyDown={(e) => {
          if (!e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          e.preventDefault();
          by(e.key === "ArrowUp" ? 10 : -10);
        }}
      />
      {step("Increase replicas", 1, "+")}
      {step("Increase replicas by 5", 5, "+5")}
      {current !== undefined && value !== current && <Badge tone="warn">Unsaved</Badge>}
    </Row>
  );
}
