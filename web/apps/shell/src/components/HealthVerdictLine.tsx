import { useId } from "react";
import { Badge, Button, Row, StatusDot, VisuallyHidden } from "@kubebay/ui";
import type { HealthVerdict } from "../lib/verdict";

/**
 * The top of Overview v2: one line to read or paste — a word beside its
 * colour, the count with its denominator and the worst thing by name, and
 * whether warnings are rising. With your namespaces in scope it says how much
 * is wrong outside them, one click from showing everything.
 */
export function HealthVerdictLine({
  verdict,
  trend,
  scope,
  showingAll,
  onToggleScope,
}: {
  verdict: HealthVerdict;
  trend?: string;
  /** The namespaces picked in the namespace filter (none: the whole cluster). */
  scope: readonly string[];
  showingAll: boolean;
  onToggleScope: () => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <Row gap={3} align="center" wrap>
        <VisuallyHidden id={id}>Cluster health</VisuallyHidden>
        <Row gap={2} align="center" as="span">
          <StatusDot status={verdict.tone} pulse={verdict.tone === "err"} />
          <strong>{verdict.word}</strong>
        </Row>
        <span>{verdict.sentence}</span>
        {trend && <span className="muted small">{trend}</span>}
        {scope.length > 0 && (
          <Row gap={2} align="center" as="span">
            {showingAll ? (
              <>
                <Badge>All namespaces</Badge>
                <Button variant="ghost" onClick={onToggleScope}>
                  Only your namespaces
                </Button>
              </>
            ) : (
              <>
                <Badge>{`Your namespaces: ${scope.join(", ")}`}</Badge>
                {verdict.outside > 0 && (
                  <Button variant="ghost" onClick={onToggleScope}>
                    {`+${verdict.outside} outside your namespaces`}
                  </Button>
                )}
              </>
            )}
          </Row>
        )}
      </Row>
    </section>
  );
}
