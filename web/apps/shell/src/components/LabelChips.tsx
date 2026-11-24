import { Badge, Row } from "@kubebay/ui";
import { labelChips, labelPairs } from "../lib/labelChips";

/** A list cell: the first few labels as chips, "+N" for the rest (all of them in the tooltip). */
export function LabelChips({ labels, max = 3 }: { labels: Readonly<Record<string, string>> | undefined; max?: number }) {
  const { shown, more } = labelChips(labels, max);
  if (shown.length === 0) return <span className="muted">–</span>;
  return (
    <Row gap={1} wrap title={labelPairs(labels).join("\n")}>
      {shown.map((p) => (
        <Badge key={p}>{p}</Badge>
      ))}
      {more > 0 && <span className="muted small">+{more}</span>}
    </Row>
  );
}
