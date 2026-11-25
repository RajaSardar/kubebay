import { useMemo } from "react";
import { Badge, Button, Popover, Row, Slider, Stack, TextField } from "@kubebay/ui";
import { POSITION_MAX, clampReplicas, positionFromReplica, presetChips, replicaFromPosition, sliderMax } from "../lib/replicaScale";

/** "18 → 24 (+6)", or "No change". */
function changeLabel(value: number, current: number): string {
  if (value === current) return "No change";
  const d = value - current;
  return `${current} → ${value} (${d > 0 ? "+" : "−"}${Math.abs(d)})`;
}

/** What a screen reader says for the slider: "24 replicas, 6 more than now". */
function spoken(value: number, current: number): string {
  const unit = value === 1 ? "replica" : "replicas";
  const d = value - current;
  if (d === 0) return `${value} ${unit}, same as now`;
  return `${value} ${unit}, ${Math.abs(d)} ${d > 0 ? "more" : "fewer"} than now`;
}

/** The controls: an exact number, a slider, one-click counts, and what the change means. */
function Body({
  value,
  current,
  onChange,
  disabled,
  statefulSet,
  onEnter,
  hint,
}: {
  value: number;
  current: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  statefulSet?: boolean;
  onEnter?: () => void;
  hint?: boolean;
}) {
  const max = useMemo(() => sliderMax(current), [current]);
  const chips = useMemo(() => presetChips(current), [current]);
  const dirty = value !== current;
  const step = (dir: 1 | -1, big: boolean) => onChange(clampReplicas(value + dir * (big ? 10 : 1)));
  return (
    <Stack gap={3}>
      <Row align="center" gap={2} wrap>
        <TextField
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          aria-label="Replicas"
          className="mono"
          style={{ width: "8ch", textAlign: "center" }}
          disabled={disabled}
          value={String(value)}
          onChange={(e) => onChange(clampReplicas(Number(e.target.value)))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) {
              e.preventDefault();
              onEnter();
              return;
            }
            if (!e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
            e.preventDefault();
            step(e.key === "ArrowUp" ? 1 : -1, true);
          }}
        />
        <span className="mono small" aria-live="polite">
          {changeLabel(value, current)}
        </span>
        {dirty && <Badge tone="warn">Unsaved</Badge>}
      </Row>
      <Slider
        label="Replicas"
        min={0}
        max={POSITION_MAX}
        value={positionFromReplica(value, max)}
        valueText={spoken(value, current)}
        disabled={disabled}
        onChange={(p) => onChange(replicaFromPosition(p, max))}
        onStep={step}
      />
      <Row gap={1} wrap data-testid="replica-chips">
        {chips.map((c) => (
          <Button key={c.value} type="button" variant="ghost" size="sm" aria-pressed={value === c.value} disabled={disabled} onClick={() => onChange(c.value)}>
            {c.label}
          </Button>
        ))}
      </Row>
      {value === 0 && current > 0 && <span className="small">Scaled to 0, no pods will run.</span>}
      {statefulSet && value < current && <span className="muted small">Scaling down removes the highest ordinals first.</span>}
      {(dirty || hint) && (
        <Row align="center" justify="between" gap={2}>
          <span className="muted small">{hint ? "Press Apply scale to save." : ""}</span>
          {dirty && (
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(current)}>
              {`Reset to ${current}`}
            </Button>
          )}
        </Row>
      )}
    </Stack>
  );
}

/**
 * The replica count editor for Scale. In the drawer it is one button, "Scale: 18" (or
 * "Scale: 18 → 24" while there is a change to apply) that opens a panel; in the Scale dialog
 * (`inline`) the same controls sit in place. It edits a draft only: the caller owns `value`
 * (so closing the panel keeps it), the blast-radius preview, and the one Apply button.
 */
export function ReplicaControl({
  value,
  current,
  onChange,
  disabled,
  inline,
  statefulSet,
  onEnter,
}: {
  value: number;
  /** The live replica count; undefined while it is not known. */
  current?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  /** Render the controls in place instead of behind a button (the dialog). */
  inline?: boolean;
  /** A StatefulSet removes its highest ordinals first. */
  statefulSet?: boolean;
  /** Enter in the number box (popover only): the caller moves focus to Apply; nothing is applied here. */
  onEnter?: () => void;
}) {
  const base = current ?? value;
  if (inline) return <Body value={value} current={base} onChange={onChange} disabled={disabled} statefulSet={statefulSet} />;
  const text = current !== undefined && value !== current ? `Scale: ${current} → ${value}` : `Scale: ${base}`;
  return (
    <Popover label="Scale replicas" trigger={<span className="mono" style={{ display: "inline-block", minWidth: "14ch", textAlign: "start" }}>{text}</span>} triggerLabel={text} disabled={disabled}>
      <Body value={value} current={base} onChange={onChange} disabled={disabled} statefulSet={statefulSet} onEnter={onEnter} hint />
    </Popover>
  );
}
