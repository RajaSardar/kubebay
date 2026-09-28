import { Badge, Card, EmptyState } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";
import { findingsForResource, type PolicyFinding } from "../lib/policyFindings";

const RESULT_TONE: Record<string, "err" | "ok" | undefined> = {
  fail: "err",
  error: "err",
  warn: undefined,
  pass: "ok",
  skip: undefined,
};

/**
 * Backlog #12's top-ranked policy surface: findings for the exact resource
 * open in the drawer, not a standalone page. Passing results are summarized
 * as a count rather than listed — a well-behaved resource shouldn't scroll
 * a wall of "pass" rows to find the one real problem.
 */
export function PolicyFindingsSummary({ findings }: { findings: PolicyFinding[] }) {
  if (findings.length === 0) {
    return (
      <EmptyState style={{ padding: 14 }}>
        <p>No policy findings for this resource.</p>
      </EmptyState>
    );
  }

  const passing = findings.filter((f) => f.result === "pass");
  const notPassing = findings.filter((f) => f.result !== "pass");

  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      {passing.length > 0 && (
        <div className="muted small">
          {passing.length} check{passing.length === 1 ? "" : "s"} passed.
        </div>
      )}
      {notPassing.map((f, i) => (
        <Card key={i}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Badge tone={RESULT_TONE[f.result]}>{f.result}</Badge>
            <span className="mono strong small">{f.rule}</span>
            <span className="muted small">({f.policy})</span>
          </div>
          {f.message && <div className="small" style={{ marginTop: 4 }}>{f.message}</div>}
          {f.severity && <div className="muted small mono">{f.severity}</div>}
        </Card>
      ))}
    </div>
  );
}

/**
 * Data-fetching half: streams the two "free" PolicyReport GVRs (already
 * registered in EXTRA_DEFS, no discovery gating needed — they degrade to an
 * empty stream when no policy engine is installed, same as an empty table
 * on the Policy Reports nav page) and filters to whatever names this exact
 * resource.
 */
export function PolicyFindingsTab({
  cluster,
  ns,
  name,
  kind,
}: {
  cluster: string;
  ns: string;
  name: string;
  kind: string;
}) {
  const reports = useResourceStream(cluster, "wgpolicyk8s.io/v1alpha2/policyreports", { mode: "full" });
  const clusterReports = useResourceStream(cluster, "wgpolicyk8s.io/v1alpha2/clusterpolicyreports", { mode: "full" });

  const findings = findingsForResource([...reports.rows, ...clusterReports.rows], { kind, ns, name });
  return <PolicyFindingsSummary findings={findings} />;
}
